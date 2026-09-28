import sharp, { type Metadata } from 'sharp';
import { DomainError } from '../shared/errors';

/** Upload rules per event image. Output is always re-encoded, so no uploaded bytes are served. */
export const IMAGE_RULES = {
  cover: { maxBytes: 8 * 1024 * 1024, minWidth: 600, minHeight: 300, maxEdge: 1600 },
  logo: { maxBytes: 2 * 1024 * 1024, minWidth: 64, minHeight: 64, maxEdge: 512 },
} as const;
export type ImageKind = keyof typeof IMAGE_RULES;

/** Pixels sharp may decode before giving up (a small file can claim a huge canvas). */
const MAX_INPUT_PIXELS = 40_000_000;

function sniff(bytes: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export interface ProcessedImage {
  body: Buffer;
  contentType: 'image/webp';
  width: number;
  height: number;
}

/**
 * Checks and re-encodes an uploaded image. Only JPEG, PNG and WebP are accepted, recognised by
 * their content, not the file name. The image is decoded, turned upright, stripped of metadata
 * (camera location included), scaled down and written out as WebP.
 */
export async function processImage(kind: ImageKind, bytes: Buffer): Promise<ProcessedImage> {
  const rules = IMAGE_RULES[kind];
  if (bytes.length === 0) throw new DomainError('image_unsupported');
  if (bytes.length > rules.maxBytes) {
    throw new DomainError('image_too_large', undefined, { maxBytes: rules.maxBytes });
  }
  if (!sniff(bytes)) throw new DomainError('image_unsupported');

  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new DomainError('image_unsupported');
  }
  if (!meta.width || !meta.height || (meta.pages ?? 1) > 1)
    throw new DomainError('image_unsupported');
  // EXIF orientations 5–8 swap width and height once the image is turned upright.
  const [w, h] =
    (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  if (w < rules.minWidth || h < rules.minHeight) {
    throw new DomainError('image_too_small', undefined, {
      minWidth: rules.minWidth,
      minHeight: rules.minHeight,
    });
  }
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({
        width: rules.maxEdge,
        height: rules.maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: kind === 'cover' ? 78 : 90, alphaQuality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { body: data, contentType: 'image/webp', width: info.width, height: info.height };
  } catch {
    throw new DomainError('image_unsupported');
  }
}
