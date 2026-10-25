import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AdminActor } from '@app/database';
import {
  AdminGuard,
  MutationGuard,
  SessionGuard,
} from '../auth/guards/auth.guards';
import { Actor } from './admin-context.interceptor';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminQueriesService } from './admin-queries.service';
import {
  AdminBadgeDto,
  AdminErrorStateDto,
  AdminListDto,
  AdminReasonDto,
  AdminUserUpdateDto,
  AdminUserRoleDto,
} from './admin.dto';

const ARCHIVABLE = {
  stores: 'stores',
  products: 'products',
  posts: 'posts',
  media: 'media',
} as const;
const ACCOUNT_ACTIONS = {
  suspend: 'suspend',
  restore: 'restore',
  revoke: 'revoke-sessions',
} as const;

@Controller('admin')
@UseGuards(SessionGuard, AdminGuard, MutationGuard)
export class AdminCatalogController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly queries: AdminQueriesService,
  ) {}

  @Get('overview')
  overview(@Actor() actor: AdminActor) {
    return this.queries.overview(actor);
  }

  @Get('data/:resource')
  list(
    @Param('resource') resource: string,
    @Query() dto: AdminListDto,
    @Actor() actor: AdminActor,
  ) {
    return this.queries.list(resource, dto, actor);
  }

  @Get('data/:resource/:id')
  detail(
    @Param('resource') resource: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: AdminActor,
  ) {
    return this.queries.detail(resource, id, actor);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUserUpdateDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.updateUser(id, dto, actor);
  }

  @Patch('users/:id/role')
  updateUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUserRoleDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.updateUserRole(id, dto, actor);
  }

  @Post('users/:id/:action')
  accountAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action', new ParseEnumPipe(ACCOUNT_ACTIONS))
    action: 'suspend' | 'restore' | 'revoke-sessions',
    @Body() dto: AdminReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.accountAction(id, action, dto.reason, actor);
  }

  @Post('stores/:id/badge')
  badge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminBadgeDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.badge(id, dto.enabled, dto.reason, actor);
  }

  @Post('stores/:id/purge')
  purgeStore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.purgeStore(id, dto.reason, actor);
  }

  @Get('media/:id/preview')
  previewMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: AdminActor,
    @Query('label') label?: string,
  ) {
    return this.catalog.previewMedia(id, actor, label);
  }

  @Post('media/:id/retry')
  retryMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.retryMedia(id, dto.reason, actor);
  }

  @Post('carts/:id/expire')
  expireCart(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.expireCart(id, dto.reason, actor);
  }

  @Patch('errors/:id')
  errorState(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminErrorStateDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.errorState(id, dto, actor);
  }

  @Post(':resource/:id/archive')
  archive(
    @Param('resource', new ParseEnumPipe(ARCHIVABLE))
    resource: keyof typeof ARCHIVABLE,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.archive(resource, id, true, dto.reason, actor);
  }

  @Post(':resource/:id/restore')
  restore(
    @Param('resource', new ParseEnumPipe(ARCHIVABLE))
    resource: keyof typeof ARCHIVABLE,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.archive(resource, id, false, dto.reason, actor);
  }
}
