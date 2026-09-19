export type ThumbnailOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  type?: "image/jpeg" | "image/webp";
  /** Optional branding, such as the play button used in an email. */
  drawOverlay?: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ) => void;
};

export function thumbnailDimensions(
  width: number,
  height: number,
  maxWidth = 1200,
  maxHeight = 1200,
): { width: number; height: number } {
  if (
    ![width, height, maxWidth, maxHeight].every(
      (value) => Number.isFinite(value) && value >= 1,
    )
  ) {
    throw new RangeError(
      "Thumbnail dimensions must be finite and at least one pixel.",
    );
  }
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/** Decode/select a frame in the host, then resize and encode it once here. Never upscale. */
export async function createThumbnail(
  source: CanvasImageSource,
  dimensions: { width: number; height: number },
  options: ThumbnailOptions = {},
): Promise<Blob> {
  const { width, height } = thumbnailDimensions(
    dimensions.width,
    dimensions.height,
    options.maxWidth,
    options.maxHeight,
  );
  const quality = options.quality ?? 0.8;
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
    throw new RangeError("Thumbnail quality must be between zero and one.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas image encoding is unavailable.");
  ctx.drawImage(source, 0, 0, width, height);
  options.drawOverlay?.(ctx, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new Error("Thumbnail encoding produced no image."));
      },
      options.type ?? "image/jpeg",
      quality,
    );
  });
}
