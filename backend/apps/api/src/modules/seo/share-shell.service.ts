import {
  Injectable,
  Inject,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DataSource, In, IsNull } from 'typeorm';
import type { AppEnvironment } from '@app/config';
import {
  Product,
  Showcase,
  ShowcaseStatus,
  Store,
  StoreCategory,
  publicWhere,
  PUBLIC_PRODUCT_STATUSES,
} from '@app/database';
import { SeoService, type MetaTags } from './seo.service';
import { renderShareShell, shareShellSegments } from './share-shell';
import { ShareShellSignal } from './share-shell.signal';

/**
 * Prerenders the storefront shell for every public shop, section, and product
 * into the web root. Social crawlers never run the SPA, so without this a
 * shared clean URL only exposes the platform's default metadata. The same
 * files still boot the app for visitors, so no host crawler rule is needed.
 *
 * The mounted share directory is optional: when a deployment does not provide
 * it the refresher stays idle instead of failing the API.
 */
@Injectable()
export class ShareShellService implements OnModuleInit, OnApplicationShutdown {
  // Recover changes the aggregate fingerprint cannot see without rebuilding
  // the entire catalog on every poll. Explicit refresh requests still run now.
  private static readonly RECONCILE_MS = 60 * 60_000;
  private readonly logger = new Logger(ShareShellService.name);
  private readonly templatePath: string;
  private readonly root: string;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private fingerprint?: string;
  private pending?: Promise<number>;
  private lastRefreshAt = 0;
  private refreshRequested = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly seo: SeoService,
    config: ConfigService<AppEnvironment, true>,
    // Explicit token: a defaulted parameter emits `Object` as its metadata.
    @Inject(ShareShellSignal)
    private readonly signal: ShareShellSignal = new ShareShellSignal(),
  ) {
    this.templatePath = config.get('SHARE_SHELL_TEMPLATE', { infer: true });
    this.root = path.resolve(config.get('SHARE_SHELL_ROOT', { infer: true }));
    this.intervalMs =
      config.get('SHARE_SHELL_REFRESH_SECONDS', { infer: true }) * 1000;
  }

  onModuleInit(): void {
    this.signal.register(() => this.refreshAll());
    // One configurable poll replaces the independent 15-second database scan.
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    // Let boot and migrations settle before the first pass.
    this.first = setTimeout(() => void this.tick(), 10_000);
    this.first.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
    this.signal.cancel();
  }

  /** Forces a full pass; a request during a pass also leaves the next poll dirty. */
  refreshAll(): Promise<number> {
    this.refreshRequested = true;
    return this.refreshIfNeeded();
  }

  private refreshIfNeeded(): Promise<number> {
    if (!this.pending) {
      // Single flight includes the fingerprint query, not just file generation.
      this.pending = this.checkAndRefresh().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  private async tick(): Promise<void> {
    if (this.pending) return;
    try {
      const pages = await this.refreshIfNeeded();
      if (pages) this.logger.log(`Refreshed ${pages} storefront share pages`);
    } catch {
      this.logger.warn('Storefront share page refresh failed');
    }
  }

  private async checkAndRefresh(): Promise<number> {
    // Missing/unreadable templates must leave the optional refresher DB-idle.
    // Snapshot before reading so a template replaced mid-pass is seen next time.
    const stat = await fs.stat(this.templatePath).catch(() => undefined);
    const template = stat?.isFile()
      ? await fs.readFile(this.templatePath, 'utf8').catch(() => undefined)
      : undefined;
    if (!template || !stat) {
      this.fingerprint = undefined;
      return 0;
    }

    const force = this.refreshRequested;
    this.refreshRequested = false;
    try {
      const fingerprint = await this.contentFingerprint(stat);
      if (
        !force &&
        fingerprint === this.fingerprint &&
        Date.now() - this.lastRefreshAt < ShareShellService.RECONCILE_MS
      )
        return 0;

      const pages = await this.runRefresh(template);
      // Only acknowledge the snapshot taken before a successful pass. A save
      // during generation (including SEO auto-generation) is checked next poll.
      this.fingerprint = fingerprint;
      this.lastRefreshAt = Date.now();
      return pages;
    } catch (error) {
      // A forced refresh may fail even when the fingerprint is unchanged.
      this.refreshRequested = true;
      throw error;
    }
  }

  private async runRefresh(template: string): Promise<number> {
    const manager = this.dataSource.manager;
    const stores = await manager.find(Store, { where: publicWhere('store') });
    // Pages written in this pass; anything else under the root is obsolete
    // (a renamed slug, an unpublished post) and must stop answering.
    const keep = new Set<string>();
    let pages = 0;
    for (const store of stores) {
      pages += Number(
        await this.writePage(
          [store.slug],
          await this.seo.generateStoreMetaTags(store),
          template,
          keep,
        ),
      );
      const categories = await manager.find(StoreCategory, {
        where: { storeId: store.id },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
      for (const category of categories) {
        pages += Number(
          await this.writePage(
            [store.slug, 'c', this.seo.categoryPathSlug(category.name)],
            await this.seo.generateCategoryMetaTags(store, category),
            template,
            keep,
          ),
        );
      }
      // Products without an owner category live on the "More items" page.
      const uncategorized = await manager.count(Product, {
        where: {
          storeId: store.id,
          categoryId: IsNull(),
          status: In([...PUBLIC_PRODUCT_STATUSES]),
          ...publicWhere('product'),
        },
      });
      if (uncategorized > 0) {
        pages += Number(
          await this.writePage(
            [store.slug, 'c', 'more-items'],
            await this.seo.generateUncategorizedShareMeta(store),
            template,
            keep,
          ),
        );
      }
      const products = await manager.find(Product, {
        where: {
          storeId: store.id,
          status: In([...PUBLIC_PRODUCT_STATUSES]),
          ...publicWhere('product'),
        },
      });
      for (const product of products) {
        pages += Number(
          await this.writePage(
            [store.slug, 'p', product.slug],
            await this.seo.generateProductMetaTags(product, store),
            template,
            keep,
          ),
        );
      }
      // Posts live under their shop, so one shared link previews from a file
      // this directory already serves. Shop-less posts keep the API route.
      const posts = await manager.find(Showcase, {
        where: {
          storeId: store.id,
          status: ShowcaseStatus.PUBLISHED,
          ...publicWhere('post'),
        },
      });
      for (const post of posts) {
        pages += Number(
          await this.writePage(
            [store.slug, 'post', post.slug],
            await this.seo.generateShowcaseMetaTags(post, store),
            template,
            keep,
          ),
        );
      }
    }
    await this.prune(keep);
    return pages;
  }

  private async writePage(
    segments: string[],
    meta: MetaTags,
    template: string,
    keep: Set<string>,
  ): Promise<boolean> {
    const safe = shareShellSegments(...segments);
    if (!safe) return false;
    const directory = path.join(this.root, ...safe);
    const target = path.join(directory, 'index.html');
    // Defense in depth: never write outside the mounted share directory.
    if (!target.startsWith(`${this.root}${path.sep}`)) return false;
    const html = renderShareShell(template, meta);
    // A changed page or reconciliation still revisits unchanged siblings;
    // avoid writing their identical bytes again.
    const current = await fs.readFile(target, 'utf8').catch(() => undefined);
    if (current === html) {
      keep.add(target);
      return true;
    }
    await fs.mkdir(directory, { recursive: true });
    // Publish atomically so a crawler never reads a half-written document.
    const temporary = path.join(directory, '.index.html.next');
    await fs.writeFile(temporary, html, { mode: 0o644 });
    await fs.rename(temporary, target);
    keep.add(target);
    return true;
  }

  /**
   * Removes shells for pages that no longer exist. Leaving them behind served
   * an archived shop's or unpublished post's old title and image forever.
   */
  private async prune(keep: Set<string>): Promise<void> {
    const directories: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      const entries = await fs
        .readdir(directory, { withFileTypes: true })
        .catch(() => []);
      for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          directories.push(target);
          await walk(target);
        } else if (
          entry.isFile() &&
          entry.name === 'index.html' &&
          !keep.has(target)
        ) {
          await fs.rm(target, { force: true }).catch(() => undefined);
        }
      }
    };
    await walk(this.root);
    // Deepest first, so emptied section folders disappear with their page.
    for (const directory of directories.sort((a, b) => b.length - a.length)) {
      if (!directory.startsWith(`${this.root}${path.sep}`)) continue;
      await fs.rmdir(directory).catch(() => undefined);
    }
  }

  private async contentFingerprint(template: {
    mtimeMs: number;
    size: number;
  }): Promise<string> {
    const rows: unknown = await this.dataSource.query(
      `SELECT
        (SELECT COUNT(*) FROM stores) AS stores,
        (SELECT MAX(updated_at) FROM stores) AS stores_at,
        (SELECT COUNT(*) FROM store_categories) AS categories,
        (SELECT MAX(updated_at) FROM store_categories) AS categories_at,
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT MAX(updated_at) FROM products) AS products_at,
        (SELECT COUNT(*) FROM showcases) AS showcases,
        (SELECT MAX(updated_at) FROM showcases) AS showcases_at,
        (SELECT MAX(updated_at) FROM media_assets WHERE purpose IN ('store_logo', 'store_banner', 'product_image', 'post')) AS media_at,
        (SELECT MAX(updated_at) FROM store_seo) AS store_seo_at,
        (SELECT MAX(updated_at) FROM product_seo) AS product_seo_at,
        (SELECT MAX(updated_at) FROM showcase_seo) AS showcase_seo_at,
        (SELECT MAX(updated_at) FROM seo_settings) AS settings_at,
        (SELECT MAX(updated_at) FROM website_settings) AS branding_at`,
    );
    return JSON.stringify({
      row: Array.isArray(rows) ? rows[0] : null,
      template: [template.mtimeMs, template.size],
    });
  }
}
