import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppEnvironment } from '@app/config';
import type { PublicUser } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { AuthCookies } from '../auth.cookies';
import {
  isAdminUser,
  isGlobalAdminUser,
} from '../../../../../../libs/database/src/admin-policy';

export type AuthenticatedRequest = Request & { user: PublicUser };

// SessionGuard loads the current database role before admin authorization.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  isAdmin(user: PublicUser | undefined): boolean {
    return isAdminUser(
      user,
      this.config.get('ADMIN_EMAILS', { infer: true }) ?? '',
    );
  }

  // Store-scoped administrators reach the workspace but not platform-wide
  // operations such as plans, website settings, or verification decisions.
  isGlobalAdmin(user: PublicUser | undefined): boolean {
    return isGlobalAdminUser(
      user,
      this.config.get('ADMIN_EMAILS', { infer: true }) ?? '',
    );
  }

  canActivate(context: ExecutionContext): boolean {
    if (
      !this.isAdmin(
        context.switchToHttp().getRequest<AuthenticatedRequest>().user,
      )
    ) {
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
export class BinaryOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.headers.origin !== this.config.get('APP_ORIGIN', { infer: true })
    ) {
      throw new ForbiddenException('Request origin is not allowed');
    }
    return true;
  }
}

@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: PublicUser }>();
    const token = this.cookies.read(request, 'session');
    if (token) {
      try {
        request.user = await this.auth.currentUser(token);
      } catch (error) {
        // Expired sessions may browse anonymously, but outages must fail closed.
        if (!(error instanceof UnauthorizedException)) throw error;
      }
    }
    return true;
  }
}

@Injectable()
export class MutationGuard implements CanActivate {
  constructor(
    private readonly origin: AuthOriginGuard,
    private readonly rate: AuthRateLimitGuard,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const method = context.switchToHttp().getRequest<Request>().method;
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
    this.origin.canActivate(context);
    return this.rate.canActivate(context);
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
