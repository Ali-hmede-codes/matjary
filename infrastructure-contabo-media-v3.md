# Infrastructure Plan: Contabo VPS + Media Pipeline (v3)

> Goal: a showcase platform with many visitors, lots of photos and videos, small storage use, good quality, modern formats. Hosting: Contabo.

## Current architecture and scope
1. **Application:** NestJS 11/Node.js 22.12+, MySQL 8.4 and Redis/BullMQ. The backend serves its administrator dashboard; a separate customer frontend is not included.
2. **Media storage and delivery:** local disk is the selected mode now, including deployment. API and worker share a persistent volume at `/var/lib/matjary/media`; no S3 account or credentials are required. The API streams authorized bytes, so disk and network capacity are shared with the application.
3. **Processing:** a separate non-root worker runs Sharp and FFmpeg. CPU/memory limits reduce interference but do not guarantee API latency under overload.

S3 remains optional. No payment gateway, HLS, or AV1 is included. Repository changes are not a production deployment or a production-readiness certification.

## Historical research (not reverified)
The following are the old document's claims, retained only as research leads. Prices, bandwidth allowances, request limits, CDN arrangements, browser percentages and codec comparisons have **not** been reverified. None is a current procurement assumption or launch guarantee; confirm official terms and measure your own workload. HLS references are background only, not implemented scope.

| Historical topic | Previously recorded claim — unverified | Original source |
|---|---|---|
| Contabo Cloud VPS plans | Range from about 4 vCPU / 8 GB RAM up to 18 vCPU / 96 GB RAM, NVMe/SSD disks (roughly 75–600 GB depending on plan and source), 1 Gbit/s port, DDoS protection. Traffic is listed as 32 TB/month by one source and "unlimited / fair use" by others. Plan names and prices differ between sources, so check contabo.com. Reviews warn the vCPUs are shared/oversold and performance can vary. | [vpsbenchmarks](https://www.vpsbenchmarks.com/hosters/contabo/plans/cloud-vps-50), [learnwithhasan](https://learnwithhasan.com/self-hosting-hub/vps-providers/contabo-vps/), [toolradar](https://toolradar.com/tools/contabo/pricing) |
| Contabo Object Storage | S3-compatible; from €2.49 (about $2.99) per 250 GB per month; no data-transfer fees. Public files are rate limited to 250 requests/second per file. Outbound traffic goes through Contabo's Cloudflare CDN arrangement. | [Contabo blog](https://contabo.com/blog/most-storage-per-euro-vps-comparison/), [Owncast docs](https://owncast.online/docs/storage/contabo/) |
| Image formats | AVIF is about 92–96% supported; WebP about 97%+. AVIF is roughly 20–30% smaller than WebP but slower to encode. AVIF at quality 50 looks similar to JPEG at quality 75 at about half the size. Use `<picture>` with AVIF → WebP → JPEG fallback. | [hiredigital](https://hiredigital.com/blog/jpg-vs-webp-vs-avif-2026), [pixconvert](https://www.pixconvert.com/blog/webp-vs-avif-next-gen-image-formats) |
| Video codecs | H.264 plays everywhere. In one test, H.265 needed about 45% less bitrate than H.264 and AV1 about 35% less than H.265. Fragmented MP4 (CMAF) is the most compatible container for HLS/DASH. | [cococonvert](https://cococonvert.com/blog/h264-vs-h265-vs-av1), [BlazingCDN](https://blog.blazingcdn.com/en-us/video-file-formats-explained-containers-vs-codecs) |
| Cloudflare and video | Cloudflare's CDN allows video/large files only when hosted on a Cloudflare service (R2, Stream, Images). Video hosted elsewhere (e.g. on your VPS) is restricted on its CDN. | [Cloudflare blog](https://blog.cloudflare.com/updated-tos/) |
| FFmpeg HLS flags | `-f hls -hls_time 6 -hls_playlist_type vod -hls_list_size 0 -hls_segment_filename ...`; `-hls_segment_type fmp4`; multiple renditions via `-var_stream_map` + `-master_pl_name`. | [docs.rs example](https://docs.rs/crate/ez-ffmpeg/latest/source/examples/cli_emitted_hls.rs), [OTTVerse](https://ottverse.com/hls-packaging-using-ffmpeg-live-vod/) |

## VPS sizing and limits
- Start with one media job (`MEDIA_WORKER_CONCURRENCY=1`), two worker CPU cores and 2 GB memory. Compose also budgets API 768 MB, MySQL 2 GB and Redis 512 MB. Reserve additional memory for the OS, proxy, filesystem cache, container runtime, and backups. Tune against actual workload; these are not validated concurrency guarantees.
- Local storage capacity must cover processed variants, pending originals, worker temporary input/output, MySQL/Redis, logs and backup staging. Keep operational headroom and alert before disk/inodes fill. Increasing worker concurrency multiplies temporary-disk and memory demand.
- Separate workers or multiple API nodes require a coordinated shared-storage strategy or an object migration. Independent local volumes will not work as one media store.
- Use a supported Ubuntu LTS and benchmark actual CPU/disk/network performance. Verify the selected provider's current plan and transfer limits; shared CPU performance can vary.
- phpMyAdmin is an administration UI, not a database engine. Keep its optional `tools` profile private behind loopback/SSH/VPN.

## Local bandwidth trade-offs
A nominal 1 Gbit/s port is at most 125 MB/s before protocol overhead and contention; it is not a promised viewer capacity. At 2 Mbps, a 30-second clip is about 7.5 MB and 1,000 complete plays transfer about 7.5 GB. Measure bitrate distributions, cache hit rates, API latency and actual monthly transfer. Local delivery is simpler now but competes for the same server/network resources. Move delivery later when measured limits justify the operational cost.

## 🖼️ Image Pipeline
1. Owner negotiates an asset, then streams its bytes to the encoded `/api/v1/uploads/:key` URL with the owner session. Only pending, unexpired, owned originals can be written, with exclusive promotion, byte limits, deadline and disconnect cleanup. Ordinary JSON remains limited to 16 KB.
2. Completion checks actual stored size and transactionally creates a unique outbox record. Worker dispatch/reconciliation retries missing jobs with deterministic IDs.
3. Worker validates signatures, decoded dimensions and pixel count; auto-orients and strips EXIF/GPS. AVIF55/WebP80/JPEG84 variants target widths 480/1080/1600 without upscaling. Persist actual output dimensions/bytes.
4. Commit READY variants before removing the original; storage deletion failures remain retryable. Expired/failed uploads are cleaned after the default 24-hour retention, excluding active processing.
5. Public downloads serve only READY variants on published, unmoderated posts with active owners/parents. Owner access remains restricted to unmoderated content; allowlisted administrators can privately preview registered bytes. Private responses use `private, no-store`. Published variants are immutable URLs (the key embeds the asset UUID), so they answer `public, max-age=MEDIA_PUBLIC_CACHE_SECONDS` (default 3600) plus an `ETag`, and revalidating clients get a bodyless `304`. That window is what lets one VPS serve many visitors: unpublishing blocks new origin requests immediately, but a browser or shared proxy may still hold bytes for up to the configured max-age. Set `MEDIA_PUBLIC_CACHE_SECONDS=0` to restore per-request revalidation. Trusted MIME types, `nosniff`, and single-byte ranges are enforced. Do not bypass the authorization route with an unguarded static directory.
6. The reverse proxy can keep a copy of published media in `proxy_cache` (see the generated Nginx locations). Private/owner responses carry `no-store` and are never stored; range requests bypass the cache. Serving cached images from Nginx, not Node, is the difference between a few hundred and many thousands of concurrent viewers on the same box.

```ts
import sharp from 'sharp';

const widths = [480, 1080, 1600];
for (const w of widths) {
  const base = sharp(inputBuffer).rotate().resize({ width: w, withoutEnlargement: true });
  await base.clone().avif({ quality: 50 }).toFile(`${id}-${w}.avif`);
  await base.clone().webp({ quality: 75 }).toFile(`${id}-${w}.webp`);
  await base.clone().jpeg({ quality: 80 }).toFile(`${id}-${w}.jpg`);
}
```
```html
<picture>
  <source srcset="photo-1080.avif" type="image/avif">
  <source srcset="photo-1080.webp" type="image/webp">
  <img src="photo-1080.jpg" alt="..." loading="lazy" width="1080" height="1350">
</picture>
```
This snippet illustrates encoding choices, not the full validation/timeout pipeline. Compare all three formats on real photos before changing defaults.

## Video pipeline and configuration
- Hard ceilings: images 10 MiB; video 200 MiB, 90 seconds, 1080p-equivalent input. Subscription limits can be stricter. Null/unlimited subscription settings never bypass global safety limits.
- Validate container, streams, finite duration and dimensions before expensive encoding. Generate one aspect-preserving, no-upscale H.264 MP4 up to 720p (CRF 20, 4 Mbit/s ceiling, 160 kbit/s AAC) plus a near-lossless JPEG poster. Strip metadata/chapters, constrain input protocols, threads, output size and subprocess lifetime. HLS and AV1 are outside current scope.
- `MEDIA_JOB_TIMEOUT_MS` and `MEDIA_UPLOAD_TIMEOUT_MS` default 300000, maximum 900000. `MEDIA_TEMP_DIR` defaults `.tmp/media`; use bounded fast local temporary storage. `FFMPEG_PATH`/`FFPROBE_PATH` default to binaries on PATH and exist only in the worker image. Always smoke-test the installed version.
- `MEDIA_MAX_IMAGE_PIXELS` defaults 40000000. `.env.example` and `libs/config/src/environment.ts` define current names and validated bounds; old `VIDEO_*`/`IMAGE_*` placeholder variables are not used.
- BullMQ retries transient processing failures; permanent validation or exhausted attempts marks FAILED. Idempotent variants/outbox recovery prevent lost completion requests from leaving assets stranded.

## Capacity measurement
Measure the sum of all nine image variants (three widths × three formats), MP4/poster pairs, pending original reservations and temporary encoding output. Small inputs may produce duplicate dimensions because upscaling is disabled. Use representative uploads to estimate median/p95 bytes and encoding time; fixed per-photo estimates are not reliable across content. Plan media growth and retention separately from database storage, and test disk-full failures before launch.

Feed requests are built for a crowd: media assets, variants, durable counters, live Redis state and the viewer's likes are each read once per page (not once per card), anonymous visitors share one cached ranking pass for 20 seconds, and explore categories and website branding have short in-process caches. Concurrent visitors therefore mostly cost bandwidth, not database queries.

Bandwidth is the remaining ceiling. With a 1 Gbit/s port, 10,000 simultaneous viewers can only be served if the bytes come from caches: publish `Cache-Control` max-ages that match your moderation policy, keep the Nginx media cache enabled, and measure the origin hit rate (`proxy_cache` status, API request rate) under a realistic load test before promising a capacity figure. Once cached delivery saturates the port, move media to object storage or a CDN — the application code does not change.

## TLS, proxy and future object delivery
- Terminate HTTPS at a maintained Caddy/Nginx reverse proxy. Set exact HTTPS `APP_ORIGIN`, register the Google client origin and set `TRUST_PROXY_CIDRS` to only the actual proxy addresses. Never trust arbitrary forwarded headers. The API binds `0.0.0.0:3000` inside containers but publishes only to host loopback.
- Preserve encoded keys/range headers and owner cookies. Disable request-body buffering for upload routes or separately budget and limit proxy temporary files. Apply a 200 MiB maximum media body and compatible timeouts while leaving JSON at 16 KB. Keep private/auth responses out of shared caches. Forward root crawler paths (`/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/ai.txt`) to their `/api/v1/seo/` endpoints if exposing those conventional paths. The generated snippet also answers link-preview user agents at `/` from `/api/v1/seo/share` so the shared site link follows the current website name, tagline, description, and sharing image instead of the static build.
- Local `STORAGE_PUBLIC_BASE_URL` defaults to the application origin. Keep delivery same-origin where owner cookies are needed; do not expose the underlying volume directly.
- Future S3 migration: choose a private bucket/provider, copy objects with exact case-sensitive keys, verify counts/size/checksums, test signed uploads and private/public delivery, pause writes or synchronize the delta, switch configuration, and retain a recoverable local copy until validation. A configuration flip alone does not migrate bytes.
- Any CDN needs current contractual approval for the selected video use, verified limits/pricing and cache/privacy testing. Earlier CDN/price/traffic claims in this document were not reverified and are not deployment assumptions.

## Deployment and database recovery
- Run commands from `backend/`. `infra:up` remains local dependencies only; `stack:up` explicitly selects the app profile. Migrations are explicit (`db:migrate` locally); runtime never synchronizes schema automatically.
- Production combines `infra/compose.yaml` and `infra/compose.production.yaml` with an explicit private `APP_ENV_FILE`. Keep the production Compose project name stable to retain named MySQL/Redis/media volumes. Both application images run as the matching `node` user and share the same media mount path; verify ownership and persistence across recreation without deleting volumes.
- CI runs typecheck, formatting, unit/integration tests and all three builds. Deployment requires manual workflow dispatch with `deploy=true`, main branch and configured production environment approval. It serializes releases, builds a clean worktree at the selected SHA, stops writers, runs compiled migrations, then checks API readiness and worker heartbeat. Configure SSH host fingerprint and narrowly scoped deployment credentials; no deployment is performed by this repair work.
- A failed migration leaves applications stopped. MySQL DDL may already have committed even if `schema_migrations` lacks the row. Preserve logs and backups; inspect the failing migration and `SHOW CREATE TABLE`/indexes/constraints against its intended steps. Reproduce recovery on an isolated restore, then apply an explicitly reviewed forward repair or restore the coordinated backup. Do not blindly rerun, mark migrations complete, reset databases, or remove volumes.
- Before changing these corrected initial migrations on any preexisting scaffold database, inspect its schema separately. The repair assumes no existing data; it does not authorize destroying a schema.

## Backups, monitoring and acceptance gates
- Back up **both media and MySQL**, encrypted to a private off-server destination chosen by the operator (another server/disk service is acceptable; S3 is optional). Same-VPS copies and named volumes are not backups. Schedule consistent InnoDB dumps (`mysqldump --single-transaction`) plus media snapshots/manifests; pause uploads/cleanup briefly or use coordinated snapshots to avoid missing referenced files. Consider binary logs for point-in-time recovery.
- Preserve necessary private configuration separately. Rehearse restoring database plus media into an isolated environment, verifying checksums, ownership, download authorization and representative media. Record recovery time/data-loss objectives and retention; remote schedules/destinations are not provisioned here.
- Redis runs AOF with `appendfsync everysec` and `noeviction`. Engagement batches never expire and durable MySQL receipts prevent replay double-counting, but complete Redis loss can lose unflushed events; everysec can lose recent writes on a crash. Monitor persistence health and account for that recovery point.
- Alert on API readiness, worker stale heartbeat, queue lag/retries/failed assets/outbox age, cleanup backlog, MySQL errors/connections, Redis memory/AOF errors, CPU, RAM, disk/inodes, transfer and backup freshness. Heartbeat is a dependency/consumer liveness signal, not proof every job succeeds.
- Operational prerequisites remain: host hardening/firewall/SSH keys/security updates, TLS certificates, trusted proxy verification, private off-server backups, restore rehearsal, monitoring installation, disk/network capacity tests and production load approval. Unit/build success alone does not satisfy these gates.

## Administrator dashboard and real Google setup
- Dashboard: `/api/v1/admin`; sign-in: `/api/v1/auth/login`. Dashboard assets and APIs require a current administrator session. Accounts are created by their first real Google login, not by administrator-generated identities.
- In Google Auth Platform, create/select a project, complete branding and audience configuration, and create a **Web application** OAuth client. Add the exact application origin to **Authorized JavaScript origins**: `http://localhost:3000` locally and the real HTTPS origin in production. Add your Google account as a test user if required by the audience configuration. This popup ID-credential flow does not need a client secret or a redirect URI.
- Set these values in the private application environment, then restart the API. Never put passwords, session cookies, or Google ID credentials in configuration or source control:
  ```env
  APP_ORIGIN=http://localhost:3000
  GOOGLE_CLIENT_ID=<public-web-client-id>.apps.googleusercontent.com
  ADMIN_EMAILS=<your-google-account-email>
  ```
- Sign in personally with that account. Admin rights are derived from the server allowlist; the dashboard cannot change the allowlist or Google identity/email. Existing users not on the list retain ordinary account access. Versioned sessions deliberately require a fresh login once after this migration. Suspending/restoring a user or revoking sessions invalidates their old sessions.
- Administrator Delete is reversible archive/suspension. Archive flags preserve publication and processing state, suppress descendants, and cannot be cleared by owner or worker saves. Audit/financial history is immutable through the API. Archived bytes still count toward quotas. Failed media can be retried only while a valid original is retained and no active processing exists.

## Private Linux monitoring setup (operator action)
- The dashboard shows API/worker process measurements separately from real host readings. Linux host charts require the opt-in `infra/compose.monitoring.yaml` overlay. Windows without that collector displays unavailable VPS readings, never invented zero usage.
- Choose an existing **private Docker bridge gateway IPv4** on the Linux VPS, such as its actual `docker0` address, and set `MONITORING_HOST_ADDRESS`. Do not assume the example `172.17.0.1` matches your host. The validation script rejects missing addresses, public/non-Docker interfaces, and Windows.
- From `backend/` on the authorized Linux host, run `npm run monitoring:init` as UID 1000 or root after setting the bridge address. It creates `.monitoring/metrics-token` exclusively, without printing it. Protect and preserve the file; set `METRICS_TOKEN_HOST_FILE` to its absolute path in the private Compose environment. Do not commit or display the token. Rotation requires a new private file and coordinated API/Prometheus restart.
- Combine `infra/compose.yaml`, `infra/compose.production.yaml`, and `infra/compose.monitoring.yaml` with `--profile app` and the existing private deployment environment. Run `npm run monitoring:validate` for a secret-free structural check using synthetic values; validate the private operator configuration with `docker compose ... config --quiet` before any separately authorized deployment. Never print expanded Compose configuration containing credentials. The overlay sets the API's internal `PROMETHEUS_URL` and `METRICS_TOKEN_FILE`; the browser never receives the scrape token.
- node_exporter uses the host PID/network namespaces and read-only root mount, binding only the validated private bridge address. Prometheus has **no published port**, uses a private bridge network with routing to that host address, and retains 7 days / 2 GB at 15-second collection. API/worker receive no host mounts, Docker socket, privileged mode, shell, or reboot control. Keep host firewall rules blocking external access to exporter ports.
- Include `infra/nginx/monitoring-private.conf` in the public TLS server (or equivalent Caddy deny rules). It returns 404 for `/api/v1/internal/metrics`; the underlying endpoint also requires the private bearer token. Do not add public Prometheus or exporter proxy routes.
- Validate configuration on Linux with `promtool check config` and `promtool check rules` from the pinned Prometheus image, using the same read-only config/secret mounts. After installation, compare CPU, RAM, root disk/inodes, network rates, load, and uptime against actual host tools before describing the charts as live VPS monitoring.
- MySQL stores sanitized, fingerprinted error groups: default `ERROR_RETENTION_DAYS=30`, at most 10,000 groups, bounded queues/batches, worker-side pruning. Error-storage outages use sanitized stderr and dropped counters without blocking requests. Administrative audit writes are mandatory and transactional. No raw request bodies, cookies, SQL arguments, or exception messages are captured.
- Built-in alert rules cover missing host/API/worker data, high CPU/RAM, disk/inodes, dependencies, elevated 5xx and processing/cleanup backlog. Email/Telegram notifications and backup-freshness checks require a separately configured provider/signal. The dashboard cannot remain reachable during an API outage; Prometheus continues independently, but off-site outage notification is not supplied.
- Verification from `backend/`: `npm run typecheck`, `npm run format:check`, `npm test`, and `npm run build`. `npm run test:admin:browser` starts a **test-only loopback fixture on port 3105**, using in-memory providers and no real authentication/data connections. Its `/api/v1/fixture/admin`, `/owner`, `/expire`, `/up`, and `/unavailable` controls are compiled only as test code, never registered in the production application. It auto-stops after 30 minutes. This fixture does not verify real Google sign-in or live host measurements. `npm run load:check -- --url=... --include-media` is a read-only warm-cache load probe for staging; it refuses non-loopback hosts unless `--allow-remote` is passed.

## 📚 References
- [Contabo Object Storage guide (Owncast)](https://owncast.online/docs/storage/contabo/)
- [Contabo storage comparison](https://contabo.com/blog/most-storage-per-euro-vps-comparison/)
- [Cloudflare terms update](https://blog.cloudflare.com/updated-tos/)
- [AVIF vs WebP 2026](https://hiredigital.com/blog/jpg-vs-webp-vs-avif-2026)
- [H.264 vs H.265 vs AV1](https://cococonvert.com/blog/h264-vs-h265-vs-av1)
- [HLS with FFmpeg](https://ottverse.com/hls-packaging-using-ffmpeg-live-vod/)
