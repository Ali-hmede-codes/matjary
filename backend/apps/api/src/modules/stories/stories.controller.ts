import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  AuthenticatedRequest,
} from '../auth/guards/auth.guards';
import { normalizeStoreSlugs } from '../showcases/services/feed-explore.service';
import { StoriesService, storyListLimit } from './stories.service';
import {
  CreateStoryDto,
  STORE_SLUG_PATTERN,
  type MyStoriesResponse,
  type StoryDto,
  type StoryListResponse,
} from './dto/story.dto';

@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  // Public rail, shop page and story page. Favorites pass the shop slugs they
  // already know, so the same endpoint serves every surface.
  @Get()
  list(
    @Query('shops', new DefaultValuePipe('')) shops: string,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
  ): Promise<StoryListResponse> {
    return this.stories.list(
      normalizeStoreSlugs(shops.split(',')),
      storyListLimit(limit),
    );
  }

  // Owner view for the "+" on the shop logo and the dashboard block.
  @Get('mine')
  @UseGuards(SessionGuard)
  mine(
    @Query('storeSlug', new DefaultValuePipe('')) storeSlug: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<MyStoriesResponse> {
    if (!STORE_SLUG_PATTERN.test(storeSlug))
      throw new NotFoundException('Store not found');
    return this.stories.mine(storeSlug, request.user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  create(
    @Body() dto: CreateStoryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<StoryDto> {
    return this.stories.create(dto, request.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.stories.remove(id, request.user.id);
  }
}
