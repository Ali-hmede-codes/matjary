import { Module } from '@nestjs/common';

import { OAuth2Client } from 'google-auth-library';
import { ConfigurationModule } from '@app/config';
import { RedisModule } from '@app/queue';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthCookies } from './auth.cookies';
import {
  GoogleTokenVerifier,
  GOOGLE_OAUTH_CLIENT,
} from './google-token-verifier';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
  AdminGuard,
} from './guards/auth.guards';

@Module({
  imports: [ConfigurationModule, RedisModule, UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookies,
    GoogleTokenVerifier,
    AuthOriginGuard,
    AuthRateLimitGuard,
    SessionGuard,
    { provide: GOOGLE_OAUTH_CLIENT, useFactory: () => new OAuth2Client() },
  ],
  exports: [
    AuthService,
    AuthCookies,
    AuthOriginGuard,
    AuthRateLimitGuard,
    SessionGuard,
    AdminGuard,
  ],
})
export class AuthModule {}
