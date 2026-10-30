import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  appendAdminAudit,
  WebsiteSettings,
  WEBSITE_SETTINGS_FIELDS,
  type WebsiteSettingsValues,
  type AdminActor,
} from '@app/database';
import { AdminAccessService } from './admin-access.service';
import { UpdateWebsiteSettingsDto } from './website-settings.dto';
import { ShareShellSignal } from '../seo/share-shell.signal';
import { SeoSettings } from '../seo/seo.entities';
import { LEGACY_SEO_DESCRIPTION, LEGACY_SEO_TITLE } from '../seo/seo-legacy';
import type { EntityManager } from 'typeorm';

@Injectable()
export class WebsiteSettingsService {
  constructor(
    private readonly access: AdminAccessService,
    // Explicit token: a defaulted parameter emits `Object` as its metadata.
    @Inject(ShareShellSignal)
    private readonly shells: ShareShellSignal = new ShareShellSignal(),
  ) {}

  private publicValues(settings: WebsiteSettings): WebsiteSettingsValues {
    return Object.fromEntries(
      WEBSITE_SETTINGS_FIELDS.map((key) => [key, settings[key]]),
    ) as WebsiteSettingsValues;
  }

  async get(
    manager = this.access.database.manager,
  ): Promise<WebsiteSettingsValues> {
    try {
      const settings = await manager.findOneBy(WebsiteSettings, { id: 1 });
      if (!settings) throw new Error('Missing singleton');
      return this.publicValues(settings);
    } catch {
      // A read failure must stay a sanitized 503 instead of serving a stale
      // copy: an unavailable database is reported, never hidden.
      throw new ServiceUnavailableException(
        'Website settings are temporarily unavailable',
      );
    }
  }

  getAdmin(actor: AdminActor): Promise<WebsiteSettingsValues> {
    return this.access.transaction(actor, (manager) => this.get(manager));
  }

  async update(
    input: UpdateWebsiteSettingsDto,
    actor: AdminActor,
  ): Promise<WebsiteSettingsValues> {
    const result = await this.access.transaction(actor, async (manager) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new BadRequestException('Invalid website settings');
      }
      const dto = plainToInstance(UpdateWebsiteSettingsDto, input);
      if (
        validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
          .length
      ) {
        throw new BadRequestException('Invalid website settings');
      }
      const settings = await manager.findOne(WebsiteSettings, {
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      });
      if (!settings)
        throw new ServiceUnavailableException(
          'Website settings are temporarily unavailable',
        );
      const changed = WEBSITE_SETTINGS_FIELDS.filter(
        (key) => dto[key] !== undefined && dto[key] !== settings[key],
      );
      if (changed.length) {
        // Snapshot the fields the SEO release compares before merging, so a
        // rename never leaves an inherited copy of the previous brand behind.
        const previous = {
          siteName: settings.siteName,
          tagline: settings.tagline,
          description: settings.description,
          logoUrl: settings.logoUrl,
          bannerUrl: settings.bannerUrl,
        };
        // Merge under the row lock so concurrent editors keep unrelated
        // fields, then release inherited SEO copies before committing.
        Object.assign(
          settings,
          Object.fromEntries(changed.map((key) => [key, dto[key]])),
        );
        await this.releaseInheritedSeo(
          manager,
          previous,
          settings.siteName,
          changed,
        );
        await manager.save(WebsiteSettings, settings);
        await appendAdminAudit(
          manager,
          actor,
          'website-settings',
          '1',
          'update',
          changed,
        );
      }
      return this.publicValues(settings);
    });
    // Refresh only after commit, so the shell cannot acknowledge old branding.
    this.shells.request();
    return result;
  }

  private async releaseInheritedSeo(
    manager: EntityManager,
    previous: Pick<
      WebsiteSettings,
      'siteName' | 'tagline' | 'description' | 'logoUrl' | 'bannerUrl'
    >,
    siteName: string,
    changed: readonly string[],
  ): Promise<void> {
    const identityChanged = changed.some((key) =>
      ['siteName', 'tagline'].includes(key),
    );
    const descriptionChanged = changed.includes('description');
    const imagesChanged = changed.some((key) =>
      ['logoUrl', 'bannerUrl'].includes(key),
    );
    if (!identityChanged && !descriptionChanged && !imagesChanged) return;
    const seo = await manager.findOne(SeoSettings, {
      where: {},
      order: { createdAt: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    // Keep the stored row aligned even when no SEO override has to change.
    if (!seo) {
      return;
    }
    const patch: Partial<SeoSettings> = {};
    // Older admin forms persisted their inherited placeholders. Release only
    // exact copies of the previous branding; distinct custom SEO stays intact.
    // The dashed variants cover the seed copy and titles written by earlier
    // releases with a plain hyphen instead of an em dash.
    const inheritedTitles = new Set(
      [
        LEGACY_SEO_TITLE,
        previous.siteName,
        [previous.siteName, previous.tagline].filter(Boolean).join(' — '),
        [previous.siteName, previous.tagline].filter(Boolean).join(' - '),
      ].filter(Boolean),
    );
    const inheritedPrefixes = [
      `${previous.siteName} — `,
      `${previous.siteName} - `,
    ];
    if (
      identityChanged &&
      (inheritedTitles.has(seo.defaultTitle ?? '') ||
        inheritedPrefixes.some((prefix) =>
          (seo.defaultTitle ?? '').startsWith(prefix),
        ))
    )
      patch.defaultTitle = null;
    if (
      changed.includes('siteName') &&
      (seo.organizationName === previous.siteName ||
        seo.organizationName === LEGACY_SEO_TITLE)
    )
      patch.organizationName = null;
    if (
      descriptionChanged &&
      (seo.defaultDescription === LEGACY_SEO_DESCRIPTION ||
        (previous.description &&
          seo.defaultDescription === previous.description))
    )
      patch.defaultDescription = null;
    if (
      imagesChanged &&
      seo.defaultOgImageUrl &&
      [previous.bannerUrl, previous.logoUrl].includes(seo.defaultOgImageUrl)
    )
      patch.defaultOgImageUrl = null;
    if (
      changed.includes('logoUrl') &&
      previous.logoUrl &&
      seo.organizationLogoUrl === previous.logoUrl
    )
      patch.organizationLogoUrl = null;
    // Structured data and stored SEO copies follow the live website name, so
    // nothing keeps reading the previous brand after a rename.
    if (changed.includes('siteName') && seo.siteName !== siteName)
      patch.siteName = siteName;
    if (Object.keys(patch).length)
      await manager.update(SeoSettings, { id: seo.id }, patch);
  }
}
