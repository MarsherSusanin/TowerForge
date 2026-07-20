// Max canvas backbuffer area (pixels). Above this, high-DPR mobile GPUs stall or OOM. ~1.35M px
// ≈ 1600x844 — plenty for a hex playfield while keeping cheap Android devices stable.
export const MAX_BACKBUFFER_PX = 1_350_000;

export function createCanvasRenderer(options) {
  return new TowerForgeCanvasRenderer(options);
}

export class TowerForgeCanvasRenderer {
  constructor(options) {
    if (!options?.canvas) throw new Error("createCanvasRenderer requires a canvas.");
    this.canvas = options.canvas;
    this.ctx = options.canvas.getContext("2d");
    this.content = options.content ?? {};
    this.assetBase = options.assetBase ?? "";
    this.effects = [];
    this.shake = 0;
    this.images = new Map();
    this.prevEnemyPos = new Map();
    this.lastDrawTime = null;
    this.focusCoord = null;
    this.theme = {
      bg: "#101410",
      buildable: "#1d2a1d",
      path: "#6b5540",
      water: "#427b88",
      blocked: "#252820",
      spawn: "#735e2c",
      core: "#3f6f43",
      tower: "#8ac783",
      towerStroke: "#e8f4db",
      danger: "#df6a59",
      ...options.theme
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(320, Math.floor(rect.width) || 320);
    const cssH = Math.max(240, Math.floor(rect.height) || 240);
    // Cap the backbuffer area. A high-DPR phone (e.g. 1080x2340 @ dpr 2.75) would otherwise
    // allocate a ~2.6M-pixel canvas — GPU memory pressure, jank, and black screens on low-end
    // Android. Scale the device-pixel-ratio down so the backbuffer never exceeds MAX_BACKBUFFER_PX,
    // but never below the CSS resolution (scale >= 1), so desktop stays crisp. (Practice ported
    // from a shipped Capacitor game where an uncapped backbuffer was the #1 low-end-device crash.)
    const dpr = globalThis.devicePixelRatio || 1;
    const cap = Math.max(MAX_BACKBUFFER_PX, cssW * cssH); // never blurrier than 1 device pixel per CSS pixel
    let scale = dpr;
    if (cssW * cssH * scale * scale > cap) scale = Math.sqrt(cap / (cssW * cssH));
    scale = Math.max(1, scale);
    this.canvas.width = Math.floor(cssW * scale);
    this.canvas.height = Math.floor(cssH * scale);
  }

  drawSnapshot(snapshot) {
    if (!snapshot) return;
    const now = (globalThis.performance && globalThis.performance.now) ? globalThis.performance.now() : Date.now();
    const dt = this.lastDrawTime == null ? 0 : Math.min(0.05, (now - this.lastDrawTime) / 1000);
    this.lastDrawTime = now;

    const geom = this.geometry(snapshot.tiles ?? []);
    const positions = new Map();
    for (const enemy of snapshot.enemies ?? []) positions.set(enemy.id, this.enemyPoint(enemy, snapshot, geom));

    this.spawnEffects(snapshot, geom, positions);
    this.advanceEffects(dt);

    this.clear();
    const offset = this.shakeOffset(now, geom);
    this.ctx.save();
    this.ctx.translate(offset.x, offset.y);

    for (const tile of snapshot.tiles ?? []) {
      const p = this.center(tile, geom);
      this.drawHex(p.x, p.y, geom.r * 0.86, this.tileColor(tile.terrain));
    }
    for (const tile of snapshot.temporaryWaterTiles ?? []) {
      const p = this.center(tile, geom);
      this.drawHex(p.x, p.y, geom.r * 0.74, "rgba(66,123,136,.58)");
    }
    if (this.focusCoord) this.drawFocusHex(this.focusCoord, geom);
    for (const tower of snapshot.towers ?? []) this.drawTower(tower, geom);
    for (const enemy of snapshot.enemies ?? []) this.drawEnemy(enemy, snapshot, geom);
    this.drawEffects(geom);

    this.ctx.restore();
    this.drawOutcomeOverlay(snapshot);
    this.prevEnemyPos = positions;
  }

  setFocusCoord(coord) {
    this.focusCoord = coord && Number.isFinite(coord.q) && Number.isFinite(coord.r) ? { q: coord.q, r: coord.r } : null;
  }

  drawFocusHex(coord, geom) {
    const p = this.center(coord, geom);
    this.ctx.save();
    this.ctx.strokeStyle = this.theme.towerStroke;
    this.ctx.lineWidth = Math.max(2, geom.r * 0.12);
    this.ctx.setLineDash([Math.max(3, geom.r * 0.22), Math.max(2, geom.r * 0.12)]);
    this.ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = Math.PI / 6 + i * Math.PI / 3;
      const x = p.x + Math.cos(angle) * geom.r * 0.78;
      const y = p.y + Math.sin(angle) * geom.r * 0.78;
      if (i === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
    }
    this.ctx.closePath();
    this.ctx.stroke();
    this.ctx.restore();
  }

  // ── juice / effects ────────────────────────────────────────────────────────
  spawnEffects(snapshot, geom, positions) {
    for (const ev of snapshot.lastEvents ?? []) {
      if (ev.type === "enemyHit" && ev.damage > 0) {
        const p = positions.get(ev.enemyId);
        if (p) this.effects.push({ kind: "dmg", x: p.x, y: p.y - geom.r * 0.5, vy: -geom.r * 1.1, life: 0.7, t: 0, text: "-" + (Math.round(ev.damage * 10) / 10) });
      } else if (ev.type === "enemyKilled") {
        const p = this.prevEnemyPos.get(ev.enemyId) || positions.get(ev.enemyId);
        if (p) this.spawnBurst(p, this.enemyColor(ev.enemyTypeId), geom);
      } else if (ev.type === "towerFired") {
        const tower = (snapshot.towers ?? []).find((t) => t.id === ev.towerId);
        if (tower) { const tp = this.center(tower.coord, geom); this.effects.push({ kind: "flash", x: tp.x, y: tp.y, life: 0.12, t: 0, r: geom.r * 0.6 }); }
      } else if (ev.type === "enemyLeaked") {
        this.shake = Math.min(1, this.shake + 0.6);
      }
    }
  }
  spawnBurst(p, color, geom) {
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2;
      this.effects.push({ kind: "spark", x: p.x, y: p.y, vx: Math.cos(a) * geom.r * 2.4, vy: Math.sin(a) * geom.r * 2.4, life: 0.4, t: 0, color });
    }
  }
  advanceEffects(dt) {
    this.shake = Math.max(0, this.shake - dt * 3);
    let w = 0;
    for (const fx of this.effects) {
      fx.t += dt;
      if (fx.t >= fx.life) continue;
      if (fx.kind === "dmg") fx.y += fx.vy * dt;
      if (fx.kind === "spark") { fx.x += fx.vx * dt; fx.y += fx.vy * dt; fx.vx *= 0.9; fx.vy *= 0.9; }
      this.effects[w++] = fx;
    }
    this.effects.length = w;
  }
  drawEffects(geom) {
    for (const fx of this.effects) {
      const k = 1 - fx.t / fx.life;
      this.ctx.globalAlpha = Math.max(0, k);
      if (fx.kind === "dmg") {
        this.ctx.fillStyle = "#ffe2a8";
        this.ctx.font = `bold ${Math.max(10, geom.r * 0.5)}px sans-serif`;
        this.ctx.textAlign = "center";
        this.ctx.fillText(fx.text, fx.x, fx.y);
      } else if (fx.kind === "spark") {
        this.ctx.fillStyle = fx.color;
        this.ctx.beginPath();
        this.ctx.arc(fx.x, fx.y, Math.max(1, geom.r * 0.16 * k), 0, Math.PI * 2);
        this.ctx.fill();
      } else if (fx.kind === "flash") {
        this.ctx.fillStyle = "rgba(255,236,170," + (0.7 * k) + ")";
        this.ctx.beginPath();
        this.ctx.arc(fx.x, fx.y, fx.r * (0.6 + 0.4 * (1 - k)), 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
    this.ctx.globalAlpha = 1;
  }
  shakeOffset(now, geom) {
    if (this.shake <= 0) return { x: 0, y: 0 };
    const m = this.shake * geom.r * 0.5;
    return { x: Math.sin(now * 0.06) * m, y: Math.cos(now * 0.085) * m };
  }
  drawOutcomeOverlay(snapshot) {
    if (snapshot.outcome !== "victory" && snapshot.outcome !== "defeat") return;
    const win = snapshot.outcome === "victory";
    this.ctx.fillStyle = win ? "rgba(20,40,20,.55)" : "rgba(40,16,16,.6)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = win ? this.theme.tower : this.theme.danger;
    this.ctx.font = `bold ${Math.max(28, this.canvas.width * 0.08)}px sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(win ? "VICTORY" : "DEFEAT", this.canvas.width / 2, this.canvas.height / 2);
  }

  /** Resolve a bound sprite to a draw descriptor { img, sx, sy, sw, sh }, or null if unavailable.
   *  A sprite is either a standalone image ({ src }) or a frame of an atlas ({ atlas, frame }). */
  spriteFor(kind, id) {
    const visuals = this.content.visuals;
    const spriteId = visuals && visuals.bindings && visuals.bindings[kind] ? visuals.bindings[kind][id] : null;
    const sprite = spriteId && visuals.sprites ? visuals.sprites[spriteId] : null;
    if (!sprite || typeof sprite !== "object") return null;
    if (sprite.atlas && sprite.frame) {
      const atlas = visuals.atlases ? visuals.atlases[sprite.atlas] : null;
      const img = this.loadImage(atlas && atlas.src);
      if (!img) return null;
      const f = sprite.frame;
      // Reject degenerate/negative frames so a malformed catalog draws nothing rather than
      // feeding a negative or non-finite source rect into drawImage (NaN >= 0 is false).
      if (!(f.w > 0) || !(f.h > 0) || !(f.x >= 0) || !(f.y >= 0)) return null;
      return { img, sx: f.x, sy: f.y, sw: f.w, sh: f.h };
    }
    const img = this.loadImage(sprite.src);
    return img ? { img, sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight } : null;
  }

  loadImage(src) {
    if (!src || typeof globalThis.Image !== "function") return null;
    let img = this.images.get(src);
    if (img === undefined) {
      img = new globalThis.Image();
      // Encode each path segment so filenames with spaces/unicode/reserved chars resolve (the
      // studio /project-file/ route decodeURIComponent's the path).
      img.src = assetUrl(this.assetBase, src);
      this.images.set(src, img);
    }
    return img && img.complete && img.naturalWidth ? img : null;
  }

  drawMapDefinition(map) {
    if (!map) return;
    const tiles = [];
    const overrides = new Map((map.terrainOverrides ?? []).map((tile) => [`${tile.q},${tile.r}`, tile.terrain]));
    for (let r = 0; r < map.height; r += 1) {
      for (let q = 0; q < map.width; q += 1) {
        tiles.push({ q, r, terrain: overrides.get(`${q},${r}`) ?? map.defaultTerrain ?? "buildable" });
      }
    }
    const geom = this.geometry(tiles);
    this.clear();
    for (const tile of tiles) {
      const p = this.center(tile, geom);
      this.drawHex(p.x, p.y, geom.r * 0.86, this.tileColor(tile.terrain));
    }
    for (const coord of map.pathCenterline ?? []) {
      const p = this.center(coord, geom);
      this.drawHex(p.x, p.y, geom.r * 0.45, "rgba(215,181,119,.55)");
    }
  }

  pickTile(event, tiles) {
    const geom = this.geometry(tiles ?? []);
    const rect = this.canvas.getBoundingClientRect();
    // Pointer events are reported in CSS pixels, while geometry is calculated in backbuffer
    // pixels. resize() may cap the effective DPR, so the browser's devicePixelRatio is not a
    // reliable conversion factor here. Read the canvas's actual CSS-to-backbuffer scale instead.
    const scaleX = rect.width > 0 ? this.canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? this.canvas.height / rect.height : 1;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    let best = null;
    let bestDist = Infinity;
    for (const tile of tiles ?? []) {
      const p = this.center(tile, geom);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = tile;
      }
    }
    return best && bestDist <= geom.r * 0.95 ? { q: best.q, r: best.r } : null;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = this.theme.bg;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  geometry(tiles) {
    // Loop instead of Math.max(...tiles.map(...)): the spread pushes one argument per tile onto the
    // call stack, so a large map (256x256 = 65 536 tiles) throws "Maximum call stack size exceeded"
    // in WebKit/JSC (Safari + packaged iOS) every frame. A loop also avoids allocating two
    // tile-count arrays 60x/second.
    let maxQ = 1;
    let maxR = 1;
    for (const tile of tiles) {
      if (tile.q > maxQ) maxQ = tile.q;
      if (tile.r > maxR) maxR = tile.r;
    }
    const r = Math.min(this.canvas.width / ((maxQ + 2) * 1.65), this.canvas.height / ((maxR + 2) * 1.45));
    return { r, ox: r * 1.5, oy: r * 1.5 };
  }

  center(coord, geom) {
    return {
      x: geom.ox + coord.q * geom.r * 1.48 + (coord.r % 2) * geom.r * 0.74,
      y: geom.oy + coord.r * geom.r * 1.28
    };
  }

  drawTower(tower, geom) {
    const p = this.center(tower.coord, geom);
    const disabled = (tower.disabledFor ?? 0) > 0; // silenced by an enemy tower-disrupt pulse
    const sprite = this.spriteFor("towers", tower.typeId);
    this.ctx.save();
    if (disabled) this.ctx.globalAlpha = 0.4;
    if (sprite) {
      const s = geom.r * 1.4;
      this.ctx.drawImage(sprite.img, sprite.sx, sprite.sy, sprite.sw, sprite.sh, p.x - s / 2, p.y - s / 2, s, s);
    } else {
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, geom.r * 0.52, 0, Math.PI * 2);
      this.ctx.fillStyle = this.theme.tower;
      this.ctx.fill();
      this.ctx.strokeStyle = this.theme.towerStroke;
      this.ctx.stroke();
      this.ctx.fillStyle = this.theme.bg;
      this.ctx.font = `${Math.max(10, geom.r * 0.42)}px sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText((this.content.towers?.[tower.typeId]?.label || tower.typeId).slice(0, 2), p.x, p.y);
    }
    this.ctx.restore();
    if (disabled) {
      this.ctx.save();
      this.ctx.strokeStyle = "#d9776b";
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([3, 3]);
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, geom.r * 0.64, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }
    // Health bar for damaged destructible towers (hp defined and below the type's maxHp).
    const maxHp = this.content.towers?.[tower.typeId]?.maxHp;
    if (typeof tower.hp === "number" && typeof maxHp === "number" && maxHp > 0 && tower.hp < maxHp) {
      const frac = Math.max(0, Math.min(1, tower.hp / maxHp));
      const w = geom.r * 1.1, h = Math.max(2, geom.r * 0.14), bx = p.x - w / 2, by = p.y - geom.r * 0.9;
      this.ctx.fillStyle = "rgba(0,0,0,0.55)";
      this.ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
      this.ctx.fillStyle = frac > 0.5 ? "#6fcf7e" : frac > 0.25 ? "#e0c060" : "#d9776b";
      this.ctx.fillRect(bx, by, w * frac, h);
    }
  }

  drawEnemy(enemy, snapshot, geom) {
    const p = this.enemyPoint(enemy, snapshot, geom);
    const sprite = this.spriteFor("enemies", enemy.typeId);
    if (sprite) {
      const s = geom.r * 0.95;
      this.ctx.drawImage(sprite.img, sprite.sx, sprite.sy, sprite.sw, sprite.sh, p.x - s / 2, p.y - s / 2, s, s);
    } else {
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, geom.r * 0.38, 0, Math.PI * 2);
      this.ctx.fillStyle = this.enemyColor(enemy.typeId);
      this.ctx.fill();
      this.ctx.strokeStyle = "#111";
      this.ctx.stroke();
    }
    const hpRatio = Math.max(0, enemy.hp / enemy.maxHp);
    this.ctx.fillStyle = "#1b1d18";
    this.ctx.fillRect(p.x - geom.r * 0.45, p.y - geom.r * 0.62, geom.r * 0.9, 4);
    this.ctx.fillStyle = hpRatio > 0.35 ? this.theme.tower : this.theme.danger;
    this.ctx.fillRect(p.x - geom.r * 0.45, p.y - geom.r * 0.62, geom.r * 0.9 * hpRatio, 4);
  }

  enemyPoint(enemy, snapshot, geom) {
    const route = enemy.routeId ? snapshot.pathRoutes?.find((item) => item.id === enemy.routeId)?.pathCenterline : snapshot.pathCenterline;
    const track = route?.length ? route : snapshot.pathCenterline;
    if (!track?.length) return this.center(snapshot.spawnCoord || { q: 0, r: 0 }, geom);
    // Interpolate between hex centers by the fractional pathProgress the engine advances each tick,
    // so enemies glide instead of teleporting tile-to-tile (matches the phaser renderer).
    const prog = Math.max(0, Math.min(track.length - 1, enemy.pathProgress));
    const i = Math.floor(prog);
    const f = prog - i;
    const a = this.center(track[i], geom);
    const b = this.center(track[Math.min(i + 1, track.length - 1)], geom);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  drawHex(x, y, r, fill) {
    this.ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.closePath();
    this.ctx.fillStyle = fill;
    this.ctx.fill();
    this.ctx.strokeStyle = "rgba(255,255,255,.12)";
    this.ctx.stroke();
  }

  tileColor(terrain) {
    return this.theme[terrain] ?? this.theme.buildable;
  }

  enemyColor(id) {
    const value = this.content.enemies?.[id]?.color ?? 0xaaaaaa;
    return "#" + Number(value).toString(16).padStart(6, "0");
  }
}

function assetUrl(assetBase, src) {
  const value = String(src ?? "");
  if (/^(?:data:|blob:|https?:)/i.test(value)) return value;
  return assetBase + value.split("/").map(encodeURIComponent).join("/");
}
