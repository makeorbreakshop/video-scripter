// Image bytes -> perceptual signals, via sharp (kept out of phash.ts so that stays pure).
import sharp from 'sharp';
import { dhashFromGray, downsampleGray, DHASH_W, DHASH_H, SMALL_W, SMALL_H, meanAbsDiff, isPillarboxed } from './phash';

export async function phashFromJpeg(buf: Buffer): Promise<string> {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  return dhashFromGray(downsampleGray(data, info.width, info.height), DHASH_W, DHASH_H);
}

export async function smallGray(buf: Buffer): Promise<Uint8Array> {
  const { data } = await sharp(buf).greyscale().resize(SMALL_W, SMALL_H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

// Mean absolute pixel difference between two JPEGs on the 64x36 grayscale.
export async function pixelMeanDiff(a: Buffer, b: Buffer): Promise<number> {
  const [ga, gb] = await Promise.all([smallGray(a), smallGray(b)]);
  return meanAbsDiff(ga, gb);
}

// True when the thumbnail is a vertical video letter-boxed into 16:9 (a Short).
export async function pillarboxedJpeg(buf: Buffer): Promise<boolean> {
  return isPillarboxed(await smallGray(buf));
}
