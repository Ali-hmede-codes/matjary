import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { parse, serialize } from 'cookie';
import type { Request, Response } from 'express';
import type { AppEnvironment } from '@app/config';
import { OptionalSessionGuard } from '../auth/guards/auth.guards';

type CartRequest = Request & { user?: { id: string }; cartVisitorId?: string };

@Injectable()
export class CartIdentityGuard implements CanActivate {
  constructor(private readonly sessions: OptionalSessionGuard, private readonly config: ConfigService<AppEnvironment, true>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.sessions.canActivate(context);
    const request = context.switchToHttp().getRequest<CartRequest>();
    if (request.user) return true;
    const response = context.switchToHttp().getResponse<Response>();
    const secure = this.config.get('APP_ORIGIN', { infer: true }).startsWith('https://');
    const name = `${secure ? '__Host-' : ''}matjary_cart`;
    let token = parse(request.headers.cookie ?? '')[name];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      token = randomBytes(32).toString('hex');
      response.append('Set-Cookie', serialize(name, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 604800 }));
    }
    // Cart responses and database rows never disclose the bearer credential.
    request.cartVisitorId = createHash('sha256').update(token).digest('hex');
    return true;
  }
}

export const CartVisitor = createParamDecorator((_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<CartRequest>().cartVisitorId);
