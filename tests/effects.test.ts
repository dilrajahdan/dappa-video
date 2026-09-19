import { describe, expect, it, vi } from "vitest";
import { createFrameProcessor } from "../src/effects";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

function harness() {
  const job = deferred<string>();
  const process = vi.fn(() => job.promise);
  const onResult = vi.fn();
  const onError = vi.fn();
  const releaseInput = vi.fn();
  const releaseOutput = vi.fn();
  const runner = createFrameProcessor<number, string>({
    process,
    onResult,
    onError,
    releaseInput,
    releaseOutput,
  });
  return {
    runner,
    job,
    process,
    onResult,
    onError,
    releaseInput,
    releaseOutput,
  };
}

describe("optional effects do not accumulate frame work", () => {
  it("skips and releases incoming frames while one slow job is in flight", async () => {
    const h = harness();
    expect(h.runner.submit(1)).toBe(true);
    for (let frame = 2; frame <= 100; frame += 1)
      expect(h.runner.submit(frame)).toBe(false);
    await settle();
    expect(h.process).toHaveBeenCalledOnce();
    expect(h.releaseInput).toHaveBeenCalledTimes(99);
    h.job.resolve("mask-1");
    await settle();
    expect(h.onResult).toHaveBeenCalledWith("mask-1");
    expect(h.releaseInput).toHaveBeenLastCalledWith(1);
    expect(h.runner.stats()).toEqual({
      submitted: 100,
      processed: 1,
      skipped: 99,
      errors: 0,
      busy: false,
    });
    h.runner.destroy();
    expect(h.releaseOutput).toHaveBeenCalledWith("mask-1");
  });

  it("does not publish a late result or start parallel work across pause/resume", async () => {
    const h = harness();
    h.runner.submit(1);
    await settle();
    h.runner.pause();
    h.runner.resume();
    expect(h.runner.submit(2)).toBe(false);
    h.job.resolve("old-mask");
    await settle();
    expect(h.onResult).not.toHaveBeenCalled();
    expect(h.releaseOutput).toHaveBeenCalledWith("old-mask");
    const next = deferred<string>();
    h.process.mockReturnValueOnce(next.promise);
    expect(h.runner.submit(3)).toBe(true);
    await settle();
    next.resolve("new-mask");
    await settle();
    expect(h.onResult).toHaveBeenCalledWith("new-mask");
    h.runner.destroy();
  });

  it("releases a result that arrives after teardown without publishing it", async () => {
    const h = harness();
    h.runner.submit(1);
    await settle();
    h.runner.destroy();
    h.runner.destroy();
    h.job.resolve("late-mask");
    await settle();
    expect(h.onResult).not.toHaveBeenCalled();
    expect(h.releaseOutput).toHaveBeenCalledExactlyOnceWith("late-mask");
    expect(h.runner.submit(2)).toBe(false);
    expect(h.releaseInput).toHaveBeenCalledTimes(2);
  });

  it("reports an inference failure and permits the next frame", async () => {
    const h = harness();
    h.runner.submit(1);
    await settle();
    h.job.reject(new Error("worker failed"));
    await settle();
    expect(h.onError).toHaveBeenCalledOnce();
    expect(h.runner.stats().busy).toBe(false);
    h.process.mockResolvedValueOnce("recovered");
    expect(h.runner.submit(2)).toBe(true);
    await settle();
    expect(h.onResult).toHaveBeenCalledWith("recovered");
    h.runner.destroy();
  });

  it("does not start a worker job if destroyed before dispatch", async () => {
    const h = harness();
    h.runner.submit(1);
    h.runner.destroy();
    await settle();
    expect(h.process).not.toHaveBeenCalled();
    expect(h.releaseInput).toHaveBeenCalledExactlyOnceWith(1);
    expect(h.onError).not.toHaveBeenCalled();
  });
});
