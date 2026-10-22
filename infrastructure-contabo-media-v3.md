# Infrastructure Plan: Contabo VPS + Media Pipeline (v3)

> Goal: a showcase platform with many visitors, lots of photos and videos, small storage use, good quality, modern formats. Hosting: Contabo.

## 🧠 Mental Model
Three things must be kept apart, because they stress the server differently:
1. **App** (Next.js + NestJS + MySQL 8.4): mostly cheap reads, easy to cache.
2. **Media storage + delivery** (images, video files): lots of bytes. Keep it **off the VPS disk and off the VPS network port**; use object storage.
3. **Media processing** (resize photos, encode videos): spiky and CPU-heavy. Run it in a **background worker** so it never slows the website.

## 🔍 Research Summary
| What I Searched | What I Found | Source |
|---|---|---|
| Contabo Cloud VPS plans | Range from about 4 vCPU / 8 GB RAM up to 18 vCPU / 96 GB RAM, NVMe/SSD disks (roughly 75–600 GB depending on plan and source), 1 Gbit/s port, DDoS protection. Traffic is listed as 32 TB/month by one source and "unlimited / fair use" by others. Plan names and prices differ between sources, so check contabo.com. Reviews warn the vCPUs are shared/oversold and performance can vary. | [vpsbenchmarks](https://www.vpsbenchmarks.com/hosters/contabo/plans/cloud-vps-50), [learnwithhasan](https://learnwithhasan.com/self-hosting-hub/vps-providers/contabo-vps/), [toolradar](https://toolradar.com/tools/contabo/pricing) |
| Contabo Object Storage | S3-compatible; from €2.49 (about $2.99) per 250 GB per month; no data-transfer fees. Public files are rate limited to 250 requests/second per file. Outbound traffic goes through Contabo's Cloudflare CDN arrangement. | [Contabo blog](https://contabo.com/blog/most-storage-per-euro-vps-comparison/), [Owncast docs](https://owncast.online/docs/storage/contabo/) |
| Image formats | AVIF is about 92–96% supported; WebP about 97%+. AVIF is roughly 20–30% smaller than WebP but slower to encode. AVIF at quality 50 looks similar to JPEG at quality 75 at about half the size. Use `<picture>` with AVIF → WebP → JPEG fallback. | [hiredigital](https://hiredigital.com/blog/jpg-vs-webp-vs-avif-2026), [pixconvert](https://www.pixconvert.com/blog/webp-vs-avif-next-gen-image-formats) |
| Video codecs | H.264 plays everywhere. In one test, H.265 needed about 45% less bitrate than H.264 and AV1 about 35% less than H.265. Fragmented MP4 (CMAF) is the most compatible container for HLS/DASH. | [cococonvert](https://cococonvert.com/blog/h264-vs-h265-vs-av1), [BlazingCDN](https://blog.blazingcdn.com/en-us/video-file-formats-explained-containers-vs-codecs) |
| Cloudflare and video | Cloudflare's CDN allows video/large files only when hosted on a Cloudflare service (R2, Stream, Images). Video hosted elsewhere (e.g. on your VPS) is restricted on its CDN. | [Cloudflare blog](https://blog.cloudflare.com/updated-tos/) |
| FFmpeg HLS flags | `-f hls -hls_time 6 -hls_playlist_type vod -hls_list_size 0 -hls_segment_filename ...`; `-hls_segment_type fmp4`; multiple renditions via `-var_stream_map` + `-master_pl_name`. | [docs.rs example](https://docs.rs/crate/ez-ffmpeg/latest/source/examples/cli_emitted_hls.rs), [OTTVerse](https://ottverse.com/hls-packaging-using-ffmpeg-live-vod/) |

## 🖥️ VPS Sizing (planning guide, confirm with a load test)

| Stage | What runs | Suggested Contabo size |
|---|---|---|
| **1. Launch** | One server: reverse proxy (Caddy/Nginx), Next.js, NestJS, MySQL 8.4, Redis, media worker (1 job at a time) | 6–8 vCPU, 12–24 GB RAM, 100 GB+ NVMe. Minimum workable: 4 vCPU / 8 GB. Media files NOT on this disk. |
| **2. Growth** | Split into 3: (a) web + API, (b) database, (c) media worker | (a) 8 vCPU / 24 GB, (b) 8 vCPU / 24–32 GB NVMe (consider a dedicated-core plan), (c) 6–8 vCPU only when queue is busy |
| **3. Big** | 2+ web/API nodes behind a load balancer, MySQL 8.4 primary + replica, separate Redis, several workers | Scale horizontally; consider moving video to a managed service if encoding load grows |

- **OS:** latest Ubuntu LTS. **Backend scaffold:** NestJS 11 on Node.js 22 LTS (22.12+).
- **Deploy:** Docker Compose (one compose file per server), GitHub Actions → SSH.
- **Security:** SSH keys only, firewall (ufw), fail2ban, automatic security updates.
- **Backups:** nightly `mysqldump --single-transaction` for InnoDB tables (and later binary-log archiving for point-in-time recovery) to private object storage; test a restore.
- **Database administration:** phpMyAdmin manages MySQL; it is not a database engine. Keep it private on localhost, behind an SSH tunnel, or on a VPN. The API uses MySQL through TypeORM + mysql2, not through phpMyAdmin.
- **Monitoring:** Uptime Kuma + simple CPU/RAM/disk alerts.
- **Caveat:** Contabo CPUs are shared, so benchmark your actual VPS before launch and keep the database on a plan you trust. Ask for a data center near most visitors.

## 🧮 Why not serve video from the VPS?
A 1 Gbit/s port is about 125 MB/s. At about 1 Mbps per stream, that is roughly 1,000 simultaneous viewers at the theoretical best, and your website and API share that port. Serve media from object storage instead.

## 🖼️ Image Pipeline
1. Owner uploads **directly to object storage** with a pre-signed URL (the API never touches the bytes).
2. API enqueues a job (BullMQ + Redis).
3. Worker with `sharp`: auto-rotate, **strip EXIF/GPS**, resize to 3 widths, encode **AVIF + WebP**.
4. Store only the processed versions (keep originals for a short time or not at all).
5. Page serves `<picture>` with AVIF → WebP → JPEG fallback.

```ts
import sharp from 'sharp';

const widths = [480, 1080, 1600];
for (const w of widths) {
  const base = sharp(inputBuffer).rotate().resize({ width: w, withoutEnlargement: true });
  await base.clone().avif({ quality: 50 }).toFile(`${id}-${w}.avif`);
  await base.clone().webp({ quality: 75 }).toFile(`${id}-${w}.webp`);
}
```
```html
<picture>
  <source srcset="photo-1080.avif" type="image/avif">
  <source srcset="photo-1080.webp" type="image/webp">
  <img src="photo-1080.jpg" alt="..." loading="lazy" width="1080" height="1350">
</picture>
```
Start at AVIF quality 50 / WebP 75 and compare visually on real photos; adjust per quality vs size.

## 🎬 Video Pipeline
**Phase 1 (simple, reliable):** limit uploads (e.g. 60–90 s, max 1080p, max 200 MB). Worker makes one **720p H.264 MP4** + poster image, then deletes the original.
```bash
ffmpeg -i in.mp4 -vf "scale=-2:720" -c:v libx264 -crf 26 -preset medium \
  -c:a aac -b:a 96k -movflags +faststart out.mp4
```
**Phase 2 (smoother on weak connections):** HLS with 2–3 renditions (360p / 720p / 1080p), fMP4 segments:
```bash
ffmpeg -i in.mp4 -c:v libx264 -crf 23 -c:a aac -f hls -hls_time 6 \
  -hls_playlist_type vod -hls_list_size 0 -hls_segment_type fmp4 out.m3u8
# multiple renditions: use -var_stream_map and -master_pl_name
```
**Phase 3 (smaller files):** add **AV1** (e.g. SVT-AV1) only for popular videos, keeping H.264 as fallback. AV1 encoding on a shared CPU is slow, so queue it for off-peak hours.

Always test on your FFmpeg version.

## 📦 Storage Estimate (rough rules of thumb; verify with your own uploads)
- Photo: about 50–150 KB per size in AVIF, so about 200–400 KB for 3 sizes (+WebP copies roughly double that).
- 720p H.264 clip: about 1–2 Mbps, so a 30 s clip is about 4–8 MB.
- 100,000 photos ≈ 40–80 GB with AVIF + WebP; 10,000 short clips ≈ 40–80 GB.
- Object storage is sold in 250 GB steps (€2.49 each), so this is cheap. Do not store media on the VPS disk.

## 🌐 CDN Plan
- Put **Cloudflare (free)** in front of the **website pages** (DDoS protection, caching).
- For **images/video**: use Contabo Object Storage on its own domain (no egress fees). Remember the **250 requests/second per file** limit; if one viral file hits it, move media to **Cloudflare R2** (S3-compatible, zero egress fees) with no code change, because both speak the S3 API.
- Do **not** proxy large video hosted on your VPS through Cloudflare's CDN; their terms restrict video not hosted on their services.

## ⚠️ Gotchas
- **Upload abuse:** size/time limits, rate limits, magic-byte file-type checks, no executable files.
- **Worker isolation:** run FFmpeg with `nice`, concurrency 1, timeouts and a memory limit so one bad video cannot freeze the server.
- **Privacy:** strip GPS/EXIF from photos; strip metadata from videos.
- **Lifecycle:** delete originals and failed temp files; set bucket lifecycle rules.
- **Database:** use bounded mysql2/TypeORM connection pools per API/worker process; budget total connections across nodes. Manage schema changes with migrations, not manual phpMyAdmin edits. Consider ProxySQL only if a database proxy is needed later.
- **Load test** (k6) before launch and after each stage.

## 🚦 Next steps
1. Order a Stage-1 VPS and benchmark it (CPU, disk, network).
2. Create the object storage bucket + test a pre-signed upload.
3. Build the image pipeline first (biggest win), then video Phase 1.

## 📚 References
- [Contabo Object Storage guide (Owncast)](https://owncast.online/docs/storage/contabo/)
- [Contabo storage comparison](https://contabo.com/blog/most-storage-per-euro-vps-comparison/)
- [Cloudflare terms update](https://blog.cloudflare.com/updated-tos/)
- [AVIF vs WebP 2026](https://hiredigital.com/blog/jpg-vs-webp-vs-avif-2026)
- [H.264 vs H.265 vs AV1](https://cococonvert.com/blog/h264-vs-h265-vs-av1)
- [HLS with FFmpeg](https://ottverse.com/hls-packaging-using-ffmpeg-live-vod/)
