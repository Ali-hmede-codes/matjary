import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { ProcessingLimits } from '@app/database';

// Native file caching can retain handles after metadata reads (notably on
// Windows), preventing per-attempt cleanup. Keep CPU use bounded as well.
sharp.cache({ files: 0 });
sharp.concurrency(2);
const execute = promisify(execFile);
export class InvalidMediaError extends Error {}
// Originals are removed after processing, so these variants are the only copy
// owners and visitors ever see. Keep the tiers and widths unchanged (bounded
// storage/CPU) but encode them at a slightly higher quality than the earlier
// AVIF50/WebP75/JPEG80 baseline.
const IMAGE_QUALITY = { avif: 55, webp: 80, jpeg: 84 } as const;
export interface EncodedVariant {
  label: string;
  file: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: string;
  durationMs: number | null;
}
export interface EncodingResult {
  width: number;
  height: number;
  durationMs: number | null;
  variants: EncodedVariant[];
}
export interface EncodingOptions {
  limits: ProcessingLimits;
  signal: AbortSignal;
  deadline: number;
  ffmpeg: string;
  ffprobe: string;
}

function remaining(options: { signal: AbortSignal; deadline: number }): number {
  options.signal.throwIfAborted();
  const time = options.deadline - Date.now();
  if (time <= 0) throw new Error('Media processing deadline exceeded');
  return time;
}

export async function validateSignature(
  file: string,
  mime: string,
): Promise<void> {
  const handle = await fs.open(file, 'r');
  const bytes = Buffer.alloc(32);
  try {
    await handle.read(bytes, 0, bytes.length, 0);
  } finally {
    await handle.close();
  }
  const ftyp = bytes.toString('ascii', 4, 8) === 'ftyp';
  const valid: Record<string, boolean> = {
    'image/jpeg': bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
    'image/png': bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/webp':
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP',
    'image/avif': ftyp && /avif|avis/.test(bytes.toString('ascii', 8)),
    'video/mp4': ftyp,
    'video/quicktime': ftyp,
    'video/webm': bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])),
  };
  if (!valid[mime]) throw new InvalidMediaError('Unsupported media signature');
}

export async function encodeImage(
  input: string,
  directory: string,
  options: EncodingOptions,
): Promise<EncodingResult> {
  const { limits } = options;
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, {
      limitInputPixels: limits.maxPixels,
      failOn: 'warning',
    })
      .timeout({ seconds: Math.max(1, Math.ceil(remaining(options) / 1000)) })
      .metadata();
  } catch {
    remaining(options);
    throw new InvalidMediaError('Invalid image');
  }
  remaining(options);
  if (
    !metadata.width ||
    !metadata.height ||
    (metadata.pages ?? 1) > 1 ||
    !['jpeg', 'png', 'webp', 'heif'].includes(metadata.format ?? '')
  )
    throw new InvalidMediaError('Unsupported image');
  const rotate = (metadata.orientation ?? 1) >= 5;
  const width = rotate ? metadata.height : metadata.width;
  const height = rotate ? metadata.width : metadata.height;
  if (
    width > limits.maxWidth ||
    height > limits.maxHeight ||
    width * height > limits.maxPixels
  )
    throw new InvalidMediaError('Image dimensions exceed the limit');
  const variants: EncodedVariant[] = [];
  for (const target of [480, 1080, 1600]) {
    for (const format of ['avif', 'webp', 'jpeg'] as const) {
      const label = `${format}-${target}`;
      const file = path.join(
        directory,
        `${label}.${format === 'jpeg' ? 'jpg' : format}`,
      );
      // Sharp strips metadata by default. Orientation is applied to pixels first.
      const image = sharp(input, {
        limitInputPixels: limits.maxPixels,
        failOn: 'warning',
      })
        .rotate()
        .resize({ width: target, withoutEnlargement: true })
        .timeout({
          seconds: Math.max(1, Math.ceil(remaining(options) / 1000)),
        });
      const info = await image
        .toFormat(format, { quality: IMAGE_QUALITY[format] })
        .toFile(file);
      remaining(options);
      variants.push({
        label,
        file,
        mimeType: `image/${format}`,
        width: info.width,
        height: info.height,
        sizeBytes: String(info.size),
        durationMs: null,
      });
    }
  }
  return { width, height, durationMs: null, variants };
}

export interface ShareCardOptions {
  background: string;
  signal: AbortSignal;
  deadline: number;
}

// Social clients crop link images to a wide card. Draw the shop logo on a
// branded 1200x630 panel so the preview is readable in every client instead
// of stretching a square logo.
const SHARE_CARD_WIDTH = 1200;
const SHARE_CARD_HEIGHT = 630;
const SHARE_CARD_BACKGROUND = '#254e40';

export async function encodeShareCard(
  input: string,
  directory: string,
  options: ShareCardOptions,
): Promise<EncodedVariant> {
  const background = /^#[0-9a-f]{6}$/iu.test(options.background)
    ? options.background
    : SHARE_CARD_BACKGROUND;
  const file = path.join(directory, 'share-card.jpg');
  const timeout = {
    seconds: Math.max(1, Math.ceil(remaining(options) / 1000)),
  };
  let logo: Buffer;
  let logoWidth = 0;
  let logoHeight = 0;
  try {
    const resized = await sharp(input, { failOn: 'warning' })
      .rotate()
      .resize({
        width: 440,
        height: 340,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90 })
      .timeout(timeout)
      .toBuffer({ resolveWithObject: true });
    logo = resized.data;
    logoWidth = resized.info.width;
    logoHeight = resized.info.height;
  } catch {
    remaining(options);
    throw new InvalidMediaError('Invalid image');
  }
  remaining(options);
  // Only validated hex colors reach this markup, so no font or script exists.
  const frame =
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" viewBox="0 0 ${SHARE_CARD_WIDTH} ${SHARE_CARD_HEIGHT}">
<defs>
<linearGradient id="shade" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#ffffff" stop-opacity="0.1"/>
<stop offset="1" stop-color="#000000" stop-opacity="0.24"/>
</linearGradient>
</defs>
<rect width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" fill="${background}"/>
<rect width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" fill="url(#shade)"/>
<circle cx="1060" cy="80" r="240" fill="#ffffff" fill-opacity="0.07"/>
<circle cx="120" cy="580" r="200" fill="#ffffff" fill-opacity="0.05"/>
<rect x="330" y="95" width="540" height="440" rx="46" fill="#ffffff"/>
</svg>`);
  try {
    const info = await sharp(frame)
      .composite([
        {
          input: logo,
          left: Math.round((SHARE_CARD_WIDTH - logoWidth) / 2),
          top: Math.round((SHARE_CARD_HEIGHT - logoHeight) / 2),
        },
      ])
      .jpeg({ quality: 86 })
      .timeout(timeout)
      .toFile(file);
    remaining(options);
    return {
      label: 'share-1200',
      file,
      mimeType: 'image/jpeg',
      width: info.width,
      height: info.height,
      sizeBytes: String(info.size),
      durationMs: null,
    };
  } catch {
    remaining(options);
    throw new InvalidMediaError('Share card encoding failed');
  }
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  disposition?: { attached_pic?: number };
}
interface Probe {
  streams?: ProbeStream[];
  format?: { duration?: string; format_name?: string };
}
async function run(
  tool: string,
  args: string[],
  options: EncodingOptions,
): Promise<string> {
  const result = await execute(tool, args, {
    signal: options.signal,
    timeout: remaining(options),
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return result.stdout;
}
async function probe(file: string, options: EncodingOptions): Promise<Probe> {
  const output = await run(
    options.ffprobe,
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file,pipe',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      file,
    ],
    options,
  );
  return JSON.parse(output) as Probe;
}

export async function encodeVideo(
  input: string,
  directory: string,
  options: EncodingOptions,
): Promise<EncodingResult> {
  const { limits } = options;
  let source: Probe;
  try {
    source = await probe(input, options);
  } catch (error) {
    remaining(options);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    throw new InvalidMediaError('Invalid video container');
  }
  const videos =
    source.streams?.filter((stream) => stream.codec_type === 'video') ?? [];
  const stream = videos[0];
  if (
    videos.length !== 1 ||
    !stream?.width ||
    !stream.height ||
    stream.disposition?.attached_pic ||
    source.streams?.some(
      (item) => !['audio', 'video'].includes(item.codec_type ?? ''),
    ) ||
    !/mov|mp4|matroska|webm/.test(source.format?.format_name ?? '')
  )
    throw new InvalidMediaError('Unsupported video streams');
  const duration = Number(source.format?.duration ?? stream.duration);
  const width = stream.width;
  const height = stream.height;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > limits.maxDurationSeconds ||
    Math.max(width, height) > Math.max(limits.maxWidth, limits.maxHeight) ||
    Math.min(width, height) > Math.min(limits.maxWidth, limits.maxHeight)
  )
    throw new InvalidMediaError('Video exceeds duration or resolution limits');
  const output = path.join(directory, 'mp4-720.mp4');
  const poster = path.join(directory, 'poster-jpeg.jpg');
  const scale =
    "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
  const inputArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-protocol_whitelist',
    'file,pipe',
    '-threads',
    '2',
    '-i',
    input,
  ];
  await run(
    options.ffmpeg,
    [
      ...inputArgs,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-vf',
      scale,
      '-filter_threads',
      '1',
      '-threads',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      // Higher detail within the unchanged 720p frame: a lower CRF plus a
      // roomier rate ceiling. 4 Mbit/s still keeps a 90 s clip well under the
      // 200 MiB output guard and the small-host CPU budget.
      '-crf',
      '20',
      '-maxrate',
      '4M',
      '-bufsize',
      '8M',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-t',
      String(limits.maxDurationSeconds),
      '-fs',
      '209715200',
      '-movflags',
      '+faststart',
      '-y',
      output,
    ],
    options,
  );
  const result = await probe(output, options);
  const video = result.streams?.find((item) => item.codec_type === 'video');
  const actualDuration = Number(result.format?.duration);
  if (
    !video?.width ||
    !video.height ||
    !Number.isFinite(actualDuration) ||
    actualDuration <= 0 ||
    Math.abs(actualDuration - duration) > 1
  )
    throw new InvalidMediaError('Incomplete video output');
  await run(
    options.ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-protocol_whitelist',
      'file,pipe',
      '-threads',
      '2',
      '-i',
      output,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      // The poster is the feed preview for videos, so keep it near-lossless
      // instead of ffmpeg's lower default MJPEG quality.
      '-q:v',
      '2',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-threads',
      '2',
      '-y',
      poster,
    ],
    options,
  );
  const posterInfo = await sharp(poster).metadata();
  const durationMs = Math.round(actualDuration * 1000);
  const variants: EncodedVariant[] = [
    {
      label: 'mp4-720',
      file: output,
      mimeType: 'video/mp4',
      width: video.width,
      height: video.height,
      sizeBytes: String((await fs.stat(output)).size),
      durationMs,
    },
    {
      label: 'poster-jpeg',
      file: poster,
      mimeType: 'image/jpeg',
      width: posterInfo.width ?? video.width,
      height: posterInfo.height ?? video.height,
      sizeBytes: String((await fs.stat(poster)).size),
      durationMs: null,
    },
  ];
  return { width, height, durationMs, variants };
}
