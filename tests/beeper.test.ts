import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetBeeperForTests,
  beepGo,
  beepTick,
  primeBeeper,
} from "../src/beeper";

// The audible 3-2-1. It exists for screen+camera mode, where the founder is on the tab they're
// walking through and physically cannot see the on-screen countdown. The contract worth pinning:
// it makes a distinguishable noise when it can, and is silent-but-harmless when it can't: an
// audio failure must never take a recording down with it.

type FakeNode = {
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  type: string;
  frequency: { value: number };
};

function makeCtx(state: AudioContextState = "running") {
  const oscillators: FakeNode[] = [];
  const gains: Array<{
    gain: {
      setValueAtTime: ReturnType<typeof vi.fn>;
      exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
  }> = [];
  const ctx = {
    state,
    currentTime: 0,
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    destination: {},
    createOscillator: vi.fn(() => {
      const node: FakeNode = {
        connect: vi.fn(() => ({ connect: vi.fn() })),
        start: vi.fn(),
        stop: vi.fn(),
        type: "",
        frequency: { value: 0 },
      };
      oscillators.push(node);
      return node;
    }),
    createGain: vi.fn(() => {
      const node = {
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(() => ({ connect: vi.fn() })),
      };
      gains.push(node);
      return node;
    }),
  };
  return { ctx, oscillators, gains };
}

let made: ReturnType<typeof makeCtx>;

beforeEach(() => {
  __resetBeeperForTests();
  made = makeCtx();
  vi.stubGlobal(
    "AudioContext",
    vi.fn(function FakeAudioContext() {
      return made.ctx;
    }) as unknown as typeof AudioContext,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBeeperForTests();
});

describe("countdown beep", () => {
  it("plays a tone for a tick", () => {
    beepTick();
    expect(made.oscillators).toHaveLength(1);
    expect(made.oscillators[0].start).toHaveBeenCalled();
    expect(made.oscillators[0].stop).toHaveBeenCalled();
  });

  it("uses a HIGHER pitch for go than for a tick: the two must be tellable apart", () => {
    beepTick();
    beepGo();
    const [tick, go] = made.oscillators;
    expect(go.frequency.value).toBeGreaterThan(tick.frequency.value);
  });

  it("uses a sine so it reads as a chime, not an alarm", () => {
    beepTick();
    expect(made.oscillators[0].type).toBe("sine");
  });

  it("ramps the gain instead of hard-starting: a squared-off sine clicks", () => {
    beepTick();
    const gain = made.gains[0].gain;
    expect(gain.setValueAtTime).toHaveBeenCalled();
    expect(gain.exponentialRampToValueAtTime).toHaveBeenCalled();
  });

  it("reuses one AudioContext across beeps rather than leaking one per tick", () => {
    beepTick();
    beepTick();
    beepGo();
    expect(AudioContext).toHaveBeenCalledTimes(1);
  });

  it("stays silent while the context is suspended (no user gesture yet)", () => {
    __resetBeeperForTests();
    made = makeCtx("suspended");
    beepTick();
    expect(made.oscillators).toHaveLength(0);
  });

  it("primeBeeper resumes a suspended context so the countdown can be heard", () => {
    __resetBeeperForTests();
    made = makeCtx("suspended");
    primeBeeper();
    expect(made.ctx.resume).toHaveBeenCalled();
  });

  it("is a silent no-op when the browser has no WebAudio: never throws", () => {
    __resetBeeperForTests();
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    expect(() => {
      beepTick();
      beepGo();
      primeBeeper();
    }).not.toThrow();
  });

  it("swallows a construction failure: audio must never break a recording", () => {
    __resetBeeperForTests();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function Boom() {
        throw new Error("no audio device");
      }) as unknown as typeof AudioContext,
    );
    expect(() => beepTick()).not.toThrow();
  });

  it("swallows a mid-play node failure", () => {
    __resetBeeperForTests();
    made = makeCtx();
    made.ctx.createOscillator = vi.fn(() => {
      throw new Error("node limit");
    }) as unknown as typeof made.ctx.createOscillator;
    expect(() => beepTick()).not.toThrow();
  });
});
