// Image bytes -> perceptual hash, via sharp (the only I/O-adjacent piece; kept out of phash.ts so that stays pure).
import sharp from 'sharp';
import { dhashFromGray, downsampleGray, DHASH_W, DHASH_H } from './phash';

export async function phashFromJpeg(buf: Buffer): Promise<string> {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  return dhashFromGray(downsampleGray(data, info.width, info.height), DHASH_W, DHASH_H);
}
