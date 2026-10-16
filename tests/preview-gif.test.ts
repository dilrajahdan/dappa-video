import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPreviewGif,
  encodeGif,
  encodeWithinBudget,
  type GifFrame,
  lzwEncode,
  previewDimensions,
  quantize,
  resizeRgba,
} from "../src/preview-gif";
import { decodeGif, lzwDecode } from "./gif-decoder";

afterEach(() => vi.restoreAllMocks());

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A soft gradient with a moving square, like a face moving over a background. */
function makeFrames(
  width: number,
  height: number,
  count: number,
  delayCs = 10,
): GifFrame[] {
  const frames: GifFrame[] = [];
  for (let f = 0; f < count; f++) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        pixels[o] = (x * 255) / width;
        pixels[o + 1] = (y * 255) / height;
        pixels[o + 2] = 120;
        pixels[o + 3] = 255;
      }
    }
    const size = Math.max(2, Math.floor(width / 6));
    const sx = (f * 3) % Math.max(1, width - size);
    for (let y = 10; y < 10 + size && y < height; y++) {
      for (let x = sx; x < sx + size; x++) {
        const o = (y * width + x) * 4;
        pixels[o] = 230;
        pixels[o + 1] = 180;
        pixels[o + 2] = 150;
      }
    }
    frames.push({ pixels, delayCs });
  }
  return frames;
}

function noiseFrames(width: number, height: number, count: number) {
  const rand = seeded(7);
  return Array.from({ length: count }, () => {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = rand() * 256;
    return { pixels, delayCs: 10 };
  });
}

describe("LZW", () => {
  it.each([2, 3, 4, 8])(
    "round-trips random indices at minimum code size %s",
    (minCodeSize) => {
      const rand = seeded(minCodeSize);
      const indices = Uint8Array.from({ length: 20_000 }, () =>
        Math.floor(rand() * 2 ** minCodeSize),
      );
      expect(lzwDecode(lzwEncode(indices, minCodeSize), minCodeSize)).toEqual(
        Array.from(indices),
      );
    },
  );

  it("round-trips long runs that fill the 4096-code dictionary several times", () => {
    const rand = seeded(99);
    const indices = new Uint8Array(200_000);
    for (let i = 0; i < indices.length; i++) {
      indices[i] =
        rand() < 0.7 ? indices[i - 1] || 0 : Math.floor(rand() * 256);
    }
    expect(lzwDecode(lzwEncode(indices, 8), 8)).toEqual(Array.from(indices));
  });

  it("round-trips the KwKwK case and a single pixel", () => {
    expect(lzwDecode(lzwEncode(new Uint8Array(500), 2), 2)).toEqual(
      new Array(500).fill(0),
    );
    expect(lzwDecode(lzwEncode(Uint8Array.of(3), 2), 2)).toEqual([3]);
  });
});

describe("GIF file structure", () => {
  const frames = makeFrames(40, 30, 4);
  const bytes = encodeGif(frames, { width: 40, height: 30 });

  it("starts with the GIF89a header and ends with the trailer", () => {
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it("loops forever through the NETSCAPE2.0 extension", () => {
    const text = String.fromCharCode(...bytes);
    expect(text).toContain("NETSCAPE2.0");
    expect(decodeGif(bytes).loopCount).toBe(0);
  });

  it("writes every frame delay in centiseconds", () => {
    const mixed = makeFrames(20, 20, 3).map((frame, i) => ({
      ...frame,
      delayCs: [60, 10, 150][i],
    }));
    const decoded = decodeGif(encodeGif(mixed, { width: 20, height: 20 }));
    expect(decoded.frames.map((f) => f.delayCs)).toEqual([60, 10, 150]);
  });

  it("decodes back to the source picture within quantisation error", () => {
    const decoded = decodeGif(bytes);
    expect(decoded.width).toBe(40);
    expect(decoded.height).toBe(30);
    expect(decoded.frames).toHaveLength(4);
    decoded.frames.forEach((frame, f) => {
      const source = frames[f].pixels;
      let total = 0;
      for (let i = 0; i < source.length; i += 4) {
        total +=
          Math.abs(frame.composite[i] - source[i]) +
          Math.abs(frame.composite[i + 1] - source[i + 1]) +
          Math.abs(frame.composite[i + 2] - source[i + 2]);
        expect(frame.composite[i + 3]).toBe(255);
      }
      expect(total / (source.length / 4) / 3).toBeLessThan(12);
    });
  });

  it("only re-sends the changed rectangle once frame diffing is on", () => {
    const decoded = decodeGif(bytes);
    expect(decoded.frames[0]).toMatchObject({ left: 0, top: 0, width: 40 });
    for (const frame of decoded.frames.slice(1)) {
      expect(frame.width * frame.height).toBeLessThan(40 * 30);
      expect(frame.transparentIndex).not.toBeNull();
    }
    const plain = encodeGif(frames, { width: 40, height: 30, diff: false });
    expect(bytes.length).toBeLessThan(plain.length);
  });

  it("rejects frames whose pixel count does not match the size", () => {
    expect(() =>
      encodeGif([{ pixels: new Uint8ClampedArray(12), delayCs: 10 }], {
        width: 4,
        height: 4,
      }),
    ).toThrow(RangeError);
  });
});

describe("palette", () => {
  it("never exceeds 256 colours, even for pure noise", () => {
    const noisy = noiseFrames(64, 64, 3);
    const { palette, size } = quantize(
      noisy.map((f) => f.pixels),
      256,
    );
    expect(size).toBeLessThanOrEqual(256);
    expect(palette.length).toBe(size * 3);
    const decoded = decodeGif(encodeGif(noisy, { width: 64, height: 64 }));
    expect(decoded.paletteSize).toBeLessThanOrEqual(256);
    for (const frame of decoded.frames) {
      expect(Math.max(...frame.indices)).toBeLessThan(decoded.paletteSize);
    }
  });

  it("honours a smaller colour limit", () => {
    const { size } = quantize(
      noiseFrames(32, 32, 1).map((f) => f.pixels),
      64,
    );
    expect(size).toBeLessThanOrEqual(64);
  });

  it("keeps a two-colour picture exact", () => {
    const pixels = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < 16; i++) {
      pixels.set(i % 2 ? [255, 255, 255, 255] : [12, 34, 56, 255], i * 4);
    }
    const decoded = decodeGif(
      encodeGif([{ pixels, delayCs: 10 }], { width: 4, height: 4 }),
    );
    expect(Array.from(decoded.frames[0].composite)).toEqual(Array.from(pixels));
  });
});

describe("size budget", () => {
  const frames = makeFrames(480, 270, 12);

  it("uses no step when the GIF already fits", () => {
    const result = encodeWithinBudget(frames, {
      width: 480,
      height: 270,
      maxBytes: 5_000_000,
    });
    expect(result).toMatchObject({
      ok: true,
      steps: [],
      width: 480,
      frames: 12,
    });
  });

  it("drops frames first, then width, then colours, and reports each step", () => {
    const full = encodeWithinBudget(frames, {
      width: 480,
      height: 270,
      maxBytes: 5_000_000,
    });
    if (!full.ok) throw new Error("expected a fit");
    const result = encodeWithinBudget(frames, {
      width: 480,
      height: 270,
      maxBytes: Math.floor(full.bytes * 0.3),
    });
    if (!result.ok) throw new Error(`expected a fit, got ${result.reason}`);
    expect(result.bytes).toBeLessThanOrEqual(Math.floor(full.bytes * 0.3));
    expect(result.steps[0]).toBe("fewer-frames");
    const order = ["fewer-frames", "smaller-width", "fewer-colours"];
    const ranks = result.steps.map((s) => order.indexOf(s.split(":")[0]));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(result.frames).toBeLessThan(12);
    expect(result.bytes).toBe(result.gif.length);
  });

  it("keeps the total running time when it drops frames", () => {
    const held: GifFrame[] = [
      { ...frames[0], delayCs: 60, hold: true },
      ...frames.slice(1, 9),
    ];
    const full = encodeWithinBudget(held, {
      width: 480,
      height: 270,
      maxBytes: 5_000_000,
    });
    if (!full.ok) throw new Error("expected a fit");
    const result = encodeWithinBudget(held, {
      width: 480,
      height: 270,
      maxBytes: full.bytes - 1,
    });
    if (!result.ok) throw new Error("expected a fit");
    const decoded = decodeGif(result.gif);
    expect(decoded.frames[0].delayCs).toBe(60);
    expect(decoded.frames.reduce((n, f) => n + f.delayCs, 0)).toBe(60 + 8 * 10);
  });

  it("returns a typed error when no step can reach the budget", () => {
    const result = encodeWithinBudget(noiseFrames(64, 64, 2), {
      width: 64,
      height: 64,
      maxBytes: 100,
    });
    expect(result).toMatchObject({ ok: false, reason: "over-budget" });
  });
});

describe("dimensions", () => {
  it.each([
    [1280, 720, 480, 480, 270],
    [720, 1280, 480, 480, 853],
    [320, 180, 480, 320, 180],
  ])("fits %sx%s into %s wide without upscaling", (w, h, max, outW, outH) => {
    expect(previewDimensions(w, h, max)).toEqual({ width: outW, height: outH });
  });

  it("resizes by averaging, keeping colour and size", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    const out = resizeRgba(pixels, 4, 4, 2, 2);
    expect(out.length).toBe(2 * 2 * 4);
    expect(Array.from(out)).toEqual(new Array(16).fill(200));
  });
});

describe("createPreviewGif in the browser", () => {
  function fakeCanvas() {
    const drawn: unknown[] = [];
    let width = 0;
    let height = 0;
    const ctx = {
      drawImage: vi.fn((source: unknown, _x, _y, w: number, h: number) => {
        drawn.push(source);
        width = w;
        height = h;
      }),
      getImageData: vi.fn(() => {
        const data = new Uint8ClampedArray(width * height * 4);
        const shade = (drawn.length * 20) % 255;
        for (let i = 0; i < data.length; i += 4) {
          data[i] = shade;
          data[i + 1] = 100;
          data[i + 2] = 50;
          data[i + 3] = 255;
        }
        return { data, width, height };
      }),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    return { ctx, drawn };
  }

  it("puts the poster first, held, then the motion frames, with the overlay on each", async () => {
    const { ctx } = fakeCanvas();
    const times: number[] = [];
    const overlay = vi.fn();
    const result = await createPreviewGif(
      {
        width: 1280,
        height: 720,
        duration: 8,
        frameAt: async (t) => {
          times.push(t);
          return document.createElement("canvas");
        },
      },
      { durationSeconds: 1, fps: 4, drawOverlay: overlay },
    );
    if (!result.ok) throw new Error(result.message);
    expect(times[0]).toBe(1);
    expect(times.slice(1)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(overlay).toHaveBeenCalledTimes(5);
    expect(overlay).toHaveBeenCalledWith(ctx, 480, 270);
    expect(result).toMatchObject({ width: 480, height: 270, frames: 5 });
    expect(result.blob.type).toBe("image/gif");
    expect(result.blob.size).toBe(result.bytes);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const delays = decodeGif(bytes).frames.map((f) => f.delayCs);
    expect(delays).toEqual([60, 25, 25, 25, 25]);
  });

  it("uses a caller-supplied first frame and can hold the last frame", async () => {
    const { drawn } = fakeCanvas();
    const poster = document.createElement("canvas");
    const result = await createPreviewGif(
      {
        width: 640,
        height: 360,
        frameAt: async () => document.createElement("canvas"),
      },
      {
        durationSeconds: 0.5,
        fps: 4,
        firstFrame: poster,
        holdLastSeconds: 1,
      },
    );
    if (!result.ok) throw new Error(result.message);
    expect(drawn[0]).toBe(poster);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(decodeGif(bytes).frames.map((f) => f.delayCs)).toEqual([
      60, 25, 125,
    ]);
  });

  it("can skip the poster frame entirely", async () => {
    fakeCanvas();
    const result = await createPreviewGif(
      {
        width: 100,
        height: 50,
        frameAt: async () => document.createElement("canvas"),
      },
      { durationSeconds: 0.5, fps: 4, firstFrame: "none" },
    );
    expect(result).toMatchObject({
      ok: true,
      frames: 2,
      width: 100,
      height: 50,
    });
  });

  it("returns a typed error instead of throwing when a frame cannot be read", async () => {
    fakeCanvas();
    const result = await createPreviewGif({
      width: 640,
      height: 360,
      frameAt: async () => {
        throw new Error("decode failed");
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "undecodable" });
  });

  it("returns a typed error for an undecoded video", async () => {
    const result = await createPreviewGif(document.createElement("video"));
    expect(result).toMatchObject({ ok: false, reason: "undecodable" });
  });

  it("returns a typed error when canvas is unavailable", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const result = await createPreviewGif({
      width: 640,
      height: 360,
      frameAt: async () => document.createElement("canvas"),
    });
    expect(result).toMatchObject({ ok: false, reason: "unsupported" });
  });
});
