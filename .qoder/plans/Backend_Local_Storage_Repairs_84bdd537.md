# Backend Repairs with Local Disk Storage

## Scope and confirmed decisions
- Fix the reported backend defects and update the existing infrastructure document to match the implementation.
- **Local disk is the current storage mode, including deployment. S3 remains optional for the future; no S3 account or credentials are required now.** This supersedes the document's previous object-storage-only requirement.
- The database contains no existing data. Correct the initial migration chain directly; do not reset any database or remove Docker volumes.
- Keep NestJS, MySQL, Redis/BullMQ, and separate API/worker applications. Do not add the frontend, a payment gateway, HLS, or AV1.
- Make repository changes only: no commits, push, production deployment, external account changes, or real-user transactions.

## Startup and database consistency
- Register `AdminGuard`, repair missing authentication imports and repositories in boost/SEO modules, and inject the exported `StorageService` into the worker.
- Replace the incompatible SEO wildcard with Express 5 named-wildcard syntax and normalize the captured path. Test route registration in a Nest application.
- Give BullMQ consumers dedicated Redis connections with `maxRetriesPerRequest: null`; retain bounded, fail-fast connections for API requests and producers. Await orderly queue/connection shutdown.
- Repair migration table names and zero-value backfills, align foreign-key collations, and limit the uniquely indexed SEO source path to 700 characters with matching DTO/entity validation.
- Align all entity columns, indexes, primary keys, timestamps, defaults, and relationships with the migrations. Use natural keys for boost balances/settings and a composite campaign/date key for daily performance; represent SQL DATE values consistently as date strings.
- Move SEO entities into the shared database library, retain a compatibility re-export at their current API path, and register them for both migrations and application bundles.
- Replace the impossible boost target foreign keys with separately constrained nullable store/showcase target columns and a constraint requiring exactly one matching target. Preserve `targetType` and `targetId` in the API through DTO mapping.
- Register migrations for new durability metadata introduced below. Preserve `synchronize: false`, reversible migrations, case-sensitive storage keys, and restrictive foreign-key deletion behavior.

## Authorization and API correctness
- Centralize server-derived administrative checks using the existing configured admin-email allowlist. Require admin authorization for subscription-plan mutations/assignment, badge revocation, global SEO settings, redirects, and IndexNow submission.
- Enforce ownership in services for tenant-specific SEO and badge operations. Never trust `isAdminGrant`, user IDs, store IDs, or entity identifiers supplied in mutation bodies as authorization.
- Replace unrestricted entity-shaped SEO bodies with validated, allowlisted DTOs. Apply origin checks and rate limits to cookie-authenticated mutations; add a binary-upload origin guard without the JSON-only requirement.
- Restrict public product lists to active products regardless of filters. Keep draft access owner-authorized; apply equivalent publication checks to public SEO/media output.
- Replace dashboard `@Query()` request parameters with `@Req()`.
- Add optional session resolution for carts, honoring HTTP and HTTPS cookie names. Issue an opaque, server-generated HttpOnly anonymous-cart cookie and stop accepting query-string visitor IDs as cart credentials. Keep carts isolated by authenticated user or anonymous credential; do not invent an automatic cart-merging policy.
- Implement the existing placeholder SEO slug lookups and auto-generation through real authorized entity lookups. Make category-specific sitemaps filter their results correctly.

## Secure local storage now; retain S3 compatibility
Primary files: `backend/libs/storage/src/`, the showcase media controller/service, and API bootstrap.

- Default configuration and `.env.example` to `STORAGE_PROVIDER=local`. Derive the local media base URL from the application origin unless explicitly configured. Validate S3 settings only when S3 is selected. Preserve unrelated local settings and all secrets.
- Keep existing upload negotiation/completion response shapes. Standardize local byte routes at `/api/v1/uploads/:key`, using encoded keys in generated URLs. Return 404 from these byte routes when S3 is selected.
- Authenticate and authorize each local PUT against its pending media asset and owner; reject expired uploads, arbitrary keys, cross-owner writes, and overwrites. Use generated object names rather than caller-controlled filenames.
- Stream uploads to exclusive temporary files with backpressure, a byte counter, a request deadline, and cleanup on disconnect/failure. Promote completed originals atomically without overwriting. Keep ordinary JSON bodies limited to 16 KB and avoid buffering entire videos in API memory.
- Resolve and validate filesystem containment; reject traversal, absolute paths, Windows drive/backslash escapes, and symlink escapes. Limit access to registered media keys.
- Public downloads may serve only ready variants attached to published content. Original/draft access requires the owner session and `private, no-store`; public responses use a short cache lifetime, trusted MIME metadata, and `nosniff`. Stream downloads and support single-byte-range video requests with correct 206/416 responses.
- Extend the storage abstraction with metadata and bounded streaming operations used by both providers. The worker must use the selected provider, not hardcoded S3.
- Mount one persistent media volume at the same path in API and worker containers with matching non-root permissions. Document that changing providers later requires copying/verifying objects and arranging delivery—not merely flipping an environment variable.

## Media validation, recovery, and isolation
- Enforce actual stored size at completion and again during bounded worker reads. Validate file signatures, decoded image dimensions/pixel count, video container/streams, finite duration, and resolution before expensive encoding. Reject unsupported/executable content.
- Keep the existing default hard ceilings: 10 MB images, 200 MB videos, 90-second video duration, and 1080p-equivalent input dimensions. Apply stricter subscription limits where applicable.
- Auto-orient images, strip metadata, prevent upscaling, and generate AVIF/WebP/JPEG variants at 480/1080/1600 widths. Start with AVIF quality 50, WebP 75, and JPEG 80; persist actual output dimensions and sizes.
- Generate bounded 720p H.264 MP4 plus a JPEG poster, preserving aspect ratio and avoiding upscaling. Strip video metadata/chapters, constrain input protocols, bound FFmpeg threads/output, and enforce subprocess deadlines. Use per-attempt temporary directories and always clean them.
- Make completion idempotent: atomically transition the asset and create a unique database outbox entry. A worker-side dispatcher retries enqueueing with deterministic media job IDs and reconciles processing assets whose jobs disappeared.
- Rethrow processing failures for BullMQ retries; mark terminal failure only after exhausted attempts or permanent validation failure. Upsert deterministic variants safely, skip already-ready work, and commit readiness before deleting originals.
- Add retryable cleanup of successful originals and expired pending/failed uploads. Use a 24-hour retention default, exclude active jobs, and preserve cleanup work when storage removal fails.
- Validate and document concurrency, timeouts, retention, temporary-directory, FFmpeg paths, and media limits consistently. Start at one processing job, two CPU cores, and a 2 GB worker memory limit; treat those resource defaults as tunable, not load-test guarantees.

## Engagement, subscriptions, and coin correctness
### Engagement durability
- Keep Redis buffering and worker-only database flushing; remove the duplicated database-flush implementation from the API service.
- Retain the live like state, hydrated from MySQL on a cold cache. Use atomic Redis operations for toggles, view deduplication, counters, and dirty marking.
- Stage one immutable flush batch per post with a unique batch ID. Commit its like snapshot, view delta, and denormalized counters in one MySQL transaction with a durable batch receipt. Retries must not double-count.
- Acknowledge only the matching committed batch; preserve concurrent incoming events and failed batches. Pending work must not expire. Reads combine persisted values and uncommitted changes without counting a committed-but-unacknowledged batch twice.

### Subscription limits
- Use one effective-plan calculation for dashboard, post creation, products, badges, and uploads. Honor subscription start/expiry dates, free fallback, and null/unlimited plan values bounded by global safety limits.
- Derive store membership from the actual post, not optional request fields. Make quota checks/reservations transactional, count a post once, use UTC monthly boundaries, and release failed-upload reservations.
- Expose the existing assignment operation through an admin-only validated endpoint and replace active assignments transactionally. Do not add paid checkout.

### Boost accounting
- Keep the reservation model: creating a campaign reserves available coins but does not debit the wallet. Include paused and other nonterminal reserved campaigns in availability calculations.
- Cancellation/rejection releases the reservation only; it never credits unspent coins. Repeated terminal operations cannot change balances.
- Serialize balance/campaign mutations with database transactions and consistent row locks. Actual spending updates wallet, ledger, campaign spend, and daily totals together, using unique operation IDs for replay protection.
- Use integer-safe coin arithmetic, enforce nonnegative balances and budget/daily limits, and increment performance totals rather than replacing them with the latest event.

## Deployment configuration and infrastructure document
- Separate development and production Compose settings. Keep `infra:up` usable for local dependencies; provide an explicit application-stack profile. Use service DNS names/internal ports in containers and bind the API to `0.0.0.0` internally while retaining loopback-only host exposure.
- Repair Docker runtime dependencies, keep encoding tools worker-only, and package a compiled migration runner. Add API readiness and worker heartbeat checks, persistent local-media storage, resource limits, and graceful shutdown.
- Update CI to build and run the expanded tests. Change deployment to fail fast, serialize releases, build the selected revision, run migrations explicitly, and verify application/worker readiness before reporting success. Do not trigger deployment during this work.
- Update the existing infrastructure plan, `AGENTS.md`, and configuration comments to describe local disk now and optional S3 later. Include capacity/bandwidth trade-offs, media plus database backups, restore rehearsal, TLS/trusted-proxy setup, monitoring, and recovery from partially applied MySQL DDL. Do not present old provider-price/CDN claims as reverified facts.
- Actual VPS hardening, remote backup scheduling, off-server backup destinations, certificates, monitoring installation, and production load approval remain operational prerequisites—not actions authorized by this repair request.

## Verification and acceptance
- Add regression tests for module wiring, Express routes, all repaired authorization boundaries, draft visibility, dashboard/cart identity, and subscription enforcement.
- Test local upload/download end to end with temporary storage: owner/nonowner access, traversal, wrong provider, oversized/chunked/interrupted uploads, overwrite prevention, media privacy, video ranges, and persistence across container recreation.
- Test EXIF/orientation removal, real output dimensions, invalid/overlong media, FFmpeg timeout cleanup, failed enqueue recovery, duplicate jobs, terminal retries, and original cleanup ordering. Mock S3 operations; no cloud credentials required.
- Test engagement across repeated flushes, view-only activity, cache loss, concurrent writes, database failures, and commit-before-ack crashes. Test concurrent campaign creation/spending/cancellation and repeated accounting operations.
- Expand the migration suite to every registered migration/entity; remove its obsolete assumption that there are only two migrations. Verify fresh migration, no metadata drift, representative inserts, complete rollback, and reapplication only on an explicitly isolated empty `_test` database.
- Run `npm run typecheck`, `npm run format:check`, `npm test`, and `npm run build` from `backend/`. Run Docker, MySQL/Redis integration, and FFmpeg smoke checks when their local dependencies are available; report unavailable checks as unverified rather than passed.
- Handoff must distinguish repaired code and verified local functionality from remaining production operations. No database reset, destructive test against the application database, or automatic production-readiness claim.