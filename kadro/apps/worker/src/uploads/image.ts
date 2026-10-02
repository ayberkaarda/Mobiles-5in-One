import { type UploadContentType, type UploadRejectReason } from '@kadro/db';
import sharp from 'sharp';

/**
 * Image checks and re-encoding of ADR-0030. The format decision rests on magic bytes only; the
 * decode runs with fixed limits and the output is a fresh WebP without any metadata.
 */

/** 2 MiB, `LIMITS.uploadBytes.max` of packages/contracts. */
export const MAX_UPLOAD_BYTES = 2_097_152;
/** Pixel-flood and decompression-bomb guard. */
export const MAX_INPUT_PIXELS = 25_000_000;
export const MAX_DIMENSION = 1_024;
export const WEBP_QUALITY = 80;
export const DECODE_TIMEOUT_SECONDS = 20;

// One libvips worker thread per image and no operation cache: memory stays bounded and one
// hostile image cannot occupy every core.
sharp.concurrency(1);
sharp.cache(false);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Format by magic bytes: JPEG `FF D8 FF`, PNG signature, WebP `RIFF????WEBP`. */
export function detectImageType(bytes: Buffer): UploadContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export type ReencodeResult =
  | { readonly ok: true; readonly webp: Buffer; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: UploadRejectReason };

/**
 * Decodes the first frame with `limitInputPixels` and `failOn: 'error'`, applies the EXIF
 * orientation, fits it inside 1024 × 1024 without enlargement and encodes WebP quality 80. `sharp`
 * writes no metadata unless asked, so EXIF, GPS, XMP and ICC data are dropped.
 */
export async function reencodeImage(bytes: Buffer): Promise<ReencodeResult> {
  try {
    const { data, info } = await sharp(bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      pages: 1,
      sequentialRead: true,
    })
      .timeout({ seconds: DECODE_TIMEOUT_SECONDS })
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, webp: data, width: info.width, height: info.height };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      ok: false,
      reason: /pixel limit/i.test(message) ? 'too_many_pixels' : 'decode_failed',
    };
  }
}
