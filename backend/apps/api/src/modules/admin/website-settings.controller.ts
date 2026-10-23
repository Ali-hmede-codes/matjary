import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
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
