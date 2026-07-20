import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudioPlayer } from "./audio.mjs";

const originalAudioContext = globalThis.AudioContext;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalAudioContext === undefined) delete globalThis.AudioContext;
  else globalThis.AudioContext = originalAudioContext;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function installAudioHarness() {
  const contexts = [];
  class FakeAudioContext {
    constructor() {
      this.state = "running";
      this.currentTime = 0;
      this.destination = {};
      this.gains = [];
      this.sources = [];
      contexts.push(this);
    }
    createGain() {
      const gain = { gain: { value: 0 }, connect: vi.fn() };
      this.gains.push(gain);
      return gain;
    }
    createBufferSource() {
      const source = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), loop: false, buffer: null, onended: null };
      this.sources.push(source);
      return source;
    }
    decodeAudioData = vi.fn(async () => ({ decoded: true }));
    resume = vi.fn(async () => { this.state = "running"; });
    suspend = vi.fn(async () => { this.state = "suspended"; });
  }
  globalThis.AudioContext = FakeAudioContext;
  globalThis.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  return contexts;
}

describe("TowerForgeAudio music", () => {
  it("loads, loops, switches, and independently mixes mission music", async () => {
    const contexts = installAudioHarness();
    const player = createAudioPlayer({
      volume: 0.5,
      musicVolume: 0.35,
      assetBase: "/project-file/",
      audio: {
        musicTracks: {
          frontier: { src: "assets/music/frontier loop.ogg", volume: 0.6 },
          boss: { src: "assets/music/boss.ogg", volume: 0.8 }
        }
      }
    });

    player.selectMusic("frontier");
    player.setEnabled(true);
    expect(contexts).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    player.resume();
    await vi.waitFor(() => expect(contexts[0].sources).toHaveLength(1));
    const ctx = contexts[0];
    const frontier = ctx.sources[0];
    expect(globalThis.fetch).toHaveBeenCalledWith("/project-file/assets/music/frontier%20loop.ogg");
    expect(frontier.loop).toBe(true);
    expect(frontier.start).toHaveBeenCalledOnce();
    expect(ctx.gains[2].gain.value).toBe(0.6);

    player.setVolumes(0.2, 0.7);
    expect(ctx.gains[0].gain.value).toBe(0.2);
    expect(ctx.gains[1].gain.value).toBe(0.7);

    player.selectMusic("boss");
    await vi.waitFor(() => expect(ctx.sources).toHaveLength(2));
    expect(frontier.stop).toHaveBeenCalledOnce();
    expect(ctx.sources[1].loop).toBe(true);
  });

  it("does not start a source when the track request fails", async () => {
    const contexts = installAudioHarness();
    globalThis.fetch = vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }));
    const player = createAudioPlayer({ audio: { musicTracks: { missing: { src: "assets/music/missing.ogg" } } } });
    player.selectMusic("missing");
    player.resume();
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());
    expect(contexts[0].sources).toHaveLength(0);
  });
});
