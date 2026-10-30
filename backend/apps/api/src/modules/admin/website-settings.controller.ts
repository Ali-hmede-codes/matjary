import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AdminActor } from '@app/database';
import {
  AdminGuard,
  MutationGuard,
  SessionGuard,
} from '../auth/guards/auth.guards';
import { Actor } from './admin-context.interceptor';
import { UpdateWebsiteSettingsDto } from './website-settings.dto';
import { WebsiteSettingsService } from './website-settings.service';

@ApiTags('Website settings')
@Controller('settings/website')
export class PublicWebsiteSettingsController {
  constructor(private readonly settings: WebsiteSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Public website branding (no secrets or administrator metadata)',
  })
  get() {
    return this.settings.get();
  }

  @Get('manifest.webmanifest')
  @Header('Content-Type', 'application/manifest+json')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({
    summary: 'Installable web app manifest using the live website branding',
  })
  async manifest() {
    const settings = await this.settings.get();
    // The static site.webmanifest keeps its build-time name; installing the
    // site must use the administrator's current name and colors instead.
    return {
      name: settings.siteName,
      short_name: settings.siteName,
      ...(settings.description ? { description: settings.description } : {}),
      icons: [
        {
          src: '/web-app-manifest-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'maskable',
        },
        {
          src: '/web-app-manifest-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
      theme_color: settings.primaryColor,
      background_color: settings.backgroundColor,
      display: 'standalone',
      start_url: '/',
    };
  }
}

@ApiTags('Website settings')
@Controller('admin/website-settings')
@UseGuards(SessionGuard, AdminGuard, MutationGuard)
export class AdminWebsiteSettingsController {
  constructor(private readonly settings: WebsiteSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get website appearance settings' })
  get(@Actor() actor: AdminActor) {
    return this.settings.getAdmin(actor);
  }

  @Patch()
  @ApiOperation({
    summary:
      'Update branding; omit unchanged fields, null clears optional fields',
  })
  update(@Body() dto: UpdateWebsiteSettingsDto, @Actor() actor: AdminActor) {
    return this.settings.update(dto, actor);
  }
}
