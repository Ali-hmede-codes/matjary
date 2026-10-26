import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { AppEnvironment } from '@app/config';
import { ShareShellService } from './share-shell.service';

/**
 * Deployment hook used to rebuild the prerendered storefront shells right
 * after the frontend is published. It is intentionally separate from
 * SeoController so the mutation guards do not require a browser Origin; the
 * shared secret is the only credential and an empty secret hides the route.
 */
@Controller('seo')
export class ShareShellController {
  constructor(
    private readonly shells: ShareShellService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  @Post('share-shells/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Headers('x-share-shell-token') token?: string,
  ): Promise<{ pages: number }> {
    const expected = this.config.get('SHARE_SHELL_TOKEN', { infer: true });
    // A missing secret or a wrong token must not reveal that the route exists.
    if (!expected || !token || !sameSecret(token, expected))
      throw new NotFoundException();
    return { pages: await this.shells.refreshAll() };
  }
}

function sameSecret(value: string, expected: string): boolean {
  const given = Buffer.from(value);
  const configured = Buffer.from(expected);
  return (
    given.length === configured.length && timingSafeEqual(given, configured)
  );
}
