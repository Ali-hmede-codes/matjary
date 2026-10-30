# Matjary Performance Review and AI Fix Handoff

## First patch implemented locally (not deployed)

The [refresh scheduler](backend/apps/api/src/modules/seo/share-shell.service.ts#L65-L141) now:

- Uses one change-check timer at `SHARE_SHELL_REFRESH_SECONDS` (120 seconds by default). The separate 15-second watcher is removed.
- Skips unchanged content, with a recovery pass when an hour has elapsed since the last successful full refresh. Boot, explicit SEO/branding requests, and the deployment refresh hook remain supported.
- Checks template availability before database access; missing, empty, or unreadable templates leave the refresher database-idle until a later check.
- Shares the entire in-flight check/generation, including slow fingerprint queries. A failed forced refresh remains retryable, and an explicit request during a pass leaves the next poll dirty.
- Acknowledges only the fingerprint captured before a successful pass, so a newer fingerprint observed on the next poll is not silently swallowed. Atomic file replacement, full-pass stale-shell cleanup, and public-content filtering are unchanged.

**Expected scheduling reduction at default settings:** on an unchanged, otherwise idle site, full passes fall from roughly 30/hour to roughly 1/hour, and periodic fingerprint checks from roughly 240/hour to roughly 30/hour. These are frequency changes, not measured VPS CPU savings; startup, explicit requests, changes, and pass duration affect actual counts.

**Trade-off and remaining work:** ordinary content changes without an explicit refresh signal are detected at the configured interval, not every 15 seconds. Aggregate database scans still exist at this lower frequency, and a detected change still regenerates the entire catalog. Durable per-entity dirty work and bounded catalog batching below remain follow-ups. No migration, new environment variable, frontend change, or production configuration change was made.

**Verification:** seven focused shell tests passed, including four new scheduling regressions and existing rendering/path/pruning coverage; backend typechecking, changed-TypeScript Prettier checks, and `git diff --check` passed. No full test suite, build, browser session, load test, or production operation was run.

## Original review scope and confidence

- Reviewed baseline revision: `9bea2cf`. The baseline findings and their evidence references below describe that revision, before the scheduler patch above; use current code for the implemented behavior.
- Requested scope: home/feed, stores, categories, menu loading, posts, and product detail URLs.
- The original review was read-only, not a production profile or an exhaustive clearance of every endpoint. Its strongest findings were background workloads that compete with all these pages.
- No application code, deployment settings, or database data were changed during the original review. Implementation and verification are recorded separately above.
- The actual deployed revision, configuration, data size, query plans, and VPS CPU/RAM/disk measurements were not available. The findings below are confirmed baseline code behavior; their contribution to the reported spikes still needs measurement.

## Priorities

| Priority | Finding | Likely resources affected | Status |
| --- | --- | --- | --- |
| 1 | Whole-site social-preview regeneration on an unconditional timer | MySQL queries, API allocations/CPU, filesystem reads and traversal | Confirmed code behavior |
| 2 | Database-wide content fingerprint every 15 seconds | MySQL CPU and buffer-pool reads; disk reads on cache misses | Confirmed code behavior |
| Next | Product/category request waterfalls, feed cache misses, media delivery | Depends on the measured request mix | Follow-up checks, not established causes of the VPS spikes |

Start with priorities 1 and 2 together. Reducing frontend requests alone will not remove work that happens without visitors.

## 1. Unchanged content still triggers whole-site regeneration

### Evidence

- [ShareShellService scheduling](backend/apps/api/src/modules/seo/share-shell.service.ts#L64-L78) calls `fullPass()` on every configured interval, without checking whether content changed.
- [The configuration template](backend/.env.example#L128-L133) sets `SHARE_SHELL_REFRESH_SECONDS=120`. The deployed value has not been verified.
- [runRefresh](backend/apps/api/src/modules/seo/share-shell.service.ts#L124-L220) loads all public stores, then their categories, products, and posts, generating metadata page by page. Products and posts are loaded without batch limits within each store.
- [Product metadata](backend/apps/api/src/modules/seo/seo.service.ts#L1447-L1531) resolves product SEO, settings, preview imagery, and structured data. [Structured-data images](backend/apps/api/src/modules/seo/seo.service.ts#L1772-L1781) also resolve individual image keys.
- [writePage and prune](backend/apps/api/src/modules/seo/share-shell.service.ts#L224-L282) read existing HTML and walk generated directories. Skipping identical writes does not skip metadata generation, queries, rendering, or file reads.

### Why this matters

At the default interval, approximately 30 scheduled full passes per hour can run even when nobody edits or visits the website. Actual completed passes depend on duration: the existing `pending` promise prevents overlapping refreshes within one API process.

The work grows with the entire catalog, not the one shop or product a visitor opens. It runs inside the API service and competes for the same database and VPS resources as browsing requests. This is a plausible source of periodic latency and resource spikes, not proof that it is the only source.

### Remediation

1. Make frequent scheduled refreshes change-gated. Keep boot/deployment regeneration and a separately scheduled, infrequent reconciliation pass for missed changes.
2. Address finding 2 at the same time: switching the timer to the current `tick()` alone still performs broad database scans.
3. Preserve the existing single-flight behavior. Do not parallelize the entire catalog with an unbounded `Promise.all`.
4. Batch reconciliation by stable IDs instead of hydrating every product/post in a store at once. Load common SEO/settings data once per pass or batch; batch media/variant lookups and reuse results during that batch.
5. Retain atomic HTML publication, path containment, correct public-content checks, and cleanup of renamed/unpublished pages.
6. For the durable solution, regenerate only the changed entity and dependent pages, as described below.

Increasing `SHARE_SHELL_REFRESH_SECONDS` is only a partial operational mitigation: it does not slow the separate 15-second watcher. Do not change production configuration without approval.

## 2. The change watcher scans content tables every 15 seconds

### Evidence

- [The watcher](backend/apps/api/src/modules/seo/share-shell.service.ts#L37-L39) has a fixed `15_000` millisecond period, independent of the full-refresh configuration.
- [tick](backend/apps/api/src/modules/seo/share-shell.service.ts#L113-L122) queries the fingerprint before deciding whether another full pass is necessary.
- [contentFingerprint](backend/apps/api/src/modules/seo/share-shell.service.ts#L285-L307) contains four `COUNT(*)` subqueries and ten `MAX(updated_at)` subqueries spanning content, media, SEO, and branding tables.
- The template availability check happens in `runRefresh`, after the watcher's query. Its `finally` block also queries the fingerprint even when there is no template ([lines 124-129 and 217-220](backend/apps/api/src/modules/seo/share-shell.service.ts#L124-L220)).

### Why this matters

A small result row does not mean a cheap query. Exact InnoDB counts require scanning qualifying index/table entries; unindexed maxima can also scan growing tables. The repository review found no supporting timestamp indexes for the major content/SEO aggregates, but deployed indexes and access paths need verification.

When no refresh is running, the watcher can schedule about 240 checks per hour per API process. It still queries the database when optional preview generation is unavailable. Disk impact depends on what is already in MySQL's buffer pool.

The refresh single-flight guard does not itself guard a slow fingerprint query while that query is awaiting completion.

### Remediation

1. Check whether preview generation is usable before any database poll. If its template/mount is absent, remain idle and use a low-frequency filesystem-only availability retry.
2. Replace catalog-wide aggregates with a small durable revision/dirty-work record updated by relevant committed mutations.
3. Guard the entire poll/refresh lifecycle against overlapping scheduled work, not just HTML generation.
4. Acknowledge only the revision actually processed. A change committed during a pass must remain pending for another pass.
5. Do not treat adding timestamp indexes as a complete solution: it would not remove the full counts or unconditional full regeneration.

## Durable preview refresh design

This is a proposed follow-up implementation, not a change made by this review.

- Use durable MySQL dirty-work/outbox state for affected public page/store IDs, recorded in the same transaction as the content mutation. Redis/BullMQ may deliver work, but a lost in-memory signal must not lose the pending change.
- [ShareShellSignal](backend/apps/api/src/modules/seo/share-shell.signal.ts#L11-L34) currently debounces a callback; it is a wake-up mechanism, not a durable queue. Reuse it only as a prompt to inspect durable work. Inventory its call sites before changing scheduling; do not assume all mutations already signal it.
- Coalesce work by entity/store and process bounded batches with one refresher. Claim/acknowledge jobs safely if multiple API instances are used.
- Include publication/archive changes, slug/category renames, product stock/price/image changes, store branding/design/verification changes where reflected in metadata, SEO settings, website branding, and worker media-ready transitions.
- Track old generated paths for renames/unpublishing. A partial pass must not call the current global `prune(keep)` with a partial keep-set; that would remove unrelated shops' pages.
- A template or global branding change legitimately affects many pages: enqueue a bounded reconciliation, rather than doing it inline in an owner request.
- Keep a low-frequency full reconciliation as recovery, with a complete generation manifest before global pruning. Do not prune after an incomplete/failed pass.
- If a new table/index is needed, add and register a TypeORM migration. Do not use schema synchronization or run rollback tests against application data.
- If intervals/batch sizes become configurable, keep `.env.example`, configuration validation, and configuration reads synchronized.
- Do not move generation to the worker without explicitly arranging template/share-directory access and deployment ownership. The current share-directory mount belongs to the API deployment path.

## Requested browsing paths: observations and next actions

The safeguards below are not a guarantee that the endpoints are inexpensive at production scale.

### Home/feed and category filtering

**Observed:** [getExploreFeed](backend/apps/api/src/modules/showcases/services/feed-explore.service.ts#L475-L506) shares cached/in-flight work for resolved visitors. Other viewer types do not take that cache branch. [Feed enrichment](backend/apps/api/src/modules/showcases/services/feed-explore.service.ts#L1004-L1058) batches media, variants, counters, and store reads.

**Next:** Compare one cold and one repeated request using the same filter/cursor, and distinguish anonymous from signed-in traffic. Inspect ranking query plans only if those requests are expensive after background work is reduced. Do not replace existing batched enrichment with per-card lookups or share personalized likes/cart data between visitors. This pass does not clear every directory/business-category endpoint or all homepage request fanout.

### Store and menu

**Observed:** [StorePage menu query](frontend/src/components/StorePage.tsx#L431-L473) requests up to 60 products per page, applies a category filter on the server, and is enabled only for the active catalog tab. It does not fetch the entire catalog in a single unbounded request. [The backend list](backend/apps/api/src/modules/products/products.service.ts#L80-L96) uses `findAndCount`, ordered pagination, and a category relation.

**Next:** Measure response bytes, database time, image transfers, and requests when switching tabs/sections. Sixty products plus images may be excessive for an initial viewport, but a page-size reduction should follow measurement. If deep offsets/counts are expensive, inspect the actual filtered ordering query before considering composite indexes or cursor pagination; preserve accurate navigation/count behavior.

### Category URLs

**Observed:** [StoreCategoryPage](frontend/src/components/StoreCategoryPage.tsx#L49-L108) loads store details, then categories, then a category-filtered product page of 24 items. Categories have a five-minute client stale time.

**Next:** The dependent requests can increase visible loading latency; they are not themselves proof of high server CPU. Inspect one cold navigation and a back-navigation. Reuse shared shop/category data where safe. If category resolution dominates, consider a server-resolved category slug endpoint that returns the necessary category context without making the browser download products just to discover a category.

### Product slug URLs

**Observed:** [StoreProductPage](frontend/src/components/StoreProductPage.tsx#L59-L114) requests store details, then enables the product and category queries, and initializes the shop cart hook. Website settings are another shared dependency. Actual network requests depend on existing query cache state and hook behavior. [Product lookup](backend/apps/api/src/modules/products/products.service.ts#L135-L168) is a direct slug predicate with a category relation, not application-side iteration over the catalog. Its actual database access path still needs an index/plan check if slow.

**Next:** Separate product JSON time from store/category/cart latency and image download time. A store-to-product request waterfall can make loading feel slow even if each query is cheap. If measurements justify it, resolve public store/product context in one bounded endpoint or safely enable independent lookups earlier. Preserve shop ownership matching, publication/moderation rules, and owner-only draft access. Keep cart data private; defer cart loading only if the existing cart-badge/checkout experience remains correct.

Do not assume the SEO generator runs inside every normal SPA product request. Static preview generation and live product JSON are separate paths that can compete for shared resources.

### Posts, images, and videos

**Observed:** [AutoplayVideo](frontend/src/components/AutoplayVideo.tsx#L119-L151) pauses inappropriate playback and releases far-away/inactive sources. [The media route](backend/apps/api/src/modules/showcases/media.controller.ts#L148-L206) authorizes access, supports ranges, and streams with disconnect cleanup. It supplies public cache headers for public variants and private/no-store for nonpublic media.

**Next:** Capture how many videos buffer concurrently during a normal scroll, bytes transferred per post, and whether repeated image/video requests hit a cache. Inspect the installed Nginx configuration, not only repository snippets, especially range-request cache bypass and cookie handling. Measure direct post-URL loading separately from the feed. Browser decode/render cost is not VPS CPU; uncached origin streams and their authorization queries are server costs.

Do not add an unrestricted static media alias or cache private responses. Any public-media caching change must retain the existing bounded visibility/revocation behavior. Keep Sharp/FFmpeg in the worker, and correlate worker encoding activity separately from API/MySQL activity.

## Lightweight verification plan

Respect the owner's request to avoid extensive tests. No stress test or full-suite run is needed just to confirm this report.

1. **Use existing metrics:** Compare a three-minute idle window with one ordinary home -> store -> category -> product -> post session. Record API, MySQL, and worker CPU separately, memory, disk I/O, request durations, and transferred bytes. Observe pass timing; do not repeatedly refresh pages to manufacture load.
2. **Use one query plan if needed:** Inspect plain `EXPLAIN` for the existing fingerprint and relevant installed indexes. Avoid `EXPLAIN ANALYZE` on a busy production server because it executes the query. Do not enable noisy global SQL logging by default.
3. **After a scheduling fix:** Add a small focused regression in the existing `backend/test/unit/seo-share.test.ts`: unchanged ticks do not regenerate the catalog; unavailable templates do not trigger content-table scans; a change arriving during a pass is not lost. Existing public/private and stale-shell behavior must remain intact.
4. **After implementation:** Run the focused test selection and appropriate typecheck/format checks once. Expand verification only if schema, authorization, or deployment behavior changes. Never run destructive integration tests against the real database.

Acceptance signals: idle browsing-independent queries fall; unchanged content stops causing frequent full metadata/file passes; edited previews still update within the agreed freshness window; unpublished/renamed URLs do not retain old shells; request latency/bytes do not regress.

## Instructions for the next AI

> Read the implemented-patch status above and current code first; do not redo the scheduling mitigation or mistake it for a complete performance fix. Next, use a lightweight production observation if access is authorized, then address remaining aggregate scans/full-catalog work with durable targeted refreshes and bounded batches. Do not broadly rewrite feed/store/product code based only on suspected bottlenecks. Preserve SEO/share functionality, stale-shell cleanup, public/private media access, shop boundaries, and cart isolation. Use a few targeted checks, not a load test or repeated full-suite runs. Explain what changed, what was measured versus inferred, and any remaining bottleneck. Do not deploy, change production configuration, migrate production data, commit, or push without explicit approval.
