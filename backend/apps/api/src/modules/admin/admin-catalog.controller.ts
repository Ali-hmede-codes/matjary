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
  AdminCreatePostDto,
  AdminCreateProductDto,
  AdminCreateStoreDto,
  AdminErrorStateDto,
  AdminListDto,
  AdminMediaUpdateDto,
  AdminReasonDto,
  AdminUpdateStoreDto,
  AdminUserUpdateDto,
} from './admin.dto';
import { UpdateProductDto } from '../products/dto/update-product.dto';
import { UpdateShowcaseDto } from '../showcases/dto/update-showcase.dto';
import { MediaService } from '../showcases/media.service';
import { PresignedUrlDto } from '../showcases/dto/presigned-url.dto';
import { MediaCompleteDto } from '../showcases/dto/media-complete.dto';

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
    private readonly media: MediaService,
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

  @Post('stores')
  createStore(@Body() dto: AdminCreateStoreDto, @Actor() actor: AdminActor) {
    return this.catalog.createStore(dto, actor);
  }

  @Patch('stores/:id')
  updateStore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateStoreDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.updateStore(id, dto, actor);
  }

  @Post('stores/:id/badge')
  badge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminBadgeDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.badge(id, dto.enabled, dto.reason, actor);
  }

  @Post('products')
  createProduct(
    @Body() dto: AdminCreateProductDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.createProduct(dto, actor);
  }

  @Patch('products/:id')
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.updateProduct(id, dto, actor);
  }

  @Post('posts')
  createPost(@Body() dto: AdminCreatePostDto, @Actor() actor: AdminActor) {
    return this.catalog.createPost(dto, actor);
  }

  @Patch('posts/:id')
  updatePost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShowcaseDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.updatePost(id, dto, actor);
  }

  @Post('posts/:id/media/negotiate')
  negotiateMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresignedUrlDto,
    @Actor() actor: AdminActor,
  ) {
    return this.media.adminPresigned(dto, id, actor);
  }

  @Post('posts/:id/media/complete')
  completeMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MediaCompleteDto,
    @Actor() actor: AdminActor,
  ) {
    return this.media.adminComplete(dto, id, actor);
  }

  @Get('media/:id/preview')
  previewMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: AdminActor,
    @Query('label') label?: string,
  ) {
    return this.catalog.previewMedia(id, actor, label);
  }

  @Patch('media/:id')
  updateMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminMediaUpdateDto,
    @Actor() actor: AdminActor,
  ) {
    return this.catalog.updateMedia(id, dto, actor);
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
