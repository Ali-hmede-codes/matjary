import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { serialize } from 'cookie';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { PostEngagementService } from './post-engagement.service';
import { EngagementResponseDto } from '../dto/engagement-response.dto';
import { AuthOriginGuard } from '../../auth/guards/auth.guards';

const VISITOR_COOKIE_NAME = 'matjary_visitor';
const VISITOR_COOKIE_TTL_SECONDS = 365 * 24 * 3600;

/**
 * Public engagement endpoints for posts (showcases).
 *
 * Unlike the mutation routes elsewhere in the API, these intentionally do not
 * require a session: both shop-account holders and anonymous visitors can like
 * and view posts. Viewers are identified by session (logged in) or a visitor
 * cookie (anonymous), and every mutating action is rate-limited per viewer.
 */
@Controller('posts')
export class PostEngagementController {
  constructor(
    private readonly engagement: PostEngagementService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  private get secure(): boolean {
    return this.config
      .get('APP_ORIGIN', { infer: true })
      .startsWith('https://');
  }

  private setVisitorCookie(response: Response, value: string): void {
    response.append(
      'Set-Cookie',
      serialize(VISITOR_COOKIE_NAME, value, {
        httpOnly: true,
        secure: this.secure,
        sameSite: 'lax',
        path: '/',
        maxAge: VISITOR_COOKIE_TTL_SECONDS,
      }),
    );
  }

  @Get(':slug/engagement')
  async getEngagement(
    @Param('slug') slug: string,
    @Req() request: Request,
  ): Promise<EngagementResponseDto> {
    const viewer = await this.engagement.resolveViewer(request);
    const { likes, views, viewerLiked } = await this.engagement.getEngagement(
      slug,
      viewer,
    );
    const dto = new EngagementResponseDto();
    dto.likes = likes;
    dto.views = views;
    dto.viewerLiked = viewerLiked;
    return dto;
  }

  @Post(':slug/like')
  @UseGuards(AuthOriginGuard)
  async toggleLike(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EngagementResponseDto> {
    const viewer = await this.engagement.resolveViewer(request);
    if (viewer.newVisitorId) {
      this.setVisitorCookie(response, viewer.newVisitorId);
    }
    const { liked, likes } = await this.engagement.toggleLike(slug, viewer);
    const dto = new EngagementResponseDto();
    dto.likes = likes;
    dto.views = 0;
    dto.viewerLiked = liked;
    return dto;
  }

  @Post(':slug/view')
  @UseGuards(AuthOriginGuard)
  async registerView(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EngagementResponseDto> {
    const viewer = await this.engagement.resolveViewer(request);
    if (viewer.newVisitorId) {
      this.setVisitorCookie(response, viewer.newVisitorId);
    }
    const { views } = await this.engagement.registerView(slug, viewer);
    const dto = new EngagementResponseDto();
    dto.likes = 0;
    dto.views = views;
    dto.viewerLiked = false;
    return dto;
  }
}
