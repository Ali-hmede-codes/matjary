import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppEnvironment } from '@app/config';
import type { PublicUser } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { AuthCookies } from '../auth.cookies';

export type AuthenticatedRequest = Request & { user: PublicUser };

// AdminGuard restricts access to admin-only boost endpoints. Since the User
// entity has no role/isAdmin field, admin status is derived from the
// ADMIN_EMAILS environment variable (comma-separated list). An empty list
// means no admin endpoints are accessible.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }
    const adminEmails = this.config.get('ADMIN_EMAILS', { infer: true });
    const adminList = adminEmails
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!adminList.includes(user.email.toLowerCase())) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}

// Apply to cookie-authenticated mutation routes, including login and logout.
@Injectable()
export class AuthOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.headers.origin !== this.config.get('APP_ORIGIN', { infer: true })
    ) {
      throw new ForbiddenException('Request origin is not allowed');
    }
    if (!request.is('application/json')) {
      throw new UnsupportedMediaTypeException('Use application/json');
    }
    return true;
  }
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    // Express does not trust forwarded IP headers unless a trusted proxy is configured.
    await this.auth.rateLimit(
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      context.getHandler().name,
    );
    return true;
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.auth.currentUser(
      this.cookies.read(request, 'session'),
    );
    return true;
  }
}
