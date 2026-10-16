// Animated email previews: the first seconds of a video as a looping GIF, poster first.
// Only frame sampling touches the DOM. Encoding lives in ./gif and is pure.

import { encodeWithinBudget, type GifFrame } from "./gif.js";

export {
  dropAlternateFrames,
  encodeGif,
  encodeWithinBudget,
  type GifBudgetOptions,
  type GifBudgetResult,
  type GifEncodeOptions,
  type GifFrame,
  lzwEncode,
  quantize,
  resizeRgba,
} from "./gif.js";

/** Any source of frames. A decoded `<video>` is wrapped in one by `videoFrameSource`. */
export type FrameSource = {
  width: number;
  height: number;
  /** Seconds, when known. Recorder WebM files often report none. */
  duration?: number;
  frameAt: (seconds: number) => Promise<CanvasImageSource>;
};

export type PreviewGifOptions = {
  /** Seconds of video to animate, from the start. Default 2.5. */
  durationSeconds?: number;
  /** Default 10. */
  fps?: number;
  /** Never upscales. Default 480, the email image width. */
  maxWidth?: number;
  /** Default 800,000 bytes. */
  maxBytes?: number;
  /** Default 256. */
  maxColors?: number;
  /** Default "none", which keeps faces clean. */
  dither?: "none" | "ordered";
  /** Same shape as the thumbnail overlay, so one play-button function serves both. */
  drawOverlay?: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ) => void;
  /** Draw the overlay on every frame (default) or only the first. */
  overlayOn?: "all" | "first";
  /**
   * Frame 1, which Outlook desktop shows alone. "poster" (default) uses the frame at
   * `posterSeconds`. Pass your own image to match an existing poster.jpg exactly.
   */
  firstFrame?: "poster" | "none" | CanvasImageSource;
  /** Default: one second in, or half the video when it is shorter. */
  posterSeconds?: number;
  /** How long frame 1 holds. Default 0.6 seconds. */
  firstFrameSeconds?: number;
  /** Extra time on the last frame before the loop restarts. Default 0. */
  holdLastSeconds?: number;
  /** Whole-job limit. Default 20 seconds. */
  timeoutMs?: number;
};

export type PreviewGifFailure =
  | "unsupported"
  | "undecodable"
  | "timeout"
  | "over-budget"
  | "error";

export type PreviewGifResult =
  | {
      ok: true;
      blob: Blob;
      width: number;
      height: number;
      frames: number;
      bytes: number;
      /** Size-budget steps that fired, in order. Empty when the first encode fitted. */
      steps: string[];
    }
  | { ok: false; reason: PreviewGifFailure; message: string };

export function previewDimensions(
  width: number,
  height: number,
  maxWidth = 480,
): { width: number; height: number } {
  if (![width, height, maxWidth].every((v) => Number.isFinite(v) && v >= 1)) {
    throw new RangeError(
      "Preview dimensions must be finite and at least one pixel.",
    );
  }
  const scale = Math.min(1, maxWidth / width);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

class PreviewError extends Error {
  constructor(
    readonly reason: PreviewGifFailure,
    message: string,
  ) {
    super(message);
  }
}

/** Seeks a decoded video for each frame. Restore or reuse the element afterwards. */
export function videoFrameSource(
  video: HTMLVideoElement,
  options: { seekTimeoutMs?: number } = {},
): FrameSource {
  const seekTimeoutMs = options.seekTimeoutMs ?? 5000;
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    duration:
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : undefined,
    frameAt: (seconds) =>
      new Promise<CanvasImageSource>((resolve, reject) => {
        if (
          video.readyState >= 2 &&
          Math.abs(video.currentTime - seconds) < 0.001
        ) {
          resolve(video);
          return;
        }
        const done = (error?: Error) => {
          clearTimeout(timer);
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
          if (error) reject(error);
          else resolve(video);
        };
        const onSeeked = () => done();
        const onError = () =>
          done(new Error("The video failed while seeking."));
        const timer = setTimeout(
          () => done(new Error(`Seeking to ${seconds}s timed out.`)),
          seekTimeoutMs,
        );
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", onError);
        video.currentTime = seconds;
      }),
  };
}

function isVideo(source: unknown): source is HTMLVideoElement {
  return (
    typeof HTMLVideoElement !== "undefined" &&
    source instanceof HTMLVideoElement
  );
}

/**
 * Builds a looping GIF from the start of a video. Never throws: on any failure it
 * returns `{ ok: false }` and the caller keeps its still poster.
 */
export async function createPreviewGif(
  source: HTMLVideoElement | FrameSource,
  options: PreviewGifOptions = {},
): Promise<PreviewGifResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new PreviewError("timeout", `Preview took over ${timeoutMs} ms.`),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([build(source, options), timeout]);
  } catch (error) {
    if (error instanceof PreviewError) {
      return { ok: false, reason: error.reason, message: error.message };
    }
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function build(
  input: HTMLVideoElement | FrameSource,
  options: PreviewGifOptions,
): Promise<PreviewGifResult> {
  let restoreTime: (() => void) | undefined;
  let source: FrameSource;
  if (isVideo(input)) {
    if (!input.videoWidth || !input.videoHeight || input.readyState < 1) {
      throw new PreviewError(
        "undecodable",
        "The video has no decoded frames yet.",
      );
    }
    const original = input.currentTime;
    restoreTime = () => {
      input.currentTime = original;
    };
    source = videoFrameSource(input);
  } else {
    source = input;
  }
  try {
    return await sampleAndEncode(source, options);
  } finally {
    restoreTime?.();
  }
}

async function sampleAndEncode(
  source: FrameSource,
  options: PreviewGifOptions,
): Promise<PreviewGifResult> {
  const fps = options.fps ?? 10;
  const durationSeconds = options.durationSeconds ?? 2.5;
  if (!(fps > 0 && fps <= 50) || !(durationSeconds > 0)) {
    throw new PreviewError(
      "error",
      "fps must be 1 to 50 and the duration positive.",
    );
  }
  let size: { width: number; height: number };
  try {
    size = previewDimensions(
      source.width,
      source.height,
      options.maxWidth ?? 480,
    );
  } catch {
    throw new PreviewError("undecodable", "The video reports no frame size.");
  }
  const { width, height } = size;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new PreviewError("unsupported", "Canvas 2D is unavailable.");

  const known = source.duration;
  const span = known ? Math.min(durationSeconds, known) : durationSeconds;
  const delayCs = Math.round(100 / fps);
  const count = Math.max(1, Math.round(span * fps));
  const overlayAll = (options.overlayOn ?? "all") === "all";

  const grab = async (
    at: number | CanvasImageSource,
    overlay: boolean,
  ): Promise<Uint8ClampedArray> => {
    let image: CanvasImageSource;
    if (typeof at === "number") {
      try {
        image = await source.frameAt(at);
      } catch (error) {
        throw new PreviewError(
          "undecodable",
          `Could not read the frame at ${at}s: ${error instanceof Error ? error.message : error}`,
        );
      }
    } else {
      image = at;
    }
    ctx.drawImage(image, 0, 0, width, height);
    if (overlay) options.drawOverlay?.(ctx, width, height);
    return new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data);
  };

  const frames: GifFrame[] = [];
  const first = options.firstFrame ?? "poster";
  if (first !== "none") {
    const posterSeconds =
      options.posterSeconds ?? Math.min(1, (known ?? durationSeconds * 2) / 2);
    frames.push({
      pixels: await grab(first === "poster" ? posterSeconds : first, true),
      delayCs: Math.round((options.firstFrameSeconds ?? 0.6) * 100),
      hold: true,
    });
  }
  for (let i = 0; i < count; i++) {
    const t = Math.round((i / fps) * 1000) / 1000;
    frames.push({
      pixels: await grab(t, overlayAll || (first === "none" && i === 0)),
      delayCs,
    });
  }
  const holdLast = Math.round((options.holdLastSeconds ?? 0) * 100);
  if (holdLast > 0) frames[frames.length - 1].delayCs += holdLast;

  // Let the page breathe before the synchronous encode.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const result = encodeWithinBudget(frames, {
    width,
    height,
    maxBytes: options.maxBytes ?? 800_000,
    maxColors: options.maxColors,
    dither: options.dither,
  });
  if (!result.ok) {
    throw new PreviewError(
      "over-budget",
      `Smallest attempt was ${result.bytes} bytes after ${result.steps.join(", ")}.`,
    );
  }
  const blob = new Blob([result.gif as BlobPart], { type: "image/gif" });
  return {
    ok: true,
    blob,
    width: result.width,
    height: result.height,
    frames: result.frames,
    bytes: result.bytes,
    steps: result.steps,
  };
}
