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

  update(
    input: UpdateWebsiteSettingsDto,
    actor: AdminActor,
  ): Promise<WebsiteSettingsValues> {
    return this.access.transaction(actor, async (manager) => {
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
        // The home link preview and fallback images read this row.
        this.shells.request();
      }
      return this.publicValues(settings);
    });
  }
}
