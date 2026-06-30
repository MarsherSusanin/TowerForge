// audio.mjs — zero-dependency procedural SFX for the player and Studio playtest.
//
// Synthesizes every sound with the Web Audio API (no asset files), driven by engine event types
// from a snapshot's `lastEvents`. Events are coalesced per frame so rapid fire doesn't turn into a
// cacophony. The AudioContext is created lazily and resumed on the first user gesture.

export function createAudioPlayer(options = {}) {
  return new MyceliumAudio(options);
}

export class MyceliumAudio {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.volume = typeof options.volume === "number" ? options.volume : 0.5;
    this.ctx = null;
    this.master = null;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.enabled) this.resume();
  }

  /** Must be called from a user gesture (click/keydown) before sound can play in most browsers. */
  resume() {
    this.ensureContext();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  ensureContext() {
    if (this.ctx) return;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  /** Coalesce a frame's events into a small set of sounds and play them. */
  handleEvents(events) {
    if (!this.enabled || !events || !events.length) return;
    this.ensureContext();
    if (!this.ctx) return;
    let fired = false, hit = false, kills = 0, leak = false, pulse = false;
    for (const ev of events) {
      switch (ev.type) {
        case "towerFired": fired = true; break;
        case "enemyHit": hit = true; break;
        case "enemyKilled": kills += 1; break;
        case "enemyLeaked": leak = true; break;
        case "chagaPulse": pulse = true; break;
        case "waveStarted": this.horn(); break;
        case "victory": this.victory(); break;
        case "defeat": this.defeat(); break;
        default: break;
      }
    }
    if (fired) this.shoot();
    if (hit && !fired) this.tick();
    if (pulse) this.sweep();
    for (let i = 0; i < Math.min(kills, 3); i += 1) this.pop(i * 0.04);
    if (leak) this.thud();
  }

  // ── synth primitives ─────────────────────────────────────────────────────────
  tone({ freq = 440, type = "sine", dur = 0.12, gain = 0.25, attack = 0.005, glideTo = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env); env.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.15, gain = 0.2, freq = 1200, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1234; // deterministic pseudo-noise (no Math.random)
    for (let i = 0; i < len; i += 1) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; data[i] = ((seed / 0x3fffffff) - 1) * (1 - i / len); }
    const src = this.ctx.createBufferSource(); src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = freq;
    const env = this.ctx.createGain(); env.gain.setValueAtTime(gain, t0); env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter); filter.connect(env); env.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // ── event sounds ─────────────────────────────────────────────────────────────
  shoot() { this.tone({ freq: 720, glideTo: 360, type: "square", dur: 0.08, gain: 0.12 }); }
  tick() { this.tone({ freq: 520, type: "triangle", dur: 0.05, gain: 0.06 }); }
  pop(delay = 0) { this.tone({ freq: 380, glideTo: 760, type: "triangle", dur: 0.1, gain: 0.16, delay }); this.tone({ freq: 1180, type: "sine", dur: 0.12, gain: 0.1, delay: delay + 0.03 }); }
  thud() { this.tone({ freq: 150, glideTo: 60, type: "sine", dur: 0.28, gain: 0.32 }); this.noise({ dur: 0.18, gain: 0.12, freq: 220 }); }
  sweep() { this.noise({ dur: 0.32, gain: 0.1, freq: 900 }); this.tone({ freq: 300, glideTo: 900, type: "sine", dur: 0.3, gain: 0.08 }); }
  horn() { this.tone({ freq: 330, type: "sawtooth", dur: 0.22, gain: 0.16 }); this.tone({ freq: 440, type: "sawtooth", dur: 0.22, gain: 0.12, delay: 0.06 }); }
  victory() { [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, type: "triangle", dur: 0.32, gain: 0.2, delay: i * 0.12 })); }
  defeat() { [330, 247, 165].forEach((f, i) => this.tone({ freq: f, type: "sawtooth", dur: 0.45, gain: 0.22, delay: i * 0.16 })); }
}
