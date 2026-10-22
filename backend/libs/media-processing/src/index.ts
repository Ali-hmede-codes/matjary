// Worker-only image and video processing; never import this library into the API.
// Plan: sharp for AVIF/WebP/JPEG variants with EXIF/GPS removal.
// Phase 1: FFmpeg for 720p H.264 MP4 plus a poster and metadata removal.
// Later: HLS renditions and selective AV1 with H.264 fallback.
// FFmpeg/ffprobe must be installed in the future worker runtime, not via npm.
export * from './encode';
