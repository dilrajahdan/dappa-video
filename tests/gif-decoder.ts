// A small, independent GIF89a reader used only by the tests. It is written from the
// specification, not from the encoder, so a shared misunderstanding cannot hide a bug.

export function lzwDecode(data: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([], []);
  };
  reset();
  let size = minCodeSize + 1;
  let bitPos = 0;
  let prev: number[] | null = null;
  const totalBits = data.length * 8;
  while (bitPos + size <= totalBits) {
    let code = 0;
    for (let i = 0; i < size; i++) {
      const bit = (data[(bitPos + i) >> 3] >> ((bitPos + i) & 7)) & 1;
      code |= bit << i;
    }
    bitPos += size;
    if (code === clear) {
      reset();
      size = minCodeSize + 1;
      prev = null;
      continue;
    }
    if (code === end) return out;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length && prev) entry = [...prev, prev[0]];
    else throw new Error(`Bad LZW code ${code} (dict ${dict.length})`);
    out.push(...entry);
    if (prev && dict.length < 4096) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  throw new Error("LZW stream ended without an end code");
}

export function readSubBlocks(
  bytes: Uint8Array,
  start: number,
): { data: Uint8Array; next: number } {
  const parts: number[] = [];
  let p = start;
  while (bytes[p] !== 0) {
    const n = bytes[p];
    if (p + 1 + n > bytes.length) throw new Error("Truncated sub-block");
    for (let i = 0; i < n; i++) parts.push(bytes[p + 1 + i]);
    p += n + 1;
  }
  return { data: Uint8Array.from(parts), next: p + 1 };
}

export type DecodedFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
  delayCs: number;
  disposal: number;
  transparentIndex: number | null;
  indices: number[];
  /** Full-canvas RGBA after compositing this frame over the previous ones. */
  composite: Uint8Array;
};

export type DecodedGif = {
  width: number;
  height: number;
  palette: Uint8Array;
  paletteSize: number;
  loopCount: number | null;
  frames: DecodedFrame[];
};

export function decodeGif(bytes: Uint8Array): DecodedGif {
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF89a") throw new Error(`Bad header ${header}`);
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const packed = bytes[10];
  let p = 13;
  let palette = new Uint8Array(0);
  let paletteSize = 0;
  if (packed & 0x80) {
    paletteSize = 1 << ((packed & 7) + 1);
    palette = bytes.slice(p, p + paletteSize * 3);
    p += paletteSize * 3;
  }
  let loopCount: number | null = null;
  let gce = {
    delayCs: 0,
    disposal: 0,
    transparentIndex: null as number | null,
  };
  const frames: DecodedFrame[] = [];
  const canvas = new Uint8Array(width * height * 4);
  for (;;) {
    const b = bytes[p];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p + 1];
      if (label === 0xf9) {
        const flags = bytes[p + 3];
        gce = {
          delayCs: bytes[p + 4] | (bytes[p + 5] << 8),
          disposal: (flags >> 2) & 7,
          transparentIndex: flags & 1 ? bytes[p + 6] : null,
        };
        p += 8;
        continue;
      }
      if (label === 0xff) {
        const size = bytes[p + 2];
        const id = String.fromCharCode(...bytes.subarray(p + 3, p + 3 + size));
        const blocks = readSubBlocks(bytes, p + 3 + size);
        if (id === "NETSCAPE2.0" && blocks.data[0] === 1) {
          loopCount = blocks.data[1] | (blocks.data[2] << 8);
        }
        p = blocks.next;
        continue;
      }
      p = readSubBlocks(bytes, p + 2).next;
      continue;
    }
    if (b === 0x2c) {
      const left = bytes[p + 1] | (bytes[p + 2] << 8);
      const top = bytes[p + 3] | (bytes[p + 4] << 8);
      const w = bytes[p + 5] | (bytes[p + 6] << 8);
      const h = bytes[p + 7] | (bytes[p + 8] << 8);
      if (bytes[p + 9] & 0x80)
        throw new Error("Local palettes are not expected");
      const minCodeSize = bytes[p + 10];
      const blocks = readSubBlocks(bytes, p + 11);
      p = blocks.next;
      const indices = lzwDecode(blocks.data, minCodeSize);
      if (indices.length < w * h) throw new Error("Frame has too few pixels");
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = indices[y * w + x];
          if (idx === gce.transparentIndex) continue;
          const o = ((top + y) * width + left + x) * 4;
          canvas[o] = palette[idx * 3];
          canvas[o + 1] = palette[idx * 3 + 1];
          canvas[o + 2] = palette[idx * 3 + 2];
          canvas[o + 3] = 255;
        }
      }
      frames.push({
        left,
        top,
        width: w,
        height: h,
        ...gce,
        indices: indices.slice(0, w * h),
        composite: canvas.slice(),
      });
      gce = { delayCs: 0, disposal: 0, transparentIndex: null };
      continue;
    }
    throw new Error(`Unexpected block 0x${b.toString(16)} at ${p}`);
  }
  return { width, height, palette, paletteSize, loopCount, frames };
}
