import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startCountdown } from "../src/countdown";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("recording countdown", () => {
  it("shows 3, 2, 1 before completion and completes only once", async () => {
    const events: string[] = [];
    startCountdown({
      onTick: (n) => events.push(String(n)),
      onComplete: () => events.push("record"),
    });
    expect(events).toEqual(["3"]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(events).toEqual(["3", "2", "1"]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(events).toEqual(["3", "2", "1", "0", "record"]);
  });

  it("cancels a take without a late start and allows a fresh countdown", async () => {
    const tick = vi.fn();
    const complete = vi.fn();
    const cancel = startCountdown({ onTick: tick, onComplete: complete });
    await vi.advanceTimersByTimeAsync(1000);
    cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick.mock.calls.flat()).toEqual([3, 2]);
    expect(complete).not.toHaveBeenCalled();
    startCountdown({ onTick: tick, onComplete: complete });
    await vi.advanceTimersByTimeAsync(3000);
    expect(tick.mock.calls.flat()).toEqual([3, 2, 3, 2, 1, 0]);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("uses elapsed time when the page delays a timer", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const tick = vi.fn();
    const complete = vi.fn();
    startCountdown({ onTick: tick, onComplete: complete });
    now = 5000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick.mock.calls.flat()).toEqual([3, 0]);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("honours an abort from the final tick", async () => {
    const controller = new AbortController();
    const complete = vi.fn();
    startCountdown({
      signal: controller.signal,
      onTick: (n) => {
        if (n === 0) controller.abort();
      },
      onComplete: complete,
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(complete).not.toHaveBeenCalled();
  });

  it("does nothing for an already-aborted session", () => {
    const controller = new AbortController();
    controller.abort();
    const tick = vi.fn();
    startCountdown({ signal: controller.signal, onTick: tick });
    expect(tick).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
