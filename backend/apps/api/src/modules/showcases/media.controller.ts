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
  RequestTimeoutException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { MediaService } from './media.service';
import { PresignedUrlDto, OwnerUploadDto } from './dto/presigned-url.dto';
import { MediaCompleteDto } from './dto/media-complete.dto';
import { StorageService } from '@app/storage';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  AuthenticatedRequest,
} from '../auth/guards/auth.guards';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { isAdminUser, type AdminActor, type UserRole } from '@app/database';
import {
  BinaryOriginGuard,
  OptionalSessionGuard,
} from '../auth/guards/auth.guards';

// Only one range is supported. Invalid and unsatisfiable ranges return 416.
export function parseMediaRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(Number(match[2]), size - 1)
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start ||
    (!match[1] && Number(match[2]) <= 0)
  )
    return null;
  return { start, end };
}

@Controller()
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  private administrator(
    request: Request & {
      user?: { id: string; email?: string; role?: UserRole };
    },
  ): AdminActor | undefined {
    if (
      !request.user ||
      !isAdminUser(
        request.user,
        this.config.get('ADMIN_EMAILS', { infer: true }),
      )
    )
      return undefined;
    return {
      id: request.user.id,
      requestId:
        typeof request.res?.locals.requestId === 'string'
          ? request.res.locals.requestId
          : randomUUID(),
    };
  }

  @Post('posts/:slug/media/presigned-url')
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async presignedUrl(
    @Param('slug') slug: string,
    @Body() dto: PresignedUrlDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.media.presignedUrl(dto, slug, request.user.id);
  }

  @Post('posts/:slug/media/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  async mediaComplete(
    @Param('slug') slug: string,
    @Body() dto: MediaCompleteDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.media.mediaComplete(dto, slug, request.user.id);
  }

  @Post('media/uploads')
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  negotiate(@Body() dto: OwnerUploadDto, @Req() request: AuthenticatedRequest) {
    return this.media.negotiate(dto, request.user.id);
  }

  @Post('media/:id/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  complete(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.media.complete(id, request.user.id);
  }

  @Post('media/:id/abandon')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, AuthOriginGuard, AuthRateLimitGuard)
  abandon(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.media.abandon(id, request.user.id);
  }

  @Get('media/:id')
  @UseGuards(SessionGuard)
  status(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.media.status(id, request.user.id);
  }

  @Get('uploads/:key')
  @UseGuards(OptionalSessionGuard)
  async serveLocalUpload(
    @Param('key') key: string,
    @Req() request: Request & { user?: { id: string } },
    @Res() response: Response,
  ): Promise<void> {
    const access = await this.media.authorizeDownload(
      key,
      request.user?.id,
      this.administrator(request),
    );
    const { size } = await this.storage.statObject(key);
    const header = request.headers.range;
    const range = header ? parseMediaRange(header, size) : undefined;
    // Public variant keys contain the asset UUID and never change bytes, so a
    // positive response is safe to cache for the configured lifetime and may be
    // marked immutable: the browser skips even a revalidation request until the
    // URL itself changes, which only happens for a newly uploaded asset. Every
    // request is still authorized above, so unpublished content stops answering
    // immediately even though copies already downloaded by a visitor persist.
    response.setHeader(
      'Cache-Control',
      access.public
        ? `public, max-age=${this.config.get(
            'MEDIA_PUBLIC_CACHE_SECONDS',
            31536000,
            { infer: true },
          )}, immutable`
        : 'private, no-store',
    );
    if (!access.public) response.setHeader('Vary', 'Cookie');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', access.mimeType);
    response.setHeader('Accept-Ranges', 'bytes');
    if (range === null) {
      response.setHeader('Content-Range', `bytes */${size}`);
      response.status(416).end();
      return;
    }
    if (access.public) {
      const etag = `"${size.toString(16)}"`;
      response.setHeader('ETag', etag);
      // A revalidating browser gets a bodyless answer, which keeps repeat
      // visits cheap without skipping the authorization check above.
      if (!header && request.headers['if-none-match'] === etag) {
        response.status(304).end();
        return;
      }
    }
    if (range) {
      response.status(206);
      response.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${size}`,
      );
    }
    response.setHeader(
      'Content-Length',
      range ? range.end - range.start + 1 : size,
    );
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = await this.storage.openReadStream(key, range);
    // pipeline destroys the source when the reader disconnects.
    await pipeline(stream, response).catch(() => response.destroy());
  }

  @Put('uploads/:key')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, BinaryOriginGuard, AuthRateLimitGuard)
  async uploadLocal(
    @Param('key') key: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ key: string }> {
    const asset = await this.media.authorizeUpload(key, request.user.id);
    const size = Number(asset.sizeBytes);
    if (
      request.headers['content-encoding'] ||
      request.headers['content-type']?.split(';')[0] !== asset.mimeType ||
      (request.headers['content-length'] !== undefined &&
        Number(request.headers['content-length']) !== size)
    ) {
      throw new BadRequestException(
        'Upload headers do not match the negotiated media',
      );
    }
    const abort = new AbortController();
    const disconnected = () => abort.abort();
    request.once('aborted', disconnected);
    const timer = setTimeout(
      () => abort.abort(),
      this.config.get('MEDIA_UPLOAD_TIMEOUT_MS', { infer: true }),
    );
    timer.unref();
    try {
      await this.storage.putStream(key, request, asset.mimeType, size, {
        exclusive: true,
        signal: abort.signal,
      });
      return { key };
    } catch (error) {
      if (abort.signal.aborted)
        throw new RequestTimeoutException('Upload did not finish in time');
      throw error;
    } finally {
      clearTimeout(timer);
      request.removeListener('aborted', disconnected);
    }
  }
}
