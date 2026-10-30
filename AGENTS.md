# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Matjary is a showcase platform (photos + short videos). This repo contains the **NestJS backend** under `backend/`; the planned frontend is not included. `infrastructure-contabo-media-v3.md` describes the current deployment: **local disk media storage, including production**, with optional S3 later. No cloud account is required now. Provider changes require copying/verifying objects and arranging delivery, not only changing configuration.

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

# Verification — run all four before finishing any change
npm run typecheck
npm run format:check   # or npm run format to fix
npm test               # isolated unit tests (node:test)
npm run build          # API, worker, and compiled migration runner

# One file / one test name
node -r ./test/setup-unit.cjs -r ts-node/register -r tsconfig-paths/register --test test/unit/auth.test.ts
node -r ./test/setup-unit.cjs -r ts-node/register -r tsconfig-paths/register --test --test-name-pattern "rate" test/unit/auth.test.ts

# Integration tests — DESTRUCTIVE (runs migration rollback). Requires infra up and a
# dedicated EMPTY database whose name ends in _test:
#   PowerShell: $env:MYSQL_DATABASE='matjary_test'; npm run test:integration

# Migrations
npm run db:migration:show
npm run db:migration:generate   # then register the class in libs/database/src/database.options.ts
npm run db:migrate
npm run db:migration:revert     # destructive; never on real data

npm run stack:up      # explicit application profile; migrations remain explicit
npm run start:api      # production entry: node dist/apps/api/main.js (start:worker similarly)
```

**Gotcha:** the `test` script lists unit files explicitly in package.json — register every new test. Its preload removes inherited application configuration and tests do not load `.env`. Integration tests use explicitly supplied isolated connection settings; never point rollback tests at application data.

## Architecture

Nest 11 monorepo (`nest-cli.json`, `monorepo: true`): API, worker, compiled migration runner, and shared libs imported via `@app/*` aliases (see tsconfig `paths`).

- `apps/api` — HTTP API (Express). Global prefix `api/v1`; `/` redirects to `/api/v1/auth/login`. The starter login page is inline HTML/JS in `modules/auth/auth.page.ts`. `setup-app.ts` wires helmet (CSP allows accounts.google.com), 16kb JSON body limit, a strict global ValidationPipe, and `Cache-Control: no-store`.
- `apps/worker` — `createApplicationContext` only, **no HTTP listener**. Queue consumers go in `apps/worker/src/jobs/`. Its purpose: CPU-heavy media encoding must never run in the API process.
- `libs/config` — fail-fast env validation. `validateEnvironment` (app) and `validateDatabaseEnvironment` (migration CLI needs MySQL creds only) in `environment.ts`, wired through `ConfigModule.forRoot({ validate, cache, isGlobal })`. Bad env crashes at boot. Production requires HTTPS `APP_ORIGIN` and a `GOOGLE_CLIENT_ID`.
- `libs/database` — TypeORM + MySQL 8.4. `synchronize: false` and `migrationsRun: false`: schema changes happen **only** through files in `libs/database/src/migrations/`, which must also be registered in the `migrations` array of `database.options.ts` (used by both the CLI and the webpack bundles). `data-source.ts` is the standalone CLI DataSource and loads `.env` from the CWD, so migration commands only work from `backend/`. Entities in `entities.ts`: User, Showcase (draft/published/archived), MediaAsset (image/video; pending/processing/ready/failed), MediaVariant (labels like `avif-480`, `mp4-720`). Conventions: BIGINT kept as strings (`bigNumberStrings`), `timezone: 'Z'`, sensitive columns (`passwordHash`, `googleSubject`) are `select: false`, storage keys use `utf8mb4_bin` (case-sensitive), all FKs `ON DELETE RESTRICT`. A product's optional `compareAtPriceCents` is display-only (crossed-out old price and sale badge): `priceCents` stays the only amount carts and checkout charge, and the API refuses an old price at or below it (`PRODUCT_SALE_PRICE_INVALID`).
- `libs/queue` — bounded fail-fast producer/request connections and dedicated BullMQ consumer connections (`maxRetriesPerRequest: null`). Worker-only engagement flushing stages immutable Redis batches, commits MySQL receipts and counters transactionally, then acknowledges only the matching batch. Pending state never expires. Complete Redis loss can still lose unflushed activity; configure AOF/noeviction and backups.
- `libs/storage` — selected local/S3 provider, bounded streaming and metadata operations. Local paths reject traversal and symlink escapes; originals are written exclusively. `libs/media-processing` is worker-only Sharp/FFmpeg encoding, never imported into the API.
- `libs/database/subscription-policy.ts` — shared effective-plan policy, start/expiry handling, nullable quotas. The free plan is a one-time trial (`FREE_TRIAL_DAYS`, default 3) started on first sign-in; without an effective subscription all quotas/features fail closed, published content stays public, and owner writes return `TRIAL_EXPIRED`. Media storage is unlimited for every plan; only global file-size/duration ceilings apply. Posts use one total maximum (`maxTotalPosts`); the legacy monthly quota is not enforced. The `FreeTrialSubscriptions` migration must run before the new API starts so existing accounts receive their rollout window. Owner row locks serialize post/product/upload reservations. Boost reservations never debit wallets; spending and ledger receipts commit together using integer-safe arithmetic and operation IDs. An administrator assigning a plan must supply the recipient's phone number: Lebanon (+961) is the default, any other country or a complete `+` number is accepted, and `SubscriptionPlansService.assignSubscription` stores the normalized value on `users.phone`.

### Verification badges

Verification is a monthly subscription, not a one-time flag. Owners apply from the shop dashboard's Verification tab with their name and a normalized Lebanese phone number (`store_verification_requests`); only the shop owner may apply, and an administrator approves or rejects the request. Plans decide the economics: `maxVerificationBadges` bundles badge slots and `verificationBadgePriceCents` sells a monthly add-on beyond them. A badge granted from a bundled slot sets `verification_included_in_plan` on the store: it is paid by the subscription, so it ends when the subscription ends (a still-running paid month is never cut short), and assigning or cancelling a subscription re-syncs or ends it in `SubscriptionPlansService`. Add-on badges (flag false) keep a 30-day month from `max(now, current expiry)` and never occupy a bundled slot; a shop is priced as included only when it already holds a bundled badge or a free bundled slot exists, otherwise it pays `verificationBadgePriceCents`. After a month ends, `libs/database/src/verification-policy.ts` keeps the blue tick visible for 5 grace days and then hides it; every storefront/feed badge check and the frontend `isStoreVerified` mirror those constants. Approving, extending, or revoking a store closes any pending request for it. An administrator can also grant a lifetime badge (`POST admin/verification/stores/:id/unlimited`) for special shops: it has no expiry and no plan slot, so subscription changes never shorten it, owner renewals are refused, and only a revoke removes it. Do not treat `has_verification_badge` alone as visible — always use the policy helper.

### Authentication and authorization

- `POST /auth/bootstrap` issues a random nonce: stored SHA-256-hashed in Redis (TTL 600s), returned as the GIS nonce, set as an HttpOnly cookie. `POST /auth/google` verifies the ID credential (`GoogleTokenVerifier`: signature, issuer, expiry, exact audience, azp, nonce, verified email), consumes the nonce with GETDEL (replay-proof), then `UsersService.findOrCreateGoogleUser` matches by `googleSubject` (never auto-links an email that already exists) and is race-safe against `ER_DUP_ENTRY`. Session = opaque 32-byte token; only its SHA-256 hash is stored (`matjary:auth:session:<hash>`, TTL `AUTH_SESSION_TTL_SECONDS`, default 7 days). Every login rotates the previous session; logout revokes it.
- Cookies `matjary_session` / `matjary_nonce`: HttpOnly, SameSite=Lax, path=/; `__Host-` prefix when `APP_ORIGIN` is HTTPS.
- Guards (`auth/guards/auth.guards.ts`): mutating auth routes require `AuthOriginGuard` (Origin === `APP_ORIGIN`, JSON content type) + `AuthRateLimitGuard` (30/min per IP+action, Redis INCR with 60s window). `SessionGuard` resolves `request.user` from the session cookie. `request.ip` is only meaningful behind a configured trusted proxy.
- Routes: `GET /auth/login`, `GET /auth/client.js`, `POST /auth/bootstrap`, `POST /auth/google`, `GET /auth/me`, `POST /auth/logout`.
- `ADMIN_EMAILS` is the server-derived allowlist. Subscription assignments/plans, global SEO/redirects/IndexNow and badge revocation require admin checks. Tenant SEO is owner-authorized in services using validated DTOs. Public lists/media/SEO exclude drafts. Mutation guards enforce exact origin and rate limits; binary uploads use the non-JSON origin guard.
- Administrator reach is two-tier (`users.admin_scope`). `all` is the historic platform-wide administrator; `stores` limits the admin workspace to the shops in `admin_store_assignments`. `PATCH admin/users/:id/role` accepts `scope` + `storeIds` when promoting, and `PATCH admin/users/:id/scope` changes only the shop list. `requireAdmin` defaults to global access, so every privileged operation stays platform-only unless it explicitly opts into `{ scope: 'any' }`; panel reads do, then filter by the returned `AdminStoreScope`. Store-scoped administrators may read their shops, products, and posts and hide/restore their content; users, plans, subscriptions, boost, verification, branding, SEO, media retry, purge, and store creation remain global. Configured `ADMIN_EMAILS` accounts always keep global reach. Assignments are deleted on demotion and before a permanent shop purge. The `AdminStoreScopes` migration must run before the new API starts.
- Platform administrators create shops with `POST admin/stores` (`ownerId` required) without consuming the owner's `maxShops` allowance; an administrator-owned shop created from the owner dashboard also skips plan checks. Both paths are audited (`store.create`).
- `PATCH admin/stores/:id` lets a platform administrator correct a shop's public identity: `name`, `slug`, `description`, `brandColor`, `storeType`, and `businessCategory`, with a reason audited as `store.update`. Store-scoped administrators cannot use it, and lifecycle status, plans, verification, and moderation keep their own operations. A slug change does not create a redirect, so old storefront links stop resolving; identity edits refresh tenant SEO and IndexNow.
- Anonymous carts use server-generated HttpOnly cookies, not query visitor IDs. Authenticated/anonymous carts are isolated; no automatic merge policy.

### Health

`/api/v1/health/live` (static) and `/ready` (MySQL `SELECT 1` + Redis `PING`, 2s timeout each, shared in-flight DB probe so timeouts don't fill the pool; 503 with sanitized `{checks}` on failure).

### Media and deployment

Local bytes stream through `/api/v1/uploads/:key` (encoded full keys), without buffering entire videos. PUT requires the pending asset's owner and cannot overwrite originals. Downloads require registered keys: only READY variants on published content are public; originals/drafts require owner sessions and `private, no-store`. Published variants are immutable keys served with `public, max-age=MEDIA_PUBLIC_CACHE_SECONDS` (default 1 hour) plus an `ETag`/`304`, so browsers and an optional `proxy_cache` absorb repeat views while unpublishing stops new origin requests. Downloads support single ranges and trusted MIME types with `nosniff`. Do not expose the media volume using an unguarded static proxy alias.

**Social link previews** use two independent paths. The API's `/seo/share/*` page serves OG tags to crawlers when a reverse proxy intercepts bot user agents; the root path answers the shared site link from live website branding and SEO defaults (the nginx snippet routes `/` crawlers there). Independently, `ShareShellService` prerenders the published SPA `index.html` (with page-specific tags injected) into the web root's `stores/` directory for every public shop, section, product, and shop post, so clean URLs preview correctly on a plain static host. A cheap change check runs between full passes, and shells for pages that no longer exist are pruned so an old slug never keeps answering. A post is shared at `/stores/:shop/post/:slug` (`/post/:slug` when it has no shop), served by the SPA post page from `GET /feed/post/:slug`; share buttons copy that link, never the media URL. The deployment mounts only `WEB_ROOT/stores` read-write at `/srv/share` (API runs as UID 1000) and copies the built index there as the template; without the mount the refresher stays idle. The worker generates a 1200x630 JPEG share card from each shop logo (and backfills existing logos on boot); preview images must be JPEG/PNG in `buildPreviewVariantUrl`, and READY variants of attached store/product images are public.

Completion validates stored bytes and atomically creates a database outbox. Worker recovery retries enqueueing and cleanup. Encoding uses signatures, dimension/duration bounds, per-attempt directories, subprocess deadlines, AVIF55/WebP80/JPEG84 widths 480/1080/1600, and H.264 MP4 (veryfast preset, CRF 22, 4 Mbit/s ceiling) up to 720p plus a JPEG poster captured in the same ffmpeg pass, without upscaling. READY commits before original cleanup. A post may be published while its media is still encoding: public listings and shared links skip it until the first READY variant exists, then it appears without another owner action; owner dashboard reads keep seeing it. Start at one job, 2 CPU and 2 GB; these are tunable defaults, not capacity guarantees. No HLS or AV1 is implemented.

`infra:up` starts local dependencies; `stack:up` selects the `app` profile. Production uses `infra/compose.production.yaml` with explicit environment configuration. API and worker run as the same non-root UID and share `/var/lib/matjary/media`. Containers use service DNS/internal ports; host exposure remains loopback-only. API readiness and worker heartbeat gate releases. `apps/migrations` packages an advisory-lock-serialized runner; MySQL DDL is nontransactional, so failed migrations need schema/ledger inspection before retry.

CI tests/builds changes. Deployment is explicitly dispatched, serialized, and subject to the production environment's approvals. Do not run deployment, database resets, volume removal, or commits/pushes without explicit authorization. TLS/proxy trust, host hardening, private off-server media/database backups, restore rehearsal, monitoring and load approval are operational prerequisites, not implied by passing unit tests.

## Rules to keep

- **No secret leakage.** Every failure path returns generic sanitized messages; the tests assert that raw driver errors, tokens and credentials never appear in responses. Keep that invariant in all new code.
- **Schema changes via migrations only**; the integration suite actually runs rollback, so `down()` must work — and only ever run it against a `_test` database. MySQL DDL is non-transactional, so keep `up()` steps small.
- **Local media uses bounded streaming through authenticated/authorized API routes**; CPU-heavy processing stays out of the API bundle. Preserve the 16 KB ordinary JSON body limit.
- **`.env` is local-only** (gitignored; `env:init` generates its passwords). `.env.example` is the template and the documentation of knobs: keep it, `environment.ts` validation, and any `ConfigService` reads in sync when adding variables.
- Style: Prettier (single quotes, trailing commas, LF) and `strict` TS with `noUncheckedIndexedAccess` — no indexed access without a guard. Comments explain *why* (security rationale especially), matching the existing voice. Tests use `node:test` + `assert/strict` with hand-rolled fakes (see `MemoryRedis` in `test/unit/auth.test.ts`); no jest.
