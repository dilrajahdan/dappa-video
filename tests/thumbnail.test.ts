import { afterEach, describe, expect, it, vi } from "vitest";
import { createThumbnail, thumbnailDimensions } from "../src/thumbnail";

afterEach(() => vi.restoreAllMocks());

describe("thumbnail output", () => {
  it.each([
    [3840, 2160, 1200, 675],
    [1080, 1920, 675, 1200],
    [640, 360, 640, 360],
  ])("fits %sx%s without stretching or upscaling", (w, h, outW, outH) => {
    expect(thumbnailDimensions(w, h)).toEqual({ width: outW, height: outH });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an undecoded or invalid frame (%s)",
    (width) => {
      expect(() => thumbnailDimensions(width, 720)).toThrow(RangeError);
    },
  );

  it("renders the chosen frame and scales the email overlay to the output size", async () => {
    const drawImage = vi.fn();
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const image = new Blob(["encoded"], { type: "image/jpeg" });
    const encoder = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback) => callback(image));
    const source = document.createElement("video");
    const overlay = vi.fn();
    const result = await createThumbnail(
      source,
      { width: 3840, height: 2160 },
      { drawOverlay: overlay },
    );
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1200, 675);
    expect(overlay).toHaveBeenCalledWith(ctx, 1200, 675);
    expect(encoder.mock.calls[0].slice(1)).toEqual(["image/jpeg", 0.8]);
    expect(result).toBe(image);
  });

  it("surfaces encoding failure rather than returning an empty thumbnail", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(null),
    );
    await expect(
      createThumbnail(document.createElement("video"), {
        width: 640,
        height: 360,
      }),
    ).rejects.toThrow("no image");
  });
});
