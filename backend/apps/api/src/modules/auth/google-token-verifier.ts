import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import type { AppEnvironment } from '@app/config';
import type { GoogleProfile } from '../users/users.service';

export const GOOGLE_OAUTH_CLIENT = Symbol('GOOGLE_OAUTH_CLIENT');

@Injectable()
export class GoogleTokenVerifier {
  constructor(
    private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(GOOGLE_OAUTH_CLIENT) private readonly client: OAuth2Client,
  ) {}

  get clientId(): string {
    const id = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    if (!id)
      throw new ServiceUnavailableException('Google sign-in is not configured');
    return id;
  }

  async verify(credential: string, nonce: string): Promise<GoogleProfile> {
    const audience = this.clientId;
    let payload;
    try {
      // Verifies Google's signature, issuer, expiry, and our exact client audience.
      const ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience,
      });
      payload = ticket.getPayload();
    } catch {
      // Never log or return a Google credential or the library's raw error.
      throw new UnauthorizedException(
        'Google sign-in could not be verified. Please try again.',
      );
    }
    if (
      !payload ||
      payload.nonce !== nonce ||
      payload.email_verified !== true ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.sub.length > 255 ||
      typeof payload.email !== 'string' ||
      payload.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(
        payload.iss,
      ) ||
      payload.aud !== audience ||
      (payload.azp !== undefined && payload.azp !== audience) ||
      !Number.isFinite(payload.exp) ||
      payload.exp * 1000 <= Date.now()
    ) {
      throw new UnauthorizedException(
        'Google sign-in could not be verified. Please try again.',
      );
    }
    const name =
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : payload.email.split('@')[0]!;
    return {
      subject: payload.sub,
      email: payload.email.toLowerCase(),
      name: Array.from(name).slice(0, 120).join(''),
    };
  }
}
