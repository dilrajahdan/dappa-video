import { beepGo, beepTick, primeBeeper } from "./beeper.js";
import { startCountdown } from "./countdown.js";

export type RecorderStatus =
  | "idle"
  | "acquiring"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
  | "ready"
  | "error";
export type RecorderSnapshot = Readonly<{
  status: RecorderStatus;
  countdown: number;
  durationSeconds: number;
  /** Exact active recording time so hosts can round their own way. */
  activeMilliseconds: number;
  blob: Blob | null;
  previewUrl: string | null;
  mimeType: string | null;
  error: string | null;
}>;
/** A finished take with bytes. Delivered through onTake even when reset or destroy ended it. */
export type FinishedTake = Readonly<{
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  activeMilliseconds: number;
}>;
export type RecorderOptions = {
  countdownSeconds?: number;
  audioCues?: boolean;
  maxDurationSeconds?: number;
  videoBitsPerSecond?: number;
  /** Omitted leaves the browser default. */
  audioBitsPerSecond?: number;
  mimeTypes?: readonly string[];
  /**
   * Called once per finished take with bytes: after a normal stop, and also when reset() or
   * destroy() (for example a component unmount) interrupts an active recording. Hosts that
   * keep takes durable should stash here; the snapshot never shows an interrupted take.
   */
  onTake?: (take: FinishedTake) => void;
};
export const INITIAL_RECORDER_SNAPSHOT: RecorderSnapshot = Object.freeze({
  status: "idle",
  countdown: 0,
  durationSeconds: 0,
  activeMilliseconds: 0,
  blob: null,
  previewUrl: null,
  mimeType: null,
  error: null,
});
const ACTIVE = new Set<RecorderStatus>([
  "acquiring",
  "countdown",
  "recording",
  "paused",
  "stopping",
]);

/** Owns streams returned by acquire, including late permission results. No storage or UI. */
export function createRecorder(options: RecorderOptions = {}) {
  const countdownSeconds = options.countdownSeconds ?? 3;
  if (
    !Number.isInteger(countdownSeconds) ||
    countdownSeconds < 0 ||
    countdownSeconds > 60
  )
    throw new RangeError("Countdown must be a whole number from 0 to 60.");
  if (
    options.maxDurationSeconds !== undefined &&
    (!Number.isFinite(options.maxDurationSeconds) ||
      options.maxDurationSeconds <= 0)
  )
    throw new RangeError("Maximum duration must be a positive finite number.");
  let snapshot = INITIAL_RECORDER_SNAPSHOT;
  const listeners = new Set<() => void>();
  let generation = 0;
  let destroyed = false;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let cancelCountdown: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let activeSince = 0;
  let elapsedMs = 0;
  let chunks: Blob[] = [];

  function publish(patch: Partial<RecorderSnapshot>) {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  }
  function stopTracks(source: MediaStream) {
    for (const track of source.getTracks()) {
      track.onended = null;
      track.stop();
    }
  }
  function deliver(blob: Blob, mimeType: string, ms: number) {
    if (!blob.size) return;
    options.onTake?.(
      Object.freeze({
        blob,
        mimeType,
        durationSeconds: Math.floor(ms / 1000),
        activeMilliseconds: ms,
      }),
    );
  }
  /**
   * Release everything. With `deliverTake`, an active recording is stopped gracefully and its
   * bytes go to onTake once the browser flushes them, so an unmount does not lose the take.
   */
  function cleanup(deliverTake = false) {
    cancelCountdown?.();
    cancelCountdown = undefined;
    clearInterval(timer);
    timer = undefined;
    if (recorder) {
      const instance = recorder;
      const active =
        snapshot.status === "recording" || snapshot.status === "paused";
      const finalMs = active ? activeMs() : elapsedMs;
      const late = deliverTake && active && instance.state !== "inactive";
      const held = chunks;
      const mimeType = instance.mimeType;
      recorder = null;
      instance.onerror = null;
      if (late) {
        instance.ondataavailable = (event) => {
          if (event.data.size > 0) held.push(event.data);
        };
        instance.onstop = () => {
          instance.ondataavailable = null;
          instance.onstop = null;
          deliver(new Blob(held, { type: mimeType }), mimeType, finalMs);
        };
      } else {
        instance.ondataavailable = null;
        instance.onstop = null;
      }
      if (instance.state !== "inactive") {
        try {
          instance.stop();
        } catch {
          /* Already stopped. */
        }
      }
    }
    chunks = [];
    if (stream) {
      stopTracks(stream);
      stream = null;
    }
  }
  function fail(error: unknown) {
    generation++;
    cleanup();
    publish({
      status: "error",
      countdown: 0,
      error:
        error instanceof Error
          ? error.message
          : "Recording failed. Please try again.",
    });
  }
  function activeMs() {
    return (
      elapsedMs +
      (snapshot.status === "recording" ? Date.now() - activeSince : 0)
    );
  }
  function stop() {
    if (destroyed) return;
    if (snapshot.status === "acquiring" || snapshot.status === "countdown") {
      generation++;
      cleanup();
      publish({
        status: snapshot.blob ? "ready" : "idle",
        countdown: 0,
        error: null,
      });
    } else if (
      recorder &&
      (snapshot.status === "recording" || snapshot.status === "paused")
    ) {
      elapsedMs = activeMs();
      clearInterval(timer);
      timer = undefined;
      publish({
        status: "stopping",
        durationSeconds: Math.floor(elapsedMs / 1000),
        activeMilliseconds: elapsedMs,
      });
      try {
        recorder.stop();
      } catch (error) {
        fail(error);
      }
    }
  }
  async function start(acquire: () => Promise<MediaStream>): Promise<boolean> {
    if (destroyed || ACTIVE.has(snapshot.status)) return false;
    if (typeof MediaRecorder === "undefined") {
      fail(new Error("Video recording is not supported in this browser."));
      return false;
    }
    if (options.audioCues) primeBeeper();
    const mine = ++generation;
    publish({ status: "acquiring", error: null, countdown: 0 });
    try {
      const source = await acquire();
      if (destroyed || mine !== generation) {
        stopTracks(source);
        return false;
      }
      stream = source;
      const videoTrack = source.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState === "ended")
        throw new Error("The selected video source is no longer available.");
      videoTrack.onended = stop;
      const mimeType = (
        options.mimeTypes ?? [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
          "video/mp4",
        ]
      ).find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType)
        throw new Error("This browser has no supported recording format.");
      const instance = new MediaRecorder(source, {
        mimeType,
        videoBitsPerSecond: options.videoBitsPerSecond ?? 2_500_000,
        ...(options.audioBitsPerSecond !== undefined
          ? { audioBitsPerSecond: options.audioBitsPerSecond }
          : {}),
      });
      recorder = instance;
      const takeChunks: Blob[] = [];
      chunks = takeChunks;
      instance.ondataavailable = (event) => {
        if (mine === generation && event.data.size > 0)
          takeChunks.push(event.data);
      };
      instance.onerror = () => {
        if (mine === generation)
          fail(
            new Error("Recording stopped unexpectedly. Please record again."),
          );
      };
      instance.onstop = () => {
        if (destroyed || mine !== generation) return;
        if (snapshot.status === "recording") elapsedMs = activeMs();
        const blob = new Blob(takeChunks, {
          type: instance.mimeType || mimeType,
        });
        cleanup();
        if (!blob.size) {
          fail(new Error("No video was captured. Please record again."));
          return;
        }
        deliver(blob, blob.type, elapsedMs);
        publish({
          status: "ready",
          blob,
          previewUrl: URL.createObjectURL(blob),
          mimeType: blob.type,
          durationSeconds: Math.floor(elapsedMs / 1000),
          activeMilliseconds: elapsedMs,
          countdown: 0,
          error: null,
        });
      };
      publish({ status: "countdown", countdown: countdownSeconds });
      cancelCountdown = startCountdown({
        seconds: countdownSeconds,
        onTick: (remaining) => {
          if (mine !== generation || destroyed) return;
          publish({ countdown: remaining });
          if (remaining > 0 && options.audioCues) beepTick();
        },
        onComplete: () => {
          if (mine !== generation || destroyed) return;
          try {
            instance.start(1000);
            if (snapshot.previewUrl) URL.revokeObjectURL(snapshot.previewUrl);
            activeSince = Date.now();
            elapsedMs = 0;
            publish({
              status: "recording",
              blob: null,
              previewUrl: null,
              mimeType: null,
              durationSeconds: 0,
              activeMilliseconds: 0,
              countdown: 0,
            });
            if (options.audioCues) beepGo();
            timer = setInterval(() => {
              if (snapshot.status !== "recording") return;
              const elapsed = activeMs();
              publish({
                durationSeconds: Math.floor(elapsed / 1000),
                activeMilliseconds: elapsed,
              });
              if (
                options.maxDurationSeconds !== undefined &&
                elapsed >= options.maxDurationSeconds * 1000
              )
                stop();
            }, 200);
          } catch (error) {
            fail(error);
          }
        },
      });
      return snapshot.status !== "error";
    } catch (error) {
      if (mine === generation && !destroyed) fail(error);
      return false;
    }
  }
  function reset() {
    generation++;
    cleanup(true);
    if (snapshot.previewUrl) URL.revokeObjectURL(snapshot.previewUrl);
    elapsedMs = 0;
    publish(INITIAL_RECORDER_SNAPSHOT);
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    stop,
    reset,
    pause() {
      if (!recorder || snapshot.status !== "recording") return;
      try {
        recorder.pause();
        elapsedMs = activeMs();
        publish({
          status: "paused",
          durationSeconds: Math.floor(elapsedMs / 1000),
          activeMilliseconds: elapsedMs,
        });
      } catch (error) {
        fail(error);
      }
    },
    resume() {
      if (!recorder || snapshot.status !== "paused") return;
      try {
        recorder.resume();
        activeSince = Date.now();
        publish({ status: "recording" });
      } catch (error) {
        fail(error);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      reset();
      listeners.clear();
    },
  };
}
export type Recorder = ReturnType<typeof createRecorder>;
