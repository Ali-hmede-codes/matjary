# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Matjary is a showcase platform (photos + short videos, many visitors). This repo currently contains only the **NestJS backend** under `backend/`; the Next.js frontend is planned as a separate app and is not here yet. `infrastructure-contabo-media-v3.md` (repo root) is the authoritative plan for hosting (Contabo VPS), object storage, CDN and the media pipeline — read it before touching media/storage code.

**All commands run from `backend/`.** Node.js >= 22.12. No ESLint — Prettier + `tsc` only.

## Commands (from `backend/`)

```bash
# First-time setup
npm run env:init      # creates backend/.env with random local passwords
npm run infra:up      # Docker: MySQL 8.4 + Redis 7.4 (phpMyAdmin behind the "tools" profile)
npm run db:migrate

# Development
npm run dev:api       # API with watch: http://127.0.0.1:3000, prefix /api/v1
npm run dev:worker    # media worker with watch (no HTTP listener)

# Verification — run all three before finishing any change
npm run typecheck
npm run format:check   # or npm run format to fix
npm test               # unit tests (node:test)

# One file / one test name
node -r ts-node/register -r tsconfig-paths/register --test test/unit/auth.test.ts
node -r ts-node/register -r tsconfig-paths/register --test test/unit/auth.test.ts --test-name-pattern "rate"

# Integration tests — DESTRUCTIVE (runs migration rollback). Requires infra up and a
# dedicated EMPTY database whose name ends in _test:
#   PowerShell: $env:MYSQL_DATABASE='matjary_test'; npm run test:integration

# Migrations
npm run db:migration:show
npm run db:migration:generate   # then register the class in libs/database/src/database.options.ts
npm run db:migrate
npm run db:migration:revert     # destructive; never on real data

npm run build         # webpack -> dist/apps/api, dist/apps/worker
npm run start:api      # production entry: node dist/apps/api/main.js (start:worker similarly)
```

**Gotcha:** the `test` script lists its four unit files explicitly in package.json — add every new test file there or it never runs.

## Architecture

Nest 11 monorepo (`nest-cli.json`, `monorepo: true`): two deployables plus shared libs imported via `@app/*` aliases (see tsconfig `paths`).

- `apps/api` — HTTP API (Express). Global prefix `api/v1`; `/` redirects to `/api/v1/auth/login`. The starter login page is inline HTML/JS in `modules/auth/auth.page.ts`. `setup-app.ts` wires helmet (CSP allows accounts.google.com), 16kb JSON body limit, a strict global ValidationPipe, and `Cache-Control: no-store`.
- `apps/worker` — `createApplicationContext` only, **no HTTP listener**. Queue consumers go in `apps/worker/src/jobs/`. Its purpose: CPU-heavy media encoding must never run in the API process.
- `libs/config` — fail-fast env validation. `validateEnvironment` (app) and `validateDatabaseEnvironment` (migration CLI needs MySQL creds only) in `environment.ts`, wired through `ConfigModule.forRoot({ validate, cache, isGlobal })`. Bad env crashes at boot. Production requires HTTPS `APP_ORIGIN` and a `GOOGLE_CLIENT_ID`.
- `libs/database` — TypeORM + MySQL 8.4. `synchronize: false` and `migrationsRun: false`: schema changes happen **only** through files in `libs/database/src/migrations/`, which must also be registered in the `migrations` array of `database.options.ts` (used by both the CLI and the webpack bundles). `data-source.ts` is the standalone CLI DataSource and loads `.env` from the CWD, so migration commands only work from `backend/`. Entities in `entities.ts`: User, Showcase (draft/published/archived), MediaAsset (image/video; pending/processing/ready/failed), MediaVariant (labels like `avif-480`, `mp4-720`). Conventions: BIGINT kept as strings (`bigNumberStrings`), `timezone: 'Z'`, sensitive columns (`passwordHash`, `googleSubject`) are `select: false`, storage keys use `utf8mb4_bin` (case-sensitive), all FKs `ON DELETE RESTRICT`.
- `libs/queue` — `RedisService`: one shared ioredis client (`lazyConnect`, no offline queue) exposing get / setWithTtl / remove / consume (GETDEL) / incrementWithTtl / ping. Redis being down means sanitized 503s (fail closed), not hangs.
- `libs/storage`, `libs/media-processing`, `libs/common` — placeholders with plan comments; not wired yet.

### Auth (Google Identity Services — the finished feature)

- `POST /auth/bootstrap` issues a random nonce: stored SHA-256-hashed in Redis (TTL 600s), returned as the GIS nonce, set as an HttpOnly cookie. `POST /auth/google` verifies the ID credential (`GoogleTokenVerifier`: signature, issuer, expiry, exact audience, azp, nonce, verified email), consumes the nonce with GETDEL (replay-proof), then `UsersService.findOrCreateGoogleUser` matches by `googleSubject` (never auto-links an email that already exists) and is race-safe against `ER_DUP_ENTRY`. Session = opaque 32-byte token; only its SHA-256 hash is stored (`matjary:auth:session:<hash>`, TTL `AUTH_SESSION_TTL_SECONDS`, default 7 days). Every login rotates the previous session; logout revokes it.
- Cookies `matjary_session` / `matjary_nonce`: HttpOnly, SameSite=Lax, path=/; `__Host-` prefix when `APP_ORIGIN` is HTTPS.
- Guards (`auth/guards/auth.guards.ts`): mutating auth routes require `AuthOriginGuard` (Origin === `APP_ORIGIN`, JSON content type) + `AuthRateLimitGuard` (30/min per IP+action, Redis INCR with 60s window). `SessionGuard` resolves `request.user` from the session cookie. `request.ip` is only meaningful behind a configured trusted proxy.
- Routes: `GET /auth/login`, `GET /auth/client.js`, `POST /auth/bootstrap`, `POST /auth/google`, `GET /auth/me`, `POST /auth/logout`.

### Health

`/api/v1/health/live` (static) and `/ready` (MySQL `SELECT 1` + Redis `PING`, 2s timeout each, shared in-flight DB probe so timeouts don't fill the pool; 503 with sanitized `{checks}` on failure).

### Planned media pipeline (per infrastructure doc — not built yet)

Uploads go **directly to S3-compatible object storage** via presigned URLs (the API never touches media bytes). The API enqueues BullMQ jobs in Redis; **only the worker consumes them** (start at `MEDIA_WORKER_CONCURRENCY=1`, with timeouts and memory limits). Worker plan: `sharp` → AVIF + WebP variants at widths 480/1080/1600 with EXIF/GPS stripped; FFmpeg → 720p H.264 MP4 + poster, later HLS renditions and selective AV1. FFmpeg/ffprobe come from the runtime image, not npm. `libs/media-processing` must never be imported into the API app. Media is never stored on, or served from, the VPS/API — `media_variants.storage_key` points into object storage. The `S3_*` and `MEDIA_*` variables in `.env.example` are documented placeholders that `validateEnvironment` does not validate yet — extend it when wiring them.

## Rules to keep

- **No secret leakage.** Every failure path returns generic sanitized messages; the tests assert that raw driver errors, tokens and credentials never appear in responses. Keep that invariant in all new code.
- **Schema changes via migrations only**; the integration suite actually runs rollback, so `down()` must work — and only ever run it against a `_test` database. MySQL DDL is non-transactional, so keep `up()` steps small.
- **Media bytes never flow through the API process**, and processing code stays out of the API bundle.
- **`.env` is local-only** (gitignored; `env:init` generates its passwords). `.env.example` is the template and the documentation of knobs: keep it, `environment.ts` validation, and any `ConfigService` reads in sync when adding variables.
- Style: Prettier (single quotes, trailing commas, LF) and `strict` TS with `noUncheckedIndexedAccess` — no indexed access without a guard. Comments explain *why* (security rationale especially), matching the existing voice. Tests use `node:test` + `assert/strict` with hand-rolled fakes (see `MemoryRedis` in `test/unit/auth.test.ts`); no jest.
