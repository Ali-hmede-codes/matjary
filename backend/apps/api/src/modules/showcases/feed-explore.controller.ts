import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  Param,
  DefaultValuePipe,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  FeedExploreService,
  FeedItem,
  FeedResponse,
  ExploreParams,
  StoreFeedParams,
} from './services/feed-explore.service';
import {
  PostEngagementService,
  ResolvedViewer,
} from './engagement/post-engagement.service';
import { SessionGuard, AuthenticatedRequest } from '../auth/guards/auth.guards';

@ApiTags('Feed & Explore')
@Controller('feed')
export class FeedExploreController {
  constructor(
    private readonly feedExploreService: FeedExploreService,
    private readonly engagementService: PostEngagementService,
  ) {}

  /**
   * Resolve the current viewer (user or visitor) from request
   */
  private async resolveViewer(request: Request): Promise<ResolvedViewer> {
    return this.engagementService.resolveViewer(request);
  }

  private parseCategories(
    value?: string,
    single?: string,
  ): string[] | undefined {
    const categories = [
      ...(value?.split(',') ?? []),
      ...(single ? [single] : []),
    ]
      .map((category) => category.trim())
      .filter(Boolean)
      .slice(0, 12);
    return categories.length > 0 ? categories : undefined;
  }

  // ============================================
  // PERSONALIZED FEED (Authenticated users)
  // ============================================

  @Get()
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get personalized feed for authenticated user',
    description:
      'Returns posts from stores the user owns or has interacted with, ranked by relevance algorithm',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items (default 20, max 50)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Pagination cursor (publishedAt ISO string)',
  })
  @ApiResponse({ status: 200, description: 'Personalized feed items' })
  async getPersonalizedFeed(
    @Req() request: AuthenticatedRequest,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ): Promise<FeedResponse> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    return this.feedExploreService.getPersonalizedFeed(
      request.user.id,
      safeLimit,
      cursor,
    );
  }

  // ============================================
  // EXPLORE - Discovery endpoints
  // ============================================

  @Get('explore')
  @ApiOperation({
    summary: 'Get explore feed with discovery algorithms',
    description:
      'Main explore page with mixed algorithm (trending + popular + recent + nearby)',
  })
  @ApiQuery({
    name: 'algorithm',
    required: false,
    enum: ['mixed', 'trending', 'popular', 'recent', 'nearby'],
    description: 'Algorithm to use',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items (default 20, max 50)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Pagination cursor',
  })
  @ApiQuery({
    name: 'lat',
    required: false,
    type: Number,
    description: 'User latitude for nearby posts',
  })
  @ApiQuery({
    name: 'lon',
    required: false,
    type: Number,
    description: 'User longitude for nearby posts',
  })
  @ApiQuery({
    name: 'radiusKm',
    required: false,
    type: Number,
    description: 'Search radius in km (default 25)',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    type: String,
    description: 'Filter by one business category slug (legacy)',
  })
  @ApiQuery({
    name: 'categories',
    required: false,
    type: String,
    description: 'Comma-separated business category slugs',
  })
  @ApiQuery({
    name: 'timeWindowHours',
    required: false,
    type: Number,
    description: 'Trending window in hours (default 24)',
  })
  @ApiQuery({
    name: 'city',
    required: false,
    type: String,
    description: 'Filter by city',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    type: String,
    description: 'Filter by country',
  })
  @ApiResponse({ status: 200, description: 'Explore feed items' })
  async getExploreFeed(
    @Req() request: Request,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('algorithm')
    algorithm?: 'mixed' | 'trending' | 'popular' | 'recent' | 'nearby',
    @Query('cursor') cursor?: string,
    @Query('lat') lat?: number,
    @Query('lon') lon?: number,
    @Query('radiusKm') radiusKm?: number,
    @Query('category') category?: string,
    @Query('categories') categories?: string,
    @Query('timeWindowHours') timeWindowHours?: number,
    @Query('city') city?: string,
    @Query('country') country?: string,
  ): Promise<FeedResponse> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const viewer = await this.resolveViewer(request);

    const params: ExploreParams = {
      latitude: lat,
      longitude: lon,
      radiusKm,
      categories: this.parseCategories(categories, category),
      category,
      city,
      country,
      limit: safeLimit,
      cursor,
      algorithm: algorithm || 'mixed',
      timeWindowHours,
    };

    return this.feedExploreService.getExploreFeed(params, viewer);
  }

  @Get('explore/trending')
  @ApiOperation({
    summary: 'Get trending posts (high engagement velocity)',
    description:
      'Posts with high likes/views per hour in the specified time window',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items (default 20, max 50)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Pagination cursor',
  })
  @ApiQuery({
    name: 'timeWindowHours',
    required: false,
    type: Number,
    description: 'Time window in hours (default 24)',
  })
  @ApiQuery({
    name: 'categories',
    required: false,
    type: String,
    description: 'Comma-separated business category slugs',
  })
  @ApiResponse({ status: 200, description: 'Trending posts' })
  async getTrendingPosts(
    @Req() request: Request,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor: string | undefined,
    @Query('timeWindowHours') timeWindowHours?: number,
    @Query('categories') categories?: string,
    @Query('category') category?: string,
  ): Promise<FeedResponse> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const viewer = await this.resolveViewer(request);

    const params: ExploreParams = {
      limit: safeLimit,
      cursor,
      algorithm: 'trending',
      timeWindowHours: timeWindowHours ?? 24,
      categories: this.parseCategories(categories, category),
    };

    return this.feedExploreService.getExploreFeed(params, viewer);
  }

  @Get('explore/popular')
  @ApiOperation({
    summary: 'Get popular posts (all-time high engagement)',
    description: 'Posts with highest total likes and views',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items (default 20, max 50)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Pagination cursor',
  })
  @ApiResponse({ status: 200, description: 'Popular posts' })
  async getPopularPosts(
    @Req() request: Request,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor: string | undefined,
  ): Promise<FeedResponse> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const viewer = await this.resolveViewer(request);

    return this.feedExploreService.getExploreFeed(
      {
        limit: safeLimit,
        cursor,
        algorithm: 'popular',
      },
      viewer,
    );
  }

  @Get('explore/recent')
  @ApiOperation({
    summary: 'Get recent posts (newest first)',
    description:
      'Latest published posts, optionally filtered by location/category',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items (default 20, max 50)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Pagination cursor',
  })
  @ApiQuery({
    name: 'lat',
    required: false,
    type: Number,
    description: 'User latitude for nearby posts',
  })
  @ApiQuery({
    name: 'lon',
    required: false,
    type: Number,
    description: 'User longitude for nearby posts',
  })
  @ApiQuery({
    name: 'radiusKm',
    required: false,
    type: Number,
    description: 'Search radius in km (default 25)',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    type: String,
    description: 'Filter by product category',
  })
  @ApiQuery({
    name: 'city',
    required: false,
    type: String,
    description: 'Filter by city',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    type: String,
    description: 'Filter by country',
  })
  @ApiResponse({ status: 200, description: 'Recent posts' })
  async getRecentPosts(
    @Req() request: Request,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
    @Query('lat') lat?: number,
    @Query('lon') lon?: number,
    @Query('radiusKm') radiusKm?: number,
    @Query('category') category?: string,
    @Query('categories') categories?: string,
    @Query('city') city?: string,
    @Query('country') country?: string,
  ): Promise<FeedResponse> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const viewer = await this.resolveViewer(request);

    return this.feedExploreService.getExploreFeed(
      {
        limit: safeLimit,
        cursor,
        algorithm: 'recent',
        latitude: lat,
        longitude: lon,
        radiusKm,
        categories: this.parseCategories(categories, category),
        city,
        country,
      },
      viewer,
    );
  }

  @Get('explore/nearby')
  @ApiOperation({
    summary: 'Get nearby posts (location-based)',
    description:
      'Posts from stores near the user location, sorted by distance and recency',
  })
  @ApiQuery({
    name: 'lat',
    required: true,
    type: Number,
    description: 'User latitude',
  })
  @ApiQuery({
    name: 'lat',
    required: true,
    type: Number,
    description: 'User latitude',
  })
  @ApiQuery({
    name: 'lon',
    required: true,
    type: Number,
    description: 'User longitude',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items (default 20, max 50)',
  })
  @ApiQuery({
    name: 'radiusKm',
    required: false,
    type: Number,
    description: 'Search radius in km (default 10)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Pagination cursor',
  })
  @ApiResponse({ status: 200, description: 'Nearby posts' })
  async getNearbyPosts(
    @Req() request: Request,
    @Query('lat') lat: number,
    @Query('lon') lon: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('radiusKm') radiusKm?: number,
    @Query('cursor') cursor?: string,
  ): Promise<FeedResponse> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const viewer = await this.resolveViewer(request);

    if (lat === undefined || lon === undefined) {
      return {
        items: [],
        total: 0,
        hasMore: false,
        algorithm: 'nearby',
      };
    }

    return this.feedExploreService.getExploreFeed(
      {
        limit: safeLimit,
        cursor,
        algorithm: 'nearby',
        latitude: lat,
        longitude: lon,
        radiusKm: radiusKm || 10,
      },
      viewer,
    );
  }

  // ============================================
  // EXPLORE FILTERS / META ENDPOINTS
  // ============================================

  @Get('explore/categories')
  @ApiOperation({
    summary: 'Get available categories with post counts',
    description: 'For filter UI in explore page',
  })
  @ApiResponse({ status: 200, description: 'Categories with counts' })
  async getExploreCategories() {
    return this.feedExploreService.getExploreCategories();
  }

  @Get('explore/cities')
  @ApiOperation({
    summary: 'Get cities with post counts',
    description: 'For location filter UI in explore page',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    type: String,
    description: 'Filter by country',
  })
  @ApiResponse({ status: 200, description: 'Cities with counts' })
  async getExploreCities(@Query('country') country?: string) {
    return this.feedExploreService.getExploreCities(country);
  }

  // ============================================
  // STORE-SPECIFIC FEED
  // ============================================

  @Get('store/:storeSlug')
  @ApiOperation({
    summary: 'Get feed for a specific store',
    description: 'All posts from a specific store, newest first',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items (default 20, max 50)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Pagination cursor',
  })
  @ApiResponse({ status: 200, description: 'Store feed items' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async getStoreFeed(
    @Req() request: Request,
    @Param('storeSlug') storeSlug: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ): Promise<FeedResponse> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const viewer = await this.resolveViewer(request);

    const params: StoreFeedParams = {
      storeSlug,
      limit: safeLimit,
      cursor,
    };

    return this.feedExploreService.getStoreFeed(params, viewer);
  }
}
