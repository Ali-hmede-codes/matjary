import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parse, serialize } from 'cookie';
import type { Request, Response } from 'express';
import type { AppEnvironment } from '@app/config';
import { NONCE_TTL_SECONDS } from './auth.service';

type CookieKind = 'session' | 'nonce';

@Injectable()
export class AuthCookies {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  private get secure(): boolean {
    return this.config
      .get('APP_ORIGIN', { infer: true })
      .startsWith('https://');
  }

  private name(kind: CookieKind): string {
    return `${this.secure ? '__Host-' : ''}matjary_${kind}`;
  }

  read(request: Request, kind: CookieKind): string | undefined {
    return parse(request.headers.cookie ?? '')[this.name(kind)];
  }

  set(response: Response, kind: CookieKind, value: string): void {
    this.write(
      response,
      kind,
      value,
      kind === 'nonce'
        ? NONCE_TTL_SECONDS
        : this.config.get('AUTH_SESSION_TTL_SECONDS', { infer: true }),
    );
  }

  clear(response: Response, kind: CookieKind): void {
    this.write(response, kind, '', 0);
  }

  private write(
    response: Response,
    kind: CookieKind,
    value: string,
    maxAge: number,
  ): void {
    response.append(
      'Set-Cookie',
      serialize(this.name(kind), value, {
        httpOnly: true,
        secure: this.secure,
        sameSite: 'lax',
        path: '/',
        maxAge,
      }),
    );
  }
}
