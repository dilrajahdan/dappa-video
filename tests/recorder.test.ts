import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecorder } from "../src/recorder";

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: MediaStream, options: MediaRecorderOptions) {
    this.mimeType = options.mimeType ?? "video/webm";
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded frames"]) });
    this.onstop?.();
  }
}
function fakeStream() {
  const track = {
    onended: null as (() => void) | null,
    readyState: "live",
    stop: vi.fn(),
  };
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}
beforeEach(() => {
  vi.useFakeTimers();
  FakeMediaRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:take"),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("recording lifecycle", () => {
  it("counts down before recording, pauses time and produces a reviewable take", async () => {
    const r = createRecorder();
    const { stream, track } = fakeStream();
    await r.start(async () => stream);
    expect(r.getSnapshot()).toMatchObject({
      status: "countdown",
      countdown: 3,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(r.getSnapshot().status).toBe("recording");
    await vi.advanceTimersByTimeAsync(1200);
    r.pause();
    await vi.advanceTimersByTimeAsync(5000);
    r.resume();
    await vi.advanceTimersByTimeAsync(1000);
    r.stop();
    expect(r.getSnapshot()).toMatchObject({
      status: "ready",
      durationSeconds: 2,
      previewUrl: "blob:take",
    });
    expect(r.getSnapshot().blob?.size).toBeGreaterThan(0);
    expect(track.stop).toHaveBeenCalledOnce();
    r.reset();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:take");
    expect(r.getSnapshot().status).toBe("idle");
  });
  it("releases a permission result that arrives after reset", async () => {
    const r = createRecorder();
    const { stream, track } = fakeStream();
    let resolve!: (s: MediaStream) => void;
    const pending = r.start(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    r.reset();
    resolve(stream);
    expect(await pending).toBe(false);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });
  it("cancel during countdown never starts a take", async () => {
    const r = createRecorder();
    const { stream, track } = fakeStream();
    await r.start(async () => stream);
    r.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(r.getSnapshot().status).toBe("idle");
    expect(track.stop).toHaveBeenCalledOnce();
    expect(FakeMediaRecorder.instances[0]?.state).toBe("inactive");
  });
  it("browser Stop sharing cancels countdown and finalises active recording", async () => {
    const r = createRecorder();
    const first = fakeStream();
    await r.start(async () => first.stream);
    first.track.onended?.();
    expect(r.getSnapshot().status).toBe("idle");
    const second = fakeStream();
    await r.start(async () => second.stream);
    await vi.advanceTimersByTimeAsync(3000);
    second.track.onended?.();
    expect(r.getSnapshot().status).toBe("ready");
    r.destroy();
  });
  it("keeps the previous take when replacement permission is denied", async () => {
    const r = createRecorder({ countdownSeconds: 0 });
    await r.start(async () => fakeStream().stream);
    r.stop();
    const take = r.getSnapshot().blob;
    expect(
      await r.start(async () => {
        throw new Error("Permission denied");
      }),
    ).toBe(false);
    expect(r.getSnapshot()).toMatchObject({
      status: "error",
      error: "Permission denied",
      blob: take,
    });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    r.destroy();
  });
  it("ignores double starts and stops at the configured active-time limit", async () => {
    const r = createRecorder({ countdownSeconds: 0, maxDurationSeconds: 2 });
    await r.start(async () => fakeStream().stream);
    const acquire = vi.fn();
    expect(await r.start(acquire)).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2200);
    expect(r.getSnapshot().status).toBe("ready");
    r.destroy();
  });
  it("destroy discards in-flight recording and releases all resources", async () => {
    const r = createRecorder({ countdownSeconds: 0 });
    const { stream, track } = fakeStream();
    await r.start(async () => stream);
    r.destroy();
    r.destroy();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(r.getSnapshot().blob).toBeNull();
    expect(await r.start(async () => stream)).toBe(false);
  });
  it("reports recorder errors and supports retry", async () => {
    const r = createRecorder({ countdownSeconds: 0 });
    const { stream, track } = fakeStream();
    await r.start(async () => stream);
    FakeMediaRecorder.instances[0]?.onerror?.();
    expect(r.getSnapshot().status).toBe("error");
    expect(track.stop).toHaveBeenCalledOnce();
    await r.start(async () => fakeStream().stream);
    expect(r.getSnapshot().status).toBe("recording");
    r.destroy();
  });
  it("preserves the actual MIME type for MP4-only browsers", async () => {
    const supported = vi
      .spyOn(FakeMediaRecorder, "isTypeSupported")
      .mockImplementation((...args: unknown[]) => args[0] === "video/mp4");
    const r = createRecorder({ countdownSeconds: 0 });
    await r.start(async () => fakeStream().stream);
    r.stop();
    expect(r.getSnapshot().mimeType).toBe("video/mp4");
    r.destroy();
    supported.mockRestore();
  });
});
