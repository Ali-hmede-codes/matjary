# Matjary Backend Performance Review and AI Fix Handoff

## Conclusion and scope

Yes: targeted backend improvements are warranted, especially where work grows with the whole catalog or turns ordinary browsing into database writes. A backend rewrite is not justified by this review.

- Current-code review baseline: `a2b3c12`. Evidence links below refer to this revision; recheck them after subsequent edits.
- Scope: home/feed, stores, categories/menu, product and post URLs, carts, SEO/crawlers, media delivery, engagement persistence, recurring worker jobs, and monitoring. Frontend callers were traced where they explain backend load.
- This is a static code review, not a VPS profile. Production traffic, deployed configuration, installed indexes, database size, cache hit rates, and resource measurements remain unknown.
- Only this report was changed during this review. No application changes, tests, builds, load generators, servers, migrations, or production operations were performed. Existing unrelated work was left untouched.
- Priorities below describe investigation/implementation order, not measured incident severity. Do not promise CPU savings from code inspection alone.

## Already improved: retain these changes

The [share-shell scheduler](backend/apps/api/src/modules/seo/share-shell.service.ts#L65-L141) already:

- Uses one configurable change-check interval, 120 seconds by default; the independent 15-second watcher is gone.
- Skips unchanged fingerprints until hourly recovery, while retaining boot and explicit refresh requests.
- Checks for a usable template before querying the database.
- Shares in-flight polling and generation, preserves retry state, and acknowledges only a successfully processed pre-pass fingerprint.

The original unconditional two-minute full regeneration and independent 15-second watcher described in the earlier `9bea2cf` review are historical findings, not current defects. On a truly unchanged, idle site, scheduling is substantially reduced. However, a watched timestamp can change without an owner edit; see finding 1.

Current code also generates public site shells under `.site` alongside storefront shells. Product/post metadata rendering calls auto-generation with `persist=false`; do not assume rendering always writes SEO rows. Sources: [site pages](backend/apps/api/src/modules/seo/share-shell.service.ts#L150-L169), [product metadata](backend/apps/api/src/modules/seo/seo.service.ts#L1562-L1565), [post metadata](backend/apps/api/src/modules/seo/seo.service.ts#L1649-L1652).

Historical verification: the earlier scheduling patch passed seven focused shell tests, backend typechecking, changed-TypeScript formatting, and whitespace checks. These results were not rerun for the current revision. Deployment status is not verified.

## Applied in this pass

Scoped patches for findings 1–3. Findings 4 and 5 and the durable dirty-work redesign remain open. Nothing was deployed, and no production measurement was taken.

### Finding 1 — engagement no longer invalidates preview shells

- [Engagement flushing](backend/apps/worker/src/jobs/engagement.flush.ts#L119-L139) now writes the denormalised `showcases.likes_count`/`views_count` with a raw statement that pins `updated_at` to itself. MySQL refreshes an auto-updated column on any other column change, so flushed views and likes used to look like content edits and rebuilt every share shell.
- `showcases.updated_at` is therefore a content timestamp for the shell fingerprint; a comment in `share-shell.service.ts` records that invariant.
- [Full generation](backend/apps/api/src/modules/seo/share-shell.service.ts#L146-L300) walks stores, sections, products, and posts in stable-ID keyset batches of 100 instead of loading each collection whole, so a pass is bounded in memory.
- **Still open:** a content edit, publish, branding change, or SEO save still regenerates the entire catalogue, because no durable dirty-store/revision record exists yet (report step 2). That write path remains O(catalogue), and the hourly reconciliation plus full-pass `prune` are unchanged.
- **Checks:** `test/unit/engagement.test.ts` asserts the counter statement pins `updated_at`; the existing shell scheduler and generation tests stay green.

### Finding 2 — catalogue documents are batched, shared, and briefly cached

- [Sitemap generation](backend/apps/api/src/modules/seo/seo.service.ts) reads SEO rows for all stores, products, and posts with one chunked `IN` query per collection, and resolves product images with two batched variant reads per 500 keys (matching variants, then siblings, same `choosePreviewImage` rules).
- Automatic `llms.txt` resolves public products and posts with one chunked read each instead of a lookup per SEO row.
- `sitemap.xml` and its three parts, `llms.txt`, `robots.txt`, and `ai.txt` share one in-flight build and a 60-second body cache. `ShareShellSignal.request()` bumps a content version, so any announced change retires cached documents in every service instance, including short-lived scoped copies.
- Visibility, canonical, and `noindex` behaviour is unchanged; hidden rows stay excluded.
- **Still open:** each document is still a full-catalogue build (bounded per query, not per document), the 60-second TTL is the maximum staleness for a write path that does not announce itself, and a `sitemapindex` with part URLs for very large catalogues was not added.
- **Checks:** `test/unit/seo-share.test.ts` covers batched reads, `noindex` exclusion, one build for concurrent requests, and rebuild after a change signal.

### Finding 3 — cart reads stop writing; checkout batches product reads

- [Cart reads](backend/apps/api/src/modules/carts/carts.service.ts) use a new `findCart` and answer a compatible empty response when no active cart exists, so browsing a cart-enabled shop no longer creates a row. The guard already issues the anonymous cookie; the first real mutation creates the cart.
- A newly created cart is no longer updated a second time for its expiry in the same request. An existing live cart still receives exactly one expiry write per read, preserving the seven-day-on-access policy, and an expired cart reads as empty instead of being recreated.
- `updateItem`, `removeItem`, `clearCart`, and `checkout` read the cart instead of creating one; clearing a missing cart is a no-op.
- Checkout loads every distinct product with one `IN` query, then validates each line against the result map. Per-product stock aggregation across option combinations and server-derived prices are unchanged.
- **Behaviour notes:** the empty response carries `id: ''` and null timestamps. The storefront never reads either value, and add-to-cart still waits for the initial GET, now answered without a write.
- **Checks:** new `test/unit/carts.test.ts`, registered in `package.json`, covers no-write reads, the single expiry update, no redundant creation update, batched checkout reads, shared stock, and empty checkout.

### Verification run

- `npm run typecheck` — pass.
- `npm run format:check` — pass; running `npm run format` also normalised pre-existing indentation in `seo.service.ts`.
- `npm test` — 352 tests pass, including the new cart file.
- `npm run build` — API, worker, and migrations bundles build.

No migration, schema, `.env`, or deployment change was made.

## Prioritized remaining work

| Order | Current behavior | Resources at risk | Recommendation |
| --- | --- | --- | --- |
| 1 — high priority | Engagement timestamps can invalidate every share shell; broad fingerprint scans remain | MySQL, API CPU/memory, filesystem | Separate content invalidation from activity; regenerate bounded dirty work |
| 2 — medium priority | Sitemap and automatic `llms.txt` generation load catalog-sized collections with per-record queries | MySQL round trips, API memory/CPU | Batch reads and share/cache generated artifacts with explicit freshness rules |
| 3 — medium priority | Storefront cart GET creates/touches database rows; checkout rereads each line's product | MySQL writes, row growth, request latency | Avoid eager empty-cart persistence; batch distinct checkout products |
| 4 — medium priority | Explore enriches a wide candidate pool before pagination; signed-in requests bypass the shared response cache | MySQL, Redis bytes, API hydration/ranking | Measure cold/warm paths; separate ranking from final response hydration |
| 5 — scale-dependent | Engagement JSON contains every liker; views-only flushes read all likes | Redis memory/CPU/network, MySQL, worker time | Measure state size, then redesign compact reads and immutable deltas carefully |

Implementation order can change if existing metrics show another workload dominating. Findings 1 and 2 are especially relevant because crawler/background traffic can compete with visitors opening an otherwise inexpensive product URL.

**State after this pass:** findings 1, 2, and 3 have scoped patches (see above). Finding 1's durable dirty-store invalidation, finding 4, and finding 5 remain open and measurement-gated.

## 1. Activity can still trigger whole-catalog preview work

### Evidence and trigger

- [The fingerprint](backend/apps/api/src/modules/seo/share-shell.service.ts#L319-L343) contains four full counts and ten timestamp maxima, including `MAX(showcases.updated_at)`.
- [Engagement flushing](backend/apps/worker/src/jobs/engagement.flush.ts#L119-L139) updates Showcase view/like counters. [The schema](backend/libs/database/src/migrations/1792368000000-InitialSchema.ts#L20-L32) automatically updates that row's timestamp.
- A changed fingerprint triggers [full generation](backend/apps/api/src/modules/seo/share-shell.service.ts#L119-L145): all public stores and then their [categories, products, and posts](backend/apps/api/src/modules/seo/share-shell.service.ts#L179-L247), without per-store product/post batch limits.
- [Identical-file checks and pruning](backend/apps/api/src/modules/seo/share-shell.service.ts#L253-L315) happen after metadata work. They avoid redundant writes, not preceding SQL, rendering, file reads, or traversal.

With a usable template, flushed views/likes can therefore invalidate the catalog even without content edits. Polling costs remain proportional to table/index contents rather than the size of the single returned fingerprint row. Actual elapsed time and disk reads depend on data volume, indexes, and MySQL caching.

### Fix approach

1. Define content invalidation separately from engagement counters. Check whether any preview/structured data needs fresh counters; if so, give that data an explicit bounded refresh cadence instead of invalidating every page for activity.
2. Introduce durable dirty-entity or dirty-store work recorded in the same transaction as relevant content changes. A small revision record can replace the aggregate scan, but a global revision alone does not eliminate full-catalog generation.
3. Inventory all dependencies: edits, visibility/moderation, owner suspension, slug/category renames, product availability/prices/images, SEO/branding, template changes, and worker media-ready changes. Do not remove polling before these paths and recovery are covered.
4. Treat [ShareShellSignal](backend/apps/api/src/modules/seo/share-shell.signal.ts) as a wake-up hint, not durable storage. Coalesce duplicate work, safely claim it, and acknowledge only the processed revision.
5. Generate affected pages and their dependents in bounded stable-ID batches. Read common settings once per batch/pass and batch SEO/media lookups. Do not use unbounded parallel generation.
6. Keep infrequent full reconciliation, also batched. Track old paths for renamed/unpublished entities. Never run global `prune(keep)` with a partial keep-set; it would remove unrelated pages, including `.site` pages.
7. Preserve atomic publication and leave work pending after errors or concurrent edits. Moving generation to the worker requires explicit template/share-directory mounts and ownership changes; the current share mount belongs to the API path.

Do not suppress all `updated_at` changes or remove the watcher as a shortcut: other consumers may rely on timestamps, and publication/branding changes must remain discoverable.

**Small acceptance checks:** engagement-only activity follows the agreed preview policy; a concurrent content edit is processed later; a rename/unpublish removes its old path; partial work never prunes another shop or site page. Add/register a migration only if durable storage/index changes are needed.

## 2. Crawler documents perform catalog-sized request work

### Evidence and trigger

- [Sitemap generation](backend/apps/api/src/modules/seo/seo.service.ts#L2371-L2446) reads matching entity collections, fetches SEO per entity, and resolves product image keys individually.
- [Automatic `llms.txt`](backend/apps/api/src/modules/seo/seo.service.ts#L2093-L2143) reads product/post SEO collections, then looks up each corresponding entity separately. Disabled/custom-content branches avoid that work.
- [Sitemap endpoints](backend/apps/api/src/modules/seo/seo.controller.ts#L60-L113) and [the `llms.txt` endpoint](backend/apps/api/src/modules/seo/seo.controller.ts#L134-L148) generate the document before sending public cache headers.

These are genuine per-record query patterns. Downstream caches can reduce origin requests, but response headers alone do not share generation inside the API. Repeated origin crawler requests can allocate entire catalogs and issue many queries. Deployed cache effectiveness and crawl frequency are unknown.

### Fix approach

1. Batch entity/SEO reads with joins or bounded `IN` queries; batch image/variant resolution. Select only required columns.
2. Use bounded sitemap parts and an index when necessary; avoid holding every entity, URL object, and final XML string for an unlimited catalog in one request.
3. Share concurrent identical generation. Use a bounded cache or revision-keyed generated artifact for repeated reads, with defined invalidation and maximum staleness.
4. Cache keys must distinguish document kind, origin, relevant settings, and content revision. Preserve canonical handling, `noindex`, public visibility, and disabled/custom-content behavior.
5. Do not create another frequent unconditional full-generation job. Reuse the content invalidation design from finding 1 where appropriate.

**Small acceptance checks:** a multi-entity fixture uses batched queries rather than one lookup per record; concurrent identical requests share work; hidden/noindex content stays excluded; disabled/custom documents are correct after settings changes.

## 3. Browsing cart-enabled stores creates database writes

### Evidence and trigger

- [The storefront cart hook](frontend/src/hooks/useShopCart.ts#L47-L71) requests a cart after a store loads, not only when the drawer opens, and refetches on mount.
- [getCart](backend/apps/api/src/modules/carts/carts.service.ts#L156-L187) checks the public store and cart entitlement, then calls `getOrCreateCart`.
- [getOrCreateCart](backend/apps/api/src/modules/carts/carts.service.ts#L89-L148) persists absent carts and updates expiry on access. A newly created cart also reaches the expiry-update branch.
- [Checkout validation](backend/apps/api/src/modules/carts/carts.service.ts#L468-L502) reads one product for every cart line, even when option combinations refer to the same product.

Successful cart reads on cart-enabled stores cause writes even for visitors who never buy. This is confirmed write amplification; its production importance depends on navigation and repeat requests. Disabled-cart requests still incur entitlement checks but do not reach successful cart creation.

### Fix approach

1. Separate reading an existing cart and establishing its HttpOnly identity from creating a persistent empty cart. Consider returning a compatible empty-cart DTO and creating the database row on the first real mutation.
2. Update controller/DTO/frontend assumptions together: currently add-to-cart waits for the initial GET and anonymous cookie. Do not defer everything until drawer open and accidentally disable the first add or hide an existing cart badge.
3. Remove redundant expiry updates immediately after creation. Throttling existing-cart expiry touches requires an explicit inactivity-expiry policy; do not silently alter the current seven-day-on-access behavior.
4. Batch checkout product reads by distinct IDs, then validate each line against the result map. Keep per-product quantity aggregation across option combinations.
5. Preserve anonymous/authenticated isolation, subscription gates, store membership, server-derived money values, and current stock/availability checks. Never cache carts publicly or merge identities automatically.

**Small acceptance checks:** new-visitor first add works; existing-cart badges still load; repeated empty reads do not create rows; option lines share stock limits; authenticated and anonymous carts remain separate.

## 4. Explore enriches more candidates than it returns

### Evidence and trigger

- [Explore cache and pagination](backend/apps/api/src/modules/showcases/services/feed-explore.service.ts#L475-L566) share anonymous visitor work; signed-in requests bypass the shared response-cache branch. Cursor values create distinct cache keys.
- [Mixed explore](backend/apps/api/src/modules/showcases/services/feed-explore.service.ts#L654-L720) chooses up to `min(max(limit * 8, 60), 300)` posts, fully enriches them, ranks/diversifies them, and only then paginates.
- A 12-item request can enrich up to 96 candidates. The cursor does not narrow this mixed-feed SQL candidate selection.
- [Enrichment is already batched](backend/apps/api/src/modules/showcases/services/feed-explore.service.ts#L1004-L1082). Do not label it a per-card SQL N+1 or replace it with individual lookups.

Cold anonymous keys, different cursors/filters, and signed-in backend requests can repeat substantial hydration/ranking work. This is bounded per request, but still larger than the returned page.

### Fix approach

1. Compare one anonymous cold/warm request and one signed-in request before choosing a change. Separate SQL time, Redis payload size, hydration, and ranking CPU.
2. If hydration dominates, fetch compact ranking inputs first and hydrate response media/details only for selected items, preserving every scoring input and store diversification rule.
3. Alternatively, reuse a bounded, short-lived ranked candidate snapshot across cursor pages. Keep filters, coordinates, viewer-specific ranking, invalidation, and cursor consistency explicit.
4. Never blindly share personalized responses. The computing visitor currently supplies category affinity even when a page is later shared; a new shared layer must explicitly separate viewer-neutral candidates from viewer-specific ordering and like flags.
5. Verify the affinity query's index access: [filtering uses voter identity](backend/apps/api/src/modules/showcases/services/feed-explore.service.ts#L282-L305), while [the original registered indexes](backend/libs/database/src/migrations/1792627200000-AddPostEngagement.ts#L25-L36) lead with `post_id`. Inspect current installed indexes and plain `EXPLAIN` before adding a voter-leading composite index through a migration. A production full scan has not been established.

Do not simply paginate SQL before ranking: that can change the feed's selection, ordering, and diversity.

**Small acceptance checks:** duplicate anonymous work remains shared; two viewers do not inherit each other's like flags/affinity; filters and cursor pages remain consistent; public visibility still applies.

## 5. Engagement batching has growing state and flush costs

### Evidence and trigger

- [Redis state and scripts](backend/libs/queue/src/engagement-buffer.ts#L19-L56) store a post's full liker map in JSON, potentially alongside another snapshot in an immutable staged batch. Mutations decode/encode that state.
- [Feed reads](backend/libs/queue/src/engagement-buffer.ts#L71-L87) use `MGET`, but still transfer and parse whole states. Fewer round trips do not mean bounded payloads.
- [Worker flushing](backend/apps/worker/src/jobs/engagement.flush.ts#L75-L139) fetches dirty IDs with `SMEMBERS`, processes them sequentially, and reads all durable likes for each staged post, including views-only batches.

Cost grows with likes per post and dirty backlog, affecting Redis memory/command time, network bytes, API parsing, and worker/MySQL work. This is a conditional scale risk, not evidence that Redis is currently overloaded.

### Fix approach

1. Measure sampled state sizes, dirty backlog, and flush duration first. Do not dump liker identities into logs/reports.
2. If justified, separate compact counters and per-viewer membership reads from the full immutable persistence representation. Feed rendering should not need every liker's ID.
3. Distinguish view deltas from membership changes so views-only batches do not load/reconcile the entire PostLike collection.
4. Process dirty work in bounded batches with safe claims and retries; simple removal from the dirty set before successful persistence is not safe.
5. Treat this as a staged protocol change with old-state compatibility. Preserve receipt-based idempotency, lock ordering, concurrent writes, and post-commit acknowledgment.

**Small acceptance checks:** retry after commit never double-counts; a like/unlike or view arriving during a flush survives acknowledgment; view deduplication remains correct; pending state never expires.

Do not add TTLs to pending engagement or rely on eviction to solve memory pressure. That would trade performance for activity loss.

## Other recurring and delivery costs to measure

| Area | Code-backed observation | Recommended boundary |
| --- | --- | --- |
| Share-card backfill | [Worker backfill](backend/apps/worker/src/jobs/media.process.ts#L292-L329) walks logo-bearing stores in batches of 50 at startup and every five minutes; existing cards get a storage stat, not re-encoding | Measure traversal and overlap with encoding. Use durable missing-card work plus bounded recovery if material |
| Monitoring | [Metrics collection](backend/apps/api/src/modules/monitoring/monitoring.service.ts#L111-L128) performs media/outbox aggregates, with caching, single-flight, and limits | Attribute it in idle measurements; do not disable readiness/observability as a shortcut |
| Media requests | [Origin route](backend/apps/api/src/modules/showcases/media.controller.ts#L141-L206) authorizes and stats before ETag/HEAD handling | A 304 avoids transfer bytes, not those origin checks. Measure cache hit/miss and range traffic |
| Nginx media caching | [Generated snippet](setup-vps.sh#L204-L217) bypasses ranges and permits stale-on-error/updating responses | Inspect installed configuration. Do not assume `max-age` alone is a strict revocation deadline when stale serving is enabled |
| Resource limits | [VPS setup](setup-vps.sh#L156-L179) supplies settings different from generic Compose defaults | Verify running configuration; do not raise worker concurrency or DB pool sizes blindly on a constrained VPS |

Media streaming and decoding are different costs: browser rendering/decoding does not consume VPS CPU, while uncached origin streams, authorization queries, and worker encoding do. Keep Sharp/FFmpeg worker-only. Never expose the media volume through an unrestricted static alias or cache private responses to reduce load.

## Coverage and safeguards already present

Static review is not a guarantee of production capacity.

| Requested path/workload | Result and follow-up |
| --- | --- |
| Home/feed | Anonymous cache/single-flight and batched enrichment exist; candidate hydration and engagement state are the main follow-ups above |
| Stores/directory | Public-list caching and grouped counts exist; directory is capped at 1,000; store detail makes separate counts. Inspect filtered query plans only if measurements justify it |
| Categories/menu | Category totals are grouped server-side; menus are filtered/paginated. Frontend page sizes are 60 for menus and 24 for categories, backend maximum 100. Large response/image transfers and deep offsets are measurement targets, not proven scans |
| Product slug | Direct slug predicate with a registered unique slug index; DTO mapping has no per-product SQL. Store, category, cart, branding, and image requests can account for apparent page cost. Lookup is product-slug-global; preserve the storefront's store-membership check and owner/public separation |
| Store feed and post URL | Store feed paginates in SQL before enrichment; direct post detail enriches one post. Favorites normalize at most 12 stores |
| Ads/stories | Ads are capped at 10 with per-target enrichment. Stories cap candidates at 400 and batch enrichment, but can hydrate more than final selected groups |
| Carts/checkout | Automatic GET behavior and per-line checkout reads traced; see finding 3 |
| SEO/crawlers | Current scheduler mitigation retained; remaining catalog-wide work and live document generation identified |
| Worker/monitoring | Engagement, media/card backfill, bounded recovery, story cleanup, metrics, and admin overview paths reviewed. No automatic overview polling was established |

Avoid generic fixes that break publication/moderation, owner suspension, tenant boundaries, cart/session isolation, subscription gates, integer-safe prices, or existing cache personalization. Public-media caching changes need an explicit visibility/revocation policy.

## Low-cost measurement and implementation order

1. With production access approved, use existing metrics for a short idle window and one normal home -> store -> category -> product -> post session. Separate API, MySQL, Redis, worker CPU/memory, disk I/O, and transferred bytes. Correlate engagement flushes and preview refreshes; do not manufacture traffic.
2. Inspect a few slow request traces or existing slow-query records. Use plain `EXPLAIN` and actual installed indexes for relevant queries; avoid `EXPLAIN ANALYZE` on a busy production database because it executes the statement. Do not enable broad query/body/token logging.
3. Implement durable content invalidation and bounded preview work first if it correlates with load. Keep the current scheduler until the replacement covers all dependencies and recovery.
4. Batch crawler-document generation and share identical work. This is a separate, measurable improvement even before a broader queue redesign.
5. Address cart reads and feed hydration according to the measured request mix. Checkout's distinct-product batching can be a small isolated patch; engagement-state redesign has a much larger correctness surface.
6. Keep validation small: use the relevant existing unit file and a few query-count/behavior checks per patch, then appropriate typecheck/format verification. No repeated full suites, benchmarks, or load tests by default. Migration/durability changes may need additional narrowly scoped checks; never rollback-test real application data.

Success means fewer queries/writes/bytes for the same legitimate work and lower observed contention without lost edits, stale unpublished pages, incorrect carts, changed ranking semantics, or lost engagement. A lower timer frequency alone is not proof of a resolved VPS problem.

## Copyable instructions for the next AI

> Read this report and current code; the scheduler mitigation and the scoped fixes for findings 1–3 are already implemented (see "Applied in this pass"). Continue with the low-cost measurement steps, then the durable dirty-store invalidation left open by finding 1, finding 4 (explore hydration), and finding 5 (engagement state). Keep each remaining patch small and evidence-based, explain the scope first, and add a few focused checks per patch. Preserve current public/private visibility, moderation, tenant and cart isolation, ranking semantics, and durable engagement receipts. Do not invent production measurements or claim this review proved a CPU bottleneck. Use registered migrations for schema/index changes and keep configuration validation/templates synchronized. Do not deploy, change production configuration/data, commit, push, or run stress tests without explicit approval. Update this report with what is actually fixed and what remains.
