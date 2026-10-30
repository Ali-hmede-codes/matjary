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
        await this.releaseInheritedSeo(manager, settings, changed);
        // Lock before merging partial changes so concurrent editors keep unrelated fields.
        Object.assign(
          settings,
          Object.fromEntries(changed.map((key) => [key, dto[key]])),
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
    previous: WebsiteSettings,
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
    if (!seo) return;
    const patch: Partial<SeoSettings> = {};
    // Older admin forms persisted their inherited placeholders. Release only
    // exact copies of the previous branding; distinct custom SEO stays intact.
    if (
      identityChanged &&
      seo.defaultTitle ===
        [previous.siteName, previous.tagline].filter(Boolean).join(' — ')
    )
      patch.defaultTitle = null;
    if (
      changed.includes('siteName') &&
      seo.organizationName === previous.siteName
    )
      patch.organizationName = null;
    if (
      descriptionChanged &&
      previous.description &&
      seo.defaultDescription === previous.description
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
    if (Object.keys(patch).length)
      await manager.update(SeoSettings, { id: seo.id }, patch);
  }
}
