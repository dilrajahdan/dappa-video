// Pure GIF89a encoding: RGBA pixels in, bytes out. No DOM, no dependencies, so every part
// can be unit-tested and moved to a worker later without changes.

export type GifFrame = {
  /** RGBA, `width * height * 4` bytes. Alpha is ignored; GIF frames here are opaque. */
  pixels: Uint8ClampedArray | Uint8Array;
  /** How long this frame shows, in hundredths of a second. */
  delayCs: number;
  /** A held frame (such as the poster) is never merged away by the size budget. */
  hold?: boolean;
};

export type GifEncodeOptions = {
  width: number;
  height: number;
  /** Palette size, 2 to 256. One slot is kept for transparency when diffing. */
  maxColors?: number;
  /** "none" keeps faces clean. "ordered" adds a light, stable 4x4 pattern that hides banding. */
  dither?: "none" | "ordered";
  /** Re-send only the changed rectangle of each frame. On by default. */
  diff?: boolean;
  /** Colour distance treated as "unchanged" when diffing. Hides video noise. Default 10. */
  diffTolerance?: number;
  /** 0 loops forever. */
  loop?: number;
};

export type GifBudgetOptions = GifEncodeOptions & { maxBytes: number };

export type GifBudgetResult =
  | {
      ok: true;
      gif: Uint8Array;
      bytes: number;
      width: number;
      height: number;
      frames: number;
      steps: string[];
    }
  | {
      ok: false;
      reason: "over-budget";
      bytes: number;
      steps: string[];
    };

// ---------------------------------------------------------------------------
// Quantisation: variance-based median cut over a 5-bit-per-channel histogram. The box with
// the largest colour error is split where the error drops most, so small detailed areas
// such as a face get their share of colours. Each palette entry is the true average of the
// pixels in its box, so flat colours stay exact.

const HIST_BITS = 5;
const HIST_SHIFT = 8 - HIST_BITS;
const HIST_SIZE = 1 << (HIST_BITS * 3);
// Green matters most to the eye, blue least.
const CHANNEL_WEIGHT = [2, 4, 3];

type Box = { bins: number[]; count: number; error: number };

export function quantize(
  frames: ReadonlyArray<Uint8ClampedArray | Uint8Array>,
  maxColors = 256,
): { palette: Uint8Array; size: number } {
  const limit = Math.max(2, Math.min(256, Math.floor(maxColors)));
  const counts = new Uint32Array(HIST_SIZE);
  const sums = new Float64Array(HIST_SIZE * 3);
  const squares = new Float64Array(HIST_SIZE * 3);
  for (const pixels of frames) {
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const key =
        ((r >> HIST_SHIFT) << (HIST_BITS * 2)) |
        ((g >> HIST_SHIFT) << HIST_BITS) |
        (b >> HIST_SHIFT);
      counts[key]++;
      sums[key * 3] += r;
      sums[key * 3 + 1] += g;
      sums[key * 3 + 2] += b;
      squares[key * 3] += r * r;
      squares[key * 3 + 1] += g * g;
      squares[key * 3 + 2] += b * b;
    }
  }
  const bins: number[] = [];
  for (let key = 0; key < HIST_SIZE; key++) if (counts[key]) bins.push(key);
  if (bins.length === 0) return { palette: new Uint8Array(6), size: 2 };

  // Weighted squared error of a set of pixels around its mean, from running totals.
  const errorOf = (n: number, s: number[], q: number[]) => {
    if (n === 0) return 0;
    let e = 0;
    for (let c = 0; c < 3; c++)
      e += CHANNEL_WEIGHT[c] * (q[c] - (s[c] * s[c]) / n);
    return Math.max(0, e);
  };
  const makeBox = (list: number[]): Box => {
    let n = 0;
    const s = [0, 0, 0];
    const q = [0, 0, 0];
    for (const key of list) {
      n += counts[key];
      for (let c = 0; c < 3; c++) {
        s[c] += sums[key * 3 + c];
        q[c] += squares[key * 3 + c];
      }
    }
    return { bins: list, count: n, error: errorOf(n, s, q) };
  };
  const channelOf = (key: number, c: number) =>
    (key >> (HIST_BITS * (2 - c))) & ((1 << HIST_BITS) - 1);

  // Best cut of a box: try each channel, sweep the sorted bins, keep the lowest total error.
  const bestSplit = (box: Box): [number[], number[]] | null => {
    if (box.bins.length < 2) return null;
    let best: [number[], number[]] | null = null;
    let bestError = Number.POSITIVE_INFINITY;
    for (let c = 0; c < 3; c++) {
      const sorted = [...box.bins].sort(
        (a, b) => channelOf(a, c) - channelOf(b, c),
      );
      if (channelOf(sorted[0], c) === channelOf(sorted[sorted.length - 1], c))
        continue;
      let n = 0;
      const s = [0, 0, 0];
      const q = [0, 0, 0];
      const totalS = [0, 0, 0];
      const totalQ = [0, 0, 0];
      for (const key of sorted) {
        for (let k = 0; k < 3; k++) {
          totalS[k] += sums[key * 3 + k];
          totalQ[k] += squares[key * 3 + k];
        }
      }
      for (let i = 0; i < sorted.length - 1; i++) {
        const key = sorted[i];
        n += counts[key];
        for (let k = 0; k < 3; k++) {
          s[k] += sums[key * 3 + k];
          q[k] += squares[key * 3 + k];
        }
        // Only cut between different values on this channel.
        if (channelOf(key, c) === channelOf(sorted[i + 1], c)) continue;
        const e =
          errorOf(n, s, q) +
          errorOf(
            box.count - n,
            [0, 1, 2].map((k) => totalS[k] - s[k]),
            [0, 1, 2].map((k) => totalQ[k] - q[k]),
          );
        if (e < bestError) {
          bestError = e;
          best = [sorted.slice(0, i + 1), sorted.slice(i + 1)];
        }
      }
    }
    return best;
  };

  const boxes: Box[] = [makeBox(bins)];
  const frozen = new Set<Box>();
  while (boxes.length < limit) {
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (frozen.has(boxes[i]) || boxes[i].bins.length < 2) continue;
      if (best < 0 || boxes[i].error > boxes[best].error) best = i;
    }
    if (best < 0) break;
    const split = bestSplit(boxes[best]);
    if (!split) {
      frozen.add(boxes[best]);
      continue;
    }
    boxes.splice(best, 1, makeBox(split[0]), makeBox(split[1]));
  }

  const palette = new Uint8Array(Math.max(2, boxes.length) * 3);
  boxes.forEach((box, i) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const key of box.bins) {
      r += sums[key * 3];
      g += sums[key * 3 + 1];
      b += sums[key * 3 + 2];
    }
    palette[i * 3] = Math.round(r / box.count);
    palette[i * 3 + 1] = Math.round(g / box.count);
    palette[i * 3 + 2] = Math.round(b / box.count);
  });
  return { palette, size: Math.max(2, boxes.length) };
}

/** Maps colours to palette indices, caching on a 6-bit-per-channel key. */
function createMapper(palette: Uint8Array, size: number) {
  const cache = new Int16Array(1 << 18).fill(-1);
  return (r: number, g: number, b: number): number => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = cache[key];
    if (hit >= 0) return hit;
    const cr = (r & ~3) + 2;
    const cg = (g & ~3) + 2;
    const cb = (b & ~3) + 2;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < size; i++) {
      const dr = palette[i * 3] - cr;
      const dg = palette[i * 3 + 1] - cg;
      const db = palette[i * 3 + 2] - cb;
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    cache[key] = best;
    return best;
  };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const DITHER_STRENGTH = 10;

// ---------------------------------------------------------------------------
// LZW, the variable-length code compression GIF uses. Follows giflib's code-size rules.

export function lzwEncode(
  indices: ArrayLike<number>,
  minCodeSize: number,
): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let next = eoi + 1;
  const out = new ByteWriter(Math.max(64, indices.length >> 1));
  let cur = 0;
  let curBits = 0;
  const emit = (code: number) => {
    cur |= code << curBits;
    curBits += size;
    while (curBits >= 8) {
      out.byte(cur & 0xff);
      cur >>>= 8;
      curBits -= 8;
    }
  };
  // Open-addressing table keyed on (prefix << 8 | pixel). A generation stamp resets it
  // in O(1) on every clear code.
  const TABLE = 8192;
  const keys = new Int32Array(TABLE);
  const values = new Int16Array(TABLE);
  const stamps = new Uint32Array(TABLE);
  let generation = 1;
  const slot = (key: number) => {
    let h = (Math.imul(key, 0x9e3779b1) >>> 19) & (TABLE - 1);
    while (stamps[h] === generation && keys[h] !== key)
      h = (h + 1) & (TABLE - 1);
    return h;
  };

  emit(clear);
  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const h = slot(key);
      if (stamps[h] === generation) {
        prefix = values[h];
        continue;
      }
      emit(prefix);
      if (next === 4096) {
        emit(clear);
        generation++;
        size = minCodeSize + 1;
        next = eoi + 1;
      } else {
        if (next >= 1 << size) size++;
        stamps[h] = generation;
        keys[h] = key;
        values[h] = next++;
      }
      prefix = k;
    }
    emit(prefix);
    // The decoder adds one more entry after the final code, so it may read the end code
    // one bit wider. Match it.
    if (next < 4096 && next >= 1 << size) size++;
  }
  emit(eoi);
  if (curBits > 0) out.byte(cur & 0xff);
  return out.result();
}

class ByteWriter {
  private buf: Uint8Array;
  private len = 0;
  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
  }
  private grow(extra: number) {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  byte(b: number) {
    this.grow(1);
    this.buf[this.len++] = b;
  }
  u16(v: number) {
    this.byte(v & 0xff);
    this.byte((v >> 8) & 0xff);
  }
  bytes(data: ArrayLike<number>) {
    this.grow(data.length);
    this.buf.set(data, this.len);
    this.len += data.length;
  }
  text(s: string) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  subBlocks(data: Uint8Array) {
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, Math.min(i + 255, data.length));
      this.byte(chunk.length);
      this.bytes(chunk);
    }
    this.byte(0);
  }
  result() {
    return this.buf.slice(0, this.len);
  }
}

// ---------------------------------------------------------------------------
// File writer.

function assertSize(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 65535 ||
    height > 65535
  ) {
    throw new RangeError(
      "GIF dimensions must be whole numbers from 1 to 65535.",
    );
  }
}

export function encodeGif(
  frames: ReadonlyArray<GifFrame>,
  options: GifEncodeOptions,
): Uint8Array {
  const { width, height } = options;
  assertSize(width, height);
  if (frames.length === 0)
    throw new RangeError("A GIF needs at least one frame.");
  const area = width * height;
  for (const frame of frames) {
    if (frame.pixels.length !== area * 4) {
      throw new RangeError("Frame pixels do not match the GIF dimensions.");
    }
  }
  const diff = (options.diff ?? true) && frames.length > 1;
  const maxColors = Math.max(2, Math.min(256, options.maxColors ?? 256));
  const { palette, size } = quantize(
    frames.map((f) => f.pixels),
    diff ? maxColors - 1 : maxColors,
  );
  const transparent = diff ? size : -1;
  const used = diff ? size + 1 : size;
  let tableBits = 1;
  while (1 << tableBits < used) tableBits++;
  const minCodeSize = Math.max(2, tableBits);
  const map = createMapper(palette, size);
  const dither = options.dither === "ordered";
  const tolerance = Math.max(0, options.diffTolerance ?? 10);
  const tol2 = tolerance * tolerance;

  const out = new ByteWriter(area);
  out.text("GIF89a");
  out.u16(width);
  out.u16(height);
  out.byte(0x80 | ((tableBits - 1) << 4) | (tableBits - 1));
  out.byte(0);
  out.byte(0);
  const table = new Uint8Array((1 << tableBits) * 3);
  table.set(palette.subarray(0, size * 3));
  out.bytes(table);
  out.byte(0x21);
  out.byte(0xff);
  out.byte(11);
  out.text("NETSCAPE2.0");
  out.byte(3);
  out.byte(1);
  out.u16(Math.max(0, Math.min(65535, Math.floor(options.loop ?? 0))));
  out.byte(0);

  const shown = new Uint8Array(area);
  const indices = new Uint8Array(area);
  frames.forEach((frame, f) => {
    const px = frame.pixels;
    for (let p = 0, i = 0; p < area; p++, i += 4) {
      let r = px[i];
      let g = px[i + 1];
      let b = px[i + 2];
      if (dither) {
        const x = p % width;
        const y = (p / width) | 0;
        const o =
          ((BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * DITHER_STRENGTH;
        r = clamp255(r + o);
        g = clamp255(g + o);
        b = clamp255(b + o);
      }
      indices[p] = map(r, g, b);
    }
    let left = 0;
    let top = 0;
    let w = width;
    let h = height;
    let data: Uint8Array = indices;
    const useTransparency = diff && f > 0;
    if (useTransparency) {
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let p = 0, i = 0; p < area; p++, i += 4) {
        const prev = shown[p];
        let same = indices[p] === prev;
        if (!same && tol2 > 0) {
          const dr = px[i] - palette[prev * 3];
          const dg = px[i + 1] - palette[prev * 3 + 1];
          const db = px[i + 2] - palette[prev * 3 + 2];
          same = dr * dr + dg * dg + db * db <= tol2;
        }
        if (same) {
          indices[p] = transparent;
          continue;
        }
        shown[p] = indices[p];
        const x = p % width;
        const y = (p / width) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (maxX < 0) {
        w = 1;
        h = 1;
        data = Uint8Array.of(transparent);
      } else {
        left = minX;
        top = minY;
        w = maxX - minX + 1;
        h = maxY - minY + 1;
        data = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
          const from = (top + y) * width + left;
          data.set(indices.subarray(from, from + w), y * w);
        }
      }
    } else {
      shown.set(indices);
    }
    out.byte(0x21);
    out.byte(0xf9);
    out.byte(4);
    out.byte((1 << 2) | (useTransparency ? 1 : 0));
    out.u16(clampDelay(frame.delayCs));
    out.byte(useTransparency ? transparent : 0);
    out.byte(0);
    out.byte(0x2c);
    out.u16(left);
    out.u16(top);
    out.u16(w);
    out.u16(h);
    out.byte(0);
    out.byte(minCodeSize);
    out.subBlocks(lzwEncode(data, minCodeSize));
  });
  out.byte(0x3b);
  return out.result();
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function clampDelay(cs: number) {
  if (!Number.isFinite(cs)) return 10;
  return Math.max(2, Math.min(65535, Math.round(cs)));
}

// ---------------------------------------------------------------------------
// Resizing and the size budget.

/** Area-average downscale (or plain resample when growing). Keeps alpha. */
export function resizeRgba(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
): Uint8ClampedArray {
  assertSize(width, height);
  assertSize(outWidth, outHeight);
  const horizontal = resample1d(pixels, width, height, outWidth, true);
  return resample1d(horizontal, outWidth, height, outHeight, false);
}

function resample1d(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  outLength: number,
  alongX: boolean,
): Uint8ClampedArray {
  const inLength = alongX ? width : height;
  const outW = alongX ? outLength : width;
  const outH = alongX ? height : outLength;
  const dst = new Uint8ClampedArray(outW * outH * 4);
  const scale = inLength / outLength;
  const lines = alongX ? height : width;
  const acc = [0, 0, 0, 0];
  for (let line = 0; line < lines; line++) {
    for (let o = 0; o < outLength; o++) {
      const start = o * scale;
      const end = Math.min(inLength, start + Math.max(scale, 1));
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      let total = 0;
      for (let s = Math.floor(start); s < end; s++) {
        const weight = Math.min(s + 1, end) - Math.max(s, start);
        if (weight <= 0) continue;
        const idx = (alongX ? line * width + s : s * width + line) * 4;
        acc[0] += src[idx] * weight;
        acc[1] += src[idx + 1] * weight;
        acc[2] += src[idx + 2] * weight;
        acc[3] += src[idx + 3] * weight;
        total += weight;
      }
      const d = (alongX ? line * outW + o : o * outW + line) * 4;
      for (let c = 0; c < 4; c++) dst[d + c] = Math.round(acc[c] / total);
    }
  }
  return dst;
}

/** Merges each pair of neighbouring motion frames, keeping the total running time. */
export function dropAlternateFrames(
  frames: ReadonlyArray<GifFrame>,
): GifFrame[] {
  const out: GifFrame[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const nextFrame = frames[i + 1];
    if (!frame.hold && nextFrame && !nextFrame.hold) {
      out.push({ ...frame, delayCs: frame.delayCs + nextFrame.delayCs });
      i++;
    } else {
      out.push(frame);
    }
  }
  return out;
}

/**
 * Encodes, then steps down until the file fits: fewer frames, then a smaller width,
 * then fewer colours. Every step that fired is reported, in order.
 */
export function encodeWithinBudget(
  frames: ReadonlyArray<GifFrame>,
  options: GifBudgetOptions,
): GifBudgetResult {
  const { width, height, maxBytes } = options;
  const baseColors = Math.max(2, Math.min(256, options.maxColors ?? 256));
  const steps: string[] = [];
  let current: GifFrame[] = [...frames];
  let w = width;
  let h = height;
  let colors = baseColors;
  let smallest = Number.POSITIVE_INFINITY;

  const attempt = () => {
    const sized =
      w === width
        ? current
        : current.map((f) => ({
            ...f,
            pixels: resizeRgba(f.pixels, width, height, w, h),
          }));
    const gif = encodeGif(sized, {
      ...options,
      width: w,
      height: h,
      maxColors: colors,
    });
    smallest = Math.min(smallest, gif.length);
    return gif;
  };

  const plan: Array<() => boolean> = [
    () => {
      const fewer = dropAlternateFrames(current);
      if (fewer.length === current.length) return false;
      current = fewer;
      steps.push("fewer-frames");
      return true;
    },
    ...[0.75, 0.5].map((scale) => () => {
      const nextW = Math.max(1, Math.round(width * scale));
      if (nextW >= w) return false;
      w = nextW;
      h = Math.max(1, Math.round((height * nextW) / width));
      steps.push(`smaller-width:${w}`);
      return true;
    }),
    ...[128, 64, 32].map((count) => () => {
      if (count >= colors) return false;
      colors = count;
      steps.push(`fewer-colours:${count}`);
      return true;
    }),
  ];

  let gif = attempt();
  for (const step of plan) {
    if (gif.length <= maxBytes) break;
    if (step()) gif = attempt();
  }
  if (gif.length > maxBytes) {
    return { ok: false, reason: "over-budget", bytes: smallest, steps };
  }
  return {
    ok: true,
    gif,
    bytes: gif.length,
    width: w,
    height: h,
    frames: current.length,
    steps,
  };
}
