import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
  ParseFloatPipe,
} from '@nestjs/common';
import { StoresService } from './stores.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { MyStoresQueryDto, StoreStatusDto } from './dto/store-lifecycle.dto';
import { ResolveGoogleMapsDto } from './dto/resolve-google-maps.dto';
import {
  StoreResponseDto,
  StoreListResponseDto,
} from './dto/store-response.dto';
import { StoreDirectoryResponseDto } from './dto/store-directory.dto';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  OptionalSessionGuard,
  AdminGuard,
  AuthenticatedRequest,
} from '../auth/guards/auth.guards';
import {
  GrantVerificationBadgeDto,
  RevokeVerificationBadgeDto,
  CheckBadgeEligibilityResponseDto,
  BadgeOperationResponseDto,
} from './dto/verification-badge.dto';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  async list(
    @Query('limit', new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe)
    offset: number,
  ): Promise<StoreListResponseDto> {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const safeOffset = Math.max(offset, 0);
    return this.stores.findAll(undefined, safeLimit, safeOffset);
  }

  // Static route: must stay above GET ':slug' so it is not treated as a shop.
  @Get('categories')
  getBusinessCategories() {
    return this.stores.getBusinessCategoryCatalog();
  }

  // Every public shop in one slim response for the all-shops page.
  @Get('directory')
  listDirectory(): Promise<StoreDirectoryResponseDto> {
    return this.stores.listDirectory();
  }

  @Get('my')
  @UseGuards(SessionGuard)
  async getMyStores(
    @Req() request: AuthenticatedRequest,
    @Query() query: MyStoresQueryDto,
  ): Promise<StoreResponseDto[]> {
    return this.stores.getUserStores(
      request.user.id,
      query.includeTrashed === 'true',
    );
  }

  @Patch(':slug/status')
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  status(
    @Param('slug') slug: string,
    @Body() dto: StoreStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.stores.setStatus(slug, dto.status, request.user.id);
  }

  @Post(':slug/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  restore(@Param('slug') slug: string, @Req() request: AuthenticatedRequest) {
    return this.stores.restore(slug, request.user.id);
  }

  @Get(':slug')
  @UseGuards(OptionalSessionGuard)
  async getOne(
    @Param('slug') slug: string,
    @Req() request: { user?: { id: string } },
  ): Promise<StoreResponseDto> {
    // The optional session only decides whether the owner's story controls are
    // offered; the shop itself stays public.
    return this.stores.findOneBySlug(slug, request.user?.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async create(
    @Body() dto: CreateStoreDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<StoreResponseDto> {
    return this.stores.create(dto, request.user.id);
  }

  @Patch(':slug')
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async update(
    @Param('slug') slug: string,
    @Body() dto: UpdateStoreDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<StoreResponseDto> {
    return this.stores.update(slug, dto, request.user.id);
  }

  @Delete(':slug/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async purge(
    @Param('slug') slug: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.stores.purge(slug, request.user.id);
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async remove(
    @Param('slug') slug: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.stores.remove(slug, request.user.id);
  }

  // ============================================
  // Location-based endpoints
  // ============================================

  @Get('nearby')
  async findNearby(
    @Query('lat', ParseFloatPipe) latitude: number,
    @Query('lon', ParseFloatPipe) longitude: number,
    @Query('radiusKm', new DefaultValuePipe(50), ParseIntPipe) radiusKm: number,
    @Query('limit', new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe)
    offset: number,
  ): Promise<StoreListResponseDto> {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const safeOffset = Math.max(offset, 0);
    const safeRadius = Math.min(Math.max(radiusKm, 1), 500); // Max 500km
    return this.stores.findStoresNearLocation(
      latitude,
      longitude,
      safeRadius,
      safeLimit,
      safeOffset,
    );
  }

  @Get('by-city/:city')
  async findByCity(
    @Param('city') city: string,
    @Query('limit', new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe)
    offset: number,
  ): Promise<StoreListResponseDto> {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const safeOffset = Math.max(offset, 0);
    return this.stores.findStoresByCity(city, safeLimit, safeOffset);
  }

  @Get('by-country/:country')
  async findByCountry(
    @Param('country') country: string,
    @Query('limit', new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe)
    offset: number,
  ): Promise<StoreListResponseDto> {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const safeOffset = Math.max(offset, 0);
    return this.stores.findStoresByCountry(country, safeLimit, safeOffset);
  }

  @Get('map/config')
  async getMapConfig() {
    return this.stores.getMapConfig();
  }

  @Get('location/geocode')
  async geocodeAddress(@Query('address') address: string) {
    return this.stores.geocodeAddress(address);
  }

  @Get('location/reverse-geocode')
  async reverseGeocode(
    @Query('lat', ParseFloatPipe) latitude: number,
    @Query('lon', ParseFloatPipe) longitude: number,
  ) {
    return this.stores.reverseGeocode(latitude, longitude);
  }

  @Post('location/google-maps')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async resolveGoogleMapsLink(@Body() dto: ResolveGoogleMapsDto) {
    return this.stores.resolveGoogleMapsLink(dto.url);
  }

  // ============================================
  // VERIFICATION BADGE ENDPOINTS
  // ============================================

  /**
   * Check if a store is eligible for a verification badge
   * Available to store owners and admins
   */
  @Get(':storeId/badge/eligibility')
  @UseGuards(SessionGuard)
  async checkBadgeEligibility(
    @Param('storeId') storeId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CheckBadgeEligibilityResponseDto> {
    return this.stores.checkBadgeEligibility(storeId, request.user.id);
  }

  /**
   * Grant a verification badge to a store
   * Only administrators can grant verification; a subscription is not verification.
   */
  @Post('badge/grant')
  @UseGuards(SessionGuard, AdminGuard, AuthOriginGuard, AuthRateLimitGuard)
  async grantBadge(
    @Body() dto: GrantVerificationBadgeDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BadgeOperationResponseDto> {
    return this.stores.grantVerificationBadge(dto.storeId, request.user.id);
  }

  /**
   * Revoke a verification badge from a store (admin only)
   */
  @Post('badge/revoke')
  @UseGuards(SessionGuard, AdminGuard, AuthOriginGuard, AuthRateLimitGuard)
  async revokeBadge(
    @Body() dto: RevokeVerificationBadgeDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BadgeOperationResponseDto> {
    return this.stores.revokeVerificationBadge(dto.storeId, request.user.id);
  }
}
