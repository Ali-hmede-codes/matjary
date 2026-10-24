import { createHash, randomBytes } from 'node:crypto';
import {
  Injectable,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { RedisService } from '@app/queue';
import { UsersService, type PublicUser } from '../users/users.service';
import { FreeTrialService } from '../users/free-trial.service';
import { GoogleTokenVerifier } from './google-token-verifier';
import { isAdminUser } from '../../../../../libs/database/src/admin-policy';
import { UserRole } from '../../../../../libs/database/src/entities';

export const NONCE_TTL_SECONDS = 600;
export const validToken = (token: unknown): token is string =>
  typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
const key = (kind: string, token: string) =>
  `matjary:auth:${kind}:${hashToken(token)}`;

@Injectable()
export class AuthService {
  constructor(
    private readonly google: GoogleTokenVerifier,
    private readonly users: UsersService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<AppEnvironment, true>,
    private readonly trials: FreeTrialService,
  ) {}

  isAdmin(user: PublicUser): boolean {
    return isAdminUser(user, this.config.get('ADMIN_EMAILS', { infer: true }));
  }

  private withRole(user: PublicUser): PublicUser {
    return {
      ...user,
      role: this.isAdmin(user) ? UserRole.ADMIN : UserRole.USER,
    };
  }

  private async storage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new ServiceUnavailableException(
        'Session storage is temporarily unavailable',
      );
    }
  }

  async rateLimit(ip: string, action: string): Promise<void> {
    const count = await this.storage(() =>
      this.redis.incrementWithTtl(key(`rate:${action}`, ip), 60),
    );
    if (count > 30)
      throw new HttpException(
        'Too many attempts. Try again in a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  async begin(previousNonce?: string) {
    const clientId = this.google.clientId;
    const token = randomBytes(32).toString('base64url');
    if (validToken(previousNonce)) {
      await this.storage(() => this.redis.remove(key('nonce', previousNonce)));
    }
    await this.storage(() =>
      this.redis.setWithTtl(key('nonce', token), '1', NONCE_TTL_SECONDS),
    );
    return { clientId, nonce: hashToken(token), token };
  }

  async signIn(
    credential: string,
    nonceCookie?: string,
    previousSession?: string,
  ) {
    if (
      !validToken(nonceCookie) ||
      !(await this.storage(() => this.redis.get(key('nonce', nonceCookie))))
    ) {
      throw new UnauthorizedException(
        'Sign-in expired. Refresh the page and try again.',
      );
    }
    const profile = await this.google.verify(
      credential,
      hashToken(nonceCookie),
    );
    if (
      !(await this.storage(() => this.redis.consume(key('nonce', nonceCookie))))
    ) {
      throw new UnauthorizedException(
        'Sign-in was already used. Please try again.',
      );
    }
    const user = await this.users.findOrCreateGoogleUser(profile);
    // A new account starts its one-time free trial before the session exists.
    await this.trials.startIfNew(user.id);
    const account = await this.users.findSessionAccount(user.id);
    if (!account)
      throw new UnauthorizedException('Account access is unavailable');
    // Rotate the browser's session on every login; old tokens stop working.
    await this.logout(previousSession);
    const token = randomBytes(32).toString('base64url');
    await this.storage(() =>
      this.redis.setWithTtl(
        key('session', token),
        JSON.stringify({ userId: user.id, version: account.version }),
        this.config.get('AUTH_SESSION_TTL_SECONDS', { infer: true }),
      ),
    );
    return { user: this.withRole(account.user), token };
  }

  async currentUser(token?: string): Promise<PublicUser> {
    if (!validToken(token)) throw new UnauthorizedException('Please sign in');
    const stored = await this.storage(() =>
      this.redis.get(key('session', token)),
    );
    if (!stored)
      throw new UnauthorizedException(
        'Your session expired. Please sign in again.',
      );
    let session: { userId: string; version: number };
    try {
      session = JSON.parse(stored) as typeof session;
      if (
        !session ||
        typeof session.userId !== 'string' ||
        !Number.isSafeInteger(session.version) ||
        session.version < 0
      )
        throw new Error();
    } catch {
      await this.logout(token);
      throw new UnauthorizedException('Please sign in again');
    }
    const account = await this.users.findSessionAccount(session.userId);
    if (!account || account.version !== session.version) {
      await this.logout(token);
      throw new UnauthorizedException('Please sign in again');
    }
    return this.withRole(account.user);
  }

  async logout(token?: string): Promise<void> {
    if (validToken(token))
      await this.storage(() => this.redis.remove(key('session', token)));
  }
}
