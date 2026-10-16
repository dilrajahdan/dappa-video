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

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Enlarges the camera card of a screen + camera take so the face, not the page, moves.
 * `rect` is the card in source-video pixels, border and name plate included.
 */
export type PreviewFocus = {
  rect: Rect;
  /** Card corner radius in source pixels. Default 6% of the card width. */
  radius?: number;
  /** Extra source pixels around `rect`, so a thin border comes along. Default 2. */
  pad?: number;
  /** Enlarged card width as a share of the output width. Default 0.4. */
  size?: number;
  /** Where the enlarged card sits. Default "br", bottom-right. */
  corner?: "tl" | "tr" | "bl" | "br";
  /** Gap to the frame edge, as a share of the short side. Default 0.04. */
  margin?: number;
  /** Seconds to grow from its recorded size after the poster. 0 jumps. Default 0.4. */
  easeSeconds?: number;
  /** Soft drop shadow under the card. Default true. */
  shadow?: boolean;
};

export type FocusLayout = {
  /** Area of the source video to copy. */
  source: Rect;
  /** Where it lands in the output frame. */
  dest: Rect;
  /** Output corner radius. */
  radius: number;
};

/** Ease-out from 0 to 1 over `easeSeconds`, measured from the first motion frame. */
export function focusProgress(seconds: number, easeSeconds = 0.4): number {
  if (!(easeSeconds > 0)) return 1;
  const t = Math.max(0, Math.min(1, seconds / easeSeconds));
  return 1 - (1 - t) ** 3;
}

/**
 * Pure layout for one frame: progress 0 is the card where it was recorded, 1 is the
 * enlarged card. Returns null when the rectangle misses the video, and the caller then
 * behaves as a camera-only take.
 */
export function focusLayout(
  video: { width: number; height: number },
  output: { width: number; height: number },
  focus: PreviewFocus,
  progress: number,
): FocusLayout | null {
  const { rect } = focus;
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return null;
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(video.width, rect.x + rect.w);
  const y1 = Math.min(video.height, rect.y + rect.h);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const pad = Math.max(0, focus.pad ?? 2);
  const sx = Math.max(0, x0 - pad);
  const sy = Math.max(0, y0 - pad);
  const source = {
    x: sx,
    y: sy,
    w: Math.min(video.width, x1 + pad) - sx,
    h: Math.min(video.height, y1 + pad) - sy,
  };
  const kx = output.width / video.width;
  const ky = output.height / video.height;
  const start = {
    x: source.x * kx,
    y: source.y * ky,
    w: source.w * kx,
    h: source.h * ky,
  };
  const margin = Math.round(
    Math.min(output.width, output.height) * Math.max(0, focus.margin ?? 0.04),
  );
  const size = Math.max(0.05, Math.min(1, focus.size ?? 0.4));
  let w = Math.min(output.width * size, output.width - 2 * margin);
  let h = (w * source.h) / source.w;
  const maxH = output.height - 2 * margin;
  if (h > maxH) {
    h = maxH;
    w = (h * source.w) / source.h;
  }
  const corner = focus.corner ?? "br";
  const end = {
    x: corner === "tl" || corner === "bl" ? margin : output.width - margin - w,
    y: corner === "tl" || corner === "tr" ? margin : output.height - margin - h,
    w,
    h,
  };
  const p = Math.max(0, Math.min(1, progress));
  const mix = (a: number, b: number) => a + (b - a) * p;
  const dest = {
    x: mix(start.x, end.x),
    y: mix(start.y, end.y),
    w: mix(start.w, end.w),
    h: mix(start.h, end.h),
  };
  const radius = (focus.radius ?? rect.w * 0.06) * (dest.w / source.w);
  return { source, dest, radius };
}

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
   * Frame 1, which Outlook desktop shows alone. Pass the poster you already email
   * (a Blob or a decoded image) and it is drawn as-is: no second overlay, no focus.
   * "poster" (default) draws the frame at `posterSeconds` with the overlay.
   */
  firstFrame?: "poster" | "none" | Blob | CanvasImageSource;
  /** Screen + camera takes: enlarge the camera card. Omit for camera-only takes. */
  focus?: PreviewFocus;
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
      /** True when the camera card was enlarged. */
      focused: boolean;
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

  const focus = options.focus;
  const canFocus = !!focus && focusLayout(source, size, focus, 1) !== null;

  const drawCard = (image: CanvasImageSource, progress: number) => {
    if (!focus || !canFocus) return;
    const layout = focusLayout(source, size, focus, progress);
    if (!layout) return;
    const { dest, radius } = layout;
    ctx.save();
    roundedRect(ctx, dest, radius);
    if (focus.shadow ?? true) {
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = Math.round(Math.min(width, height) * 0.04);
      ctx.shadowOffsetY = Math.round(Math.min(width, height) * 0.01);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.shadowColor = "transparent";
    }
    ctx.clip();
    const s = layout.source;
    ctx.drawImage(image, s.x, s.y, s.w, s.h, dest.x, dest.y, dest.w, dest.h);
    ctx.restore();
  };

  const read = () =>
    new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data);

  const grab = async (
    at: number,
    overlay: boolean,
    progress: number | null,
  ): Promise<Uint8ClampedArray> => {
    let image: CanvasImageSource;
    try {
      image = await source.frameAt(at);
    } catch (error) {
      throw new PreviewError(
        "undecodable",
        `Could not read the frame at ${at}s: ${error instanceof Error ? error.message : error}`,
      );
    }
    ctx.drawImage(image, 0, 0, width, height);
    if (overlay) options.drawOverlay?.(ctx, width, height);
    // The card sits above the overlay wash so the face stays bright.
    if (progress !== null) drawCard(image, progress);
    return read();
  };

  const frames: GifFrame[] = [];
  const first = options.firstFrame ?? "poster";
  const firstHold = Math.round((options.firstFrameSeconds ?? 0.6) * 100);
  if (first === "poster") {
    const posterSeconds =
      options.posterSeconds ?? Math.min(1, (known ?? durationSeconds * 2) / 2);
    frames.push({
      pixels: await grab(posterSeconds, true, null),
      delayCs: firstHold,
      hold: true,
    });
  } else if (first !== "none") {
    frames.push({
      pixels: await drawSupplied(ctx, first, width, height, read),
      delayCs: firstHold,
      hold: true,
    });
  }
  const ease = focus?.easeSeconds ?? 0.4;
  for (let i = 0; i < count; i++) {
    const t = Math.round((i / fps) * 1000) / 1000;
    frames.push({
      pixels: await grab(
        t,
        overlayAll || (first === "none" && i === 0),
        canFocus ? focusProgress(t, ease) : null,
      ),
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
    focused: canFocus,
  };
}

async function drawSupplied(
  ctx: CanvasRenderingContext2D,
  image: Blob | CanvasImageSource,
  width: number,
  height: number,
  read: () => Uint8ClampedArray,
): Promise<Uint8ClampedArray> {
  if (typeof Blob !== "undefined" && image instanceof Blob) {
    if (typeof createImageBitmap !== "function") {
      throw new PreviewError(
        "unsupported",
        "This browser cannot decode the poster.",
      );
    }
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(image);
    } catch (error) {
      throw new PreviewError(
        "undecodable",
        `Could not decode the poster: ${error instanceof Error ? error.message : error}`,
      );
    }
    try {
      ctx.drawImage(bitmap, 0, 0, width, height);
    } finally {
      bitmap.close();
    }
    return read();
  }
  ctx.drawImage(image as CanvasImageSource, 0, 0, width, height);
  return read();
}

function roundedRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const k = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + k, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, k);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, k);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, k);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, k);
  ctx.closePath();
}
