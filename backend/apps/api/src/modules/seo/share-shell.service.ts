import {
  Injectable,
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
  Store,
  StoreCategory,
  publicWhere,
  PUBLIC_PRODUCT_STATUSES,
} from '@app/database';
import { SeoService, type MetaTags } from './seo.service';
import { renderShareShell, shareShellSegments } from './share-shell';

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
  private readonly logger = new Logger(ShareShellService.name);
  private readonly templatePath: string;
  private readonly root: string;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private late?: NodeJS.Timeout;
  private fingerprint?: string;
  private pending?: Promise<number>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly seo: SeoService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.templatePath = config.get('SHARE_SHELL_TEMPLATE', { infer: true });
    this.root = path.resolve(config.get('SHARE_SHELL_ROOT', { infer: true }));
    this.intervalMs =
      config.get('SHARE_SHELL_REFRESH_SECONDS', { infer: true }) * 1000;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    // Let boot and migrations settle before the first pass.
    this.first = setTimeout(() => void this.tick(), 10_000);
    this.first.unref();
    // The worker backfills logo cards after boot; a late pass replaces the
    // logo fallbacks that the first pass may have written.
    this.late = setTimeout(() => {
      void this.refreshAll().catch(() =>
        this.logger.warn('Storefront share page refresh failed'),
      );
    }, 5 * 60_000);
    this.late.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
    if (this.late) clearTimeout(this.late);
  }

  /** Writes every public storefront shell; returns the written page count. */
  refreshAll(): Promise<number> {
    if (!this.pending) {
      this.pending = this.runRefresh().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  private async tick(): Promise<void> {
    if (this.pending) return;
    try {
      if ((await this.contentFingerprint()) === this.fingerprint) return;
      const pages = await this.refreshAll();
      if (pages) this.logger.log(`Refreshed ${pages} storefront share pages`);
    } catch {
      this.logger.warn('Storefront share page refresh failed');
    }
  }

  private async runRefresh(): Promise<number> {
    try {
      const template = await fs
        .readFile(this.templatePath, 'utf8')
        .catch(() => undefined);
      if (!template) return 0;
      const manager = this.dataSource.manager;
      const stores = await manager.find(Store, { where: publicWhere('store') });
      let pages = 0;
      for (const store of stores) {
        pages += Number(
          await this.writePage(
            [store.slug],
            await this.seo.generateStoreMetaTags(store),
            template,
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
            ),
          );
        }
      }
      return pages;
    } finally {
      // SEO auto-generation writes rows; snapshot after the pass so the same
      // changes do not trigger another refresh on the next tick.
      this.fingerprint = await this.contentFingerprint().catch(() => undefined);
    }
  }

  private async writePage(
    segments: string[],
    meta: MetaTags,
    template: string,
  ): Promise<boolean> {
    const safe = shareShellSegments(...segments);
    if (!safe) return false;
    const directory = path.join(this.root, ...safe);
    const target = path.join(directory, 'index.html');
    // Defense in depth: never write outside the mounted share directory.
    if (!target.startsWith(`${this.root}${path.sep}`)) return false;
    await fs.mkdir(directory, { recursive: true });
    // Publish atomically so a crawler never reads a half-written document.
    const temporary = path.join(directory, '.index.html.next');
    await fs.writeFile(temporary, renderShareShell(template, meta), {
      mode: 0o644,
    });
    await fs.rename(temporary, target);
    return true;
  }

  private async contentFingerprint(): Promise<string> {
    const rows: unknown = await this.dataSource.query(
      `SELECT
        (SELECT COUNT(*) FROM stores) AS stores,
        (SELECT MAX(updated_at) FROM stores) AS stores_at,
        (SELECT COUNT(*) FROM store_categories) AS categories,
        (SELECT MAX(updated_at) FROM store_categories) AS categories_at,
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT MAX(updated_at) FROM products) AS products_at,
        (SELECT MAX(updated_at) FROM media_assets WHERE purpose IN ('store_logo', 'store_banner', 'product_image')) AS media_at,
        (SELECT MAX(updated_at) FROM store_seo) AS store_seo_at,
        (SELECT MAX(updated_at) FROM product_seo) AS product_seo_at,
        (SELECT MAX(updated_at) FROM seo_settings) AS settings_at`,
    );
    const stat = await fs.stat(this.templatePath).catch(() => undefined);
    return JSON.stringify({
      row: Array.isArray(rows) ? rows[0] : null,
      template: stat ? [stat.mtimeMs, stat.size] : null,
    });
  }
}
