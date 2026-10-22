import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { MediaService } from './media.service';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { MediaCompleteDto } from './dto/media-complete.dto';
import { StorageService } from '@app/storage';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  AuthenticatedRequest,
} from '../auth/guards/auth.guards';
import { serialize } from 'cookie';

// Local-storage media routes. When STORAGE_PROVIDER=local, presigned URLs
// point here so clients PUT uploads to and GET media from this API (media
// bytes flow through the API for local storage; object storage avoids this).
const LOCAL_UPLOAD_ROUTE = 'uploads';
const MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

function mimeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

@Controller('posts')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly storage: StorageService,
  ) {}

  @Post(':slug/media/presigned-url')
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async presignedUrl(
    @Param('slug') slug: string,
    @Body() dto: PresignedUrlDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.media.presignedUrl(dto, slug, request.user.id);
  }

  @Post(':slug/media/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async mediaComplete(
    @Param('slug') slug: string,
    @Body() dto: MediaCompleteDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.media.mediaComplete(dto, slug, request.user.id);
  }

  /**
   * Serve a locally-stored media object (STORAGE_PROVIDER=local only).
   * Public: media is meant to be viewed. With S3, clients use presigned GET
   * URLs instead, so this route is effectively local-storage only.
   */
  @Get(`/${LOCAL_UPLOAD_ROUTE}/:key`)
  async serveLocalUpload(
    @Param('key') key: string,
    @Res() response: Response,
  ): Promise<void> {
    const buffer = await this.storage.getObject(key);
    response.setHeader('Content-Type', mimeForKey(key));
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.send(buffer);
  }

  /**
   * Receive a direct local-storage upload (STORAGE_PROVIDER=local only).
   * Requires an authenticated session; the caller should have obtained the
   * key from a presigned PUT URL. Requires a raw body parser (see main.ts).
   */
  @Put(`/${LOCAL_UPLOAD_ROUTE}/:key`)
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  async uploadLocal(
    @Param('key') key: string,
    @Req() request: Request,
  ): Promise<{ key: string }> {
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException('Empty upload');
    }
    const contentType = request.headers['content-type'];
    const mime = Array.isArray(contentType) ? contentType[0] : contentType;
    await this.storage.putObject(key, body, mime ?? 'application/octet-stream');
    return { key };
  }
}
