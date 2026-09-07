import { MAX_IMAGE_DIMENSION, fitWithin } from "../../shared/image-limits";

/**
 * Downscaling of attachments before they are sent.
 *
 * An image is billed by area, so a screenshot straight off a high-resolution display costs
 * several thousand tokens on every turn for the rest of the session's life — and past the
 * API's ceiling it is refused outright, which fails not just that turn but every later one,
 * since the transcript is replayed in full each time.
 *
 * Done in the browser because that is where the image already exists as pixels: the canvas
 * decode is free here, and the smaller file is what gets uploaded, embedded and stored, so
 * nothing downstream ever sees the oversized original.
 */

/** Longest side an attachment is reduced to. Below the API ceiling, still legible for text. */
export const ATTACHMENT_MAX_DIMENSION = 1600;

export interface ResizeOutcome {
  file: File;
  /** Original dimensions, when they could be read. */
  from?: { width: number; height: number };
  /** Dimensions after scaling, when a scale happened. */
  to?: { width: number; height: number };
}

/** Canvas encodes to a handful of types; anything else round-trips as PNG. */
function encodeType(type: string): string {
  return type === "image/jpeg" || type === "image/webp" ? type : "image/png";
}

/**
 * Return a copy of `file` scaled to fit `max`, or the file itself when it already fits.
 *
 * Never throws: a browser without `createImageBitmap`, an image it cannot decode, or a canvas
 * that refuses to encode all fall back to sending the original. Shrinking an attachment is an
 * optimisation, and failing it must not cost the user their message.
 */
export async function downscaleImage(
  file: File,
  max: number = ATTACHMENT_MAX_DIMENSION,
): Promise<ResizeOutcome> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return { file };
  if (typeof createImageBitmap !== "function") return { file };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file };
  }

  try {
    const from = { width: bitmap.width, height: bitmap.height };
    const to = fitWithin(from.width, from.height, max);
    if (!to) return { file, from };

    const canvas = document.createElement("canvas");
    canvas.width = to.width;
    canvas.height = to.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { file, from };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, to.width, to.height);

    const type = encodeType(file.type);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.92));
    if (!blob) return { file, from };

    const name = type === file.type ? file.name : file.name.replace(/\.[^.]+$/, "") + ".png";
    return { file: new File([blob], name, { type }), from, to };
  } catch {
    return { file };
  } finally {
    bitmap.close?.();
  }
}

export { MAX_IMAGE_DIMENSION };
