import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Module,
  UnauthorizedException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { OAuth2Client } from 'google-auth-library';
import { QueryFailedError, type Repository } from 'typeorm';
import type { RedisService } from '../../libs/queue/src/redis.service';
import { User } from '../../libs/database/src/entities';
import {
  validateEnvironment,
  type AppEnvironment,
} from '../../libs/config/src/environment';
import {
  AuthService,
  hashToken,
} from '../../apps/api/src/modules/auth/auth.service';
import { AuthCookies } from '../../apps/api/src/modules/auth/auth.cookies';
import { AuthController } from '../../apps/api/src/modules/auth/auth.controller';
import { GoogleTokenVerifier } from '../../apps/api/src/modules/auth/google-token-verifier';
import {
  AuthOriginGuard,
  AuthRateLimitGuard,
  SessionGuard,
} from '../../apps/api/src/modules/auth/guards/auth.guards';
import { UsersService } from '../../apps/api/src/modules/users/users.service';
import { setupApp } from '../../apps/api/src/setup-app';
import type { Request, Response } from 'express';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const config = new ConfigService<AppEnvironment, true>(
  validateEnvironment({
    MYSQL_PASSWORD: 'test',
    REDIS_PASSWORD: 'test',
    GOOGLE_CLIENT_ID: CLIENT_ID,
  }),
);
const profile = {
  subject: 'google-user-1',
  email: 'owner@example.test',
  name: 'Owner',
};
const user = {
  id: 'user-1',
  email: profile.email,
  displayName: profile.name,
  createdAt: new Date('2026-01-01'),
};

class MemoryRedis {
  now = 0;
  fail = false;
  values = new Map<string, { value: string; expires: number }>();
  async get(key: string) {
    if (this.fail) throw new Error('private Redis connection details');
    const item = this.values.get(key);
    return item && item.expires > this.now ? item.value : null;
  }
  async setWithTtl(key: string, value: string, seconds: number) {
    if (this.fail) throw new Error('private Redis connection details');
    this.values.set(key, { value, expires: this.now + seconds });
  }
  async remove(key: string) {
    this.values.delete(key);
  }
  async consume(key: string) {
    // Match Redis GETDEL: no await between the read and removal.
    const item = this.values.get(key);
    this.values.delete(key);
    return item && item.expires > this.now ? item.value : null;
  }
  async incrementWithTtl(key: string, seconds: number) {
    const value = Number((await this.get(key)) ?? '0') + 1;
    if (value === 1) await this.setWithTtl(key, String(value), seconds);
    else this.values.get(key)!.value = String(value);
    return value;
  }
}

function fixture() {
  const redis = new MemoryRedis();
  let deleted = false;
  let version = 0;
  const users = {
    findSessionAccount: async () => (deleted ? null : { user, version }),
    findById: async () => (deleted ? null : user),
    findOrCreateGoogleUser: async () => user,
  } as unknown as UsersService;
  const google = {
    clientId: CLIENT_ID,
    verify: async (credential: string) => {
      if (credential !== 'valid.token.signature')
        throw new UnauthorizedException('Invalid token');
      return profile;
    },
  } as unknown as GoogleTokenVerifier;
  const auth = new AuthService(
    google,
    users,
    redis as unknown as RedisService,
    config,
  );
  return {
    auth,
    redis,
    revokeSessions: () => {
      version++;
    },
    deleteUser: () => {
      deleted = true;
    },
  };
}

test('Google verifier delegates signature validation and pins audience, issuer, expiry, verified email and nonce', async () => {
  let payload: Record<string, unknown> = {
    sub: profile.subject,
    email: profile.email,
    name: 'متجري 🛍️',
    email_verified: true,
    nonce: 'expected-nonce',
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    azp: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const original = { ...payload };
  const client = {
    verifyIdToken: async (options: unknown) => {
      assert.deepEqual(options, {
        idToken: 'private-token',
        audience: CLIENT_ID,
      });
      return { getPayload: () => payload };
    },
  } as unknown as OAuth2Client;
  const verifier = new GoogleTokenVerifier(config, client);
  assert.deepEqual(await verifier.verify('private-token', 'expected-nonce'), {
    ...profile,
    name: 'متجري 🛍️',
  });
  for (const change of [
    { sub: '' },
    { email_verified: false },
    { email_verified: 'true' },
    { email: 'invalid' },
    { email: undefined },
    { nonce: 'wrong' },
    { iss: 'https://evil.test' },
    { aud: 'wrong-client' },
    { azp: 'wrong-client' },
    { exp: 1 },
    { exp: NaN },
  ]) {
    payload = { ...original, ...change };
    await assert.rejects(
      verifier.verify('private-token', 'expected-nonce'),
      UnauthorizedException,
    );
  }
  const failing = new GoogleTokenVerifier(config, {
    verifyIdToken: async () => {
      throw new Error('private-token: signature invalid');
    },
  } as unknown as OAuth2Client);
  await assert.rejects(
    failing.verify('private-token', 'expected-nonce'),
    (error: Error) => {
      assert.doesNotMatch(error.message, /private-token/);
      return error instanceof UnauthorizedException;
    },
  );
});

test('session tokens are opaque, hashed in Redis, rotated and revoked on logout', async () => {
  const { auth, redis } = fixture();
  const first = await auth.begin();
  assert.equal(first.nonce, hashToken(first.token));
  const signedIn = await auth.signIn('valid.token.signature', first.token);
  assert.match(signedIn.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await auth.currentUser(signedIn.token), user);
  assert.equal(
    JSON.stringify([...redis.values]).includes(signedIn.token),
    false,
  );
  assert.equal(
    redis.values.get(`matjary:auth:session:${hashToken(signedIn.token)}`)
      ?.expires,
    604800,
  );
  await assert.rejects(
    auth.signIn('valid.token.signature', first.token),
    UnauthorizedException,
  );
  const second = await auth.begin();
  const rotated = await auth.signIn(
    'valid.token.signature',
    second.token,
    signedIn.token,
  );
  assert.notEqual(rotated.token, signedIn.token);
  await assert.rejects(auth.currentUser(signedIn.token), UnauthorizedException);
  await auth.logout(rotated.token);
  await assert.rejects(auth.currentUser(rotated.token), UnauthorizedException);
  await auth.logout(rotated.token);
});

test('missing, invalid, expired and replaced nonces cannot log in; invalid Google tokens create no sessions', async () => {
  const { auth, redis } = fixture();
  for (const nonce of [undefined, 'bad', 'a'.repeat(43)]) {
    await assert.rejects(
      auth.signIn('valid.token.signature', nonce),
      UnauthorizedException,
    );
  }
  const first = await auth.begin();
  const second = await auth.begin(first.token);
  await assert.rejects(
    auth.signIn('valid.token.signature', first.token),
    UnauthorizedException,
  );
  await assert.rejects(
    auth.signIn('bad.token.signature', second.token),
    UnauthorizedException,
  );
  assert.equal(
    [...redis.values.keys()].some((key) => key.includes(':session:')),
    false,
  );
  redis.now = 601;
  await assert.rejects(
    auth.signIn('valid.token.signature', second.token),
    UnauthorizedException,
  );
});

test('concurrent replay succeeds at most once', async () => {
  const { auth } = fixture();
  const nonce = await auth.begin();
  const results = await Promise.allSettled([
    auth.signIn('valid.token.signature', nonce.token),
    auth.signIn('valid.token.signature', nonce.token),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
});

test('sessions expire and deleted accounts lose access', async () => {
  const f = fixture();
  const nonce = await f.auth.begin();
  const session = await f.auth.signIn('valid.token.signature', nonce.token);
  f.redis.now = 604801;
  await assert.rejects(
    f.auth.currentUser(session.token),
    UnauthorizedException,
  );
  f.redis.now = 0;
  f.deleteUser();
  await assert.rejects(
    f.auth.currentUser(session.token),
    UnauthorizedException,
  );
  assert.equal(
    await f.redis.get(`matjary:auth:session:${hashToken(session.token)}`),
    null,
  );
});

test('revoked session versions and legacy sessions require fresh Google login', async () => {
  const f = fixture();
  const challenge = await f.auth.begin();
  const session = await f.auth.signIn('valid.token.signature', challenge.token);
  f.revokeSessions();
  await assert.rejects(
    f.auth.currentUser(session.token),
    UnauthorizedException,
  );
  const legacy = 'z'.repeat(43);
  await f.redis.setWithTtl(
    `matjary:auth:session:${hashToken(legacy)}`,
    user.id,
    600,
  );
  await assert.rejects(f.auth.currentUser(legacy), UnauthorizedException);
});

test('suspended Google identities cannot sign in or restore sessions', async () => {
  const account = { ...user, suspendedAt: new Date(), sessionVersion: 1 };
  const service = new UsersService({
    findOneBy: async () => account,
  } as unknown as Repository<User>);
  assert.equal(await service.findSessionAccount(user.id), null);
  await assert.rejects(
    service.findOrCreateGoogleUser(profile),
    UnauthorizedException,
  );
});

test('rate limiting expires and unavailable Redis fails closed without leaking details', async () => {
  const { auth, redis } = fixture();
  for (let n = 0; n < 30; n++) await auth.rateLimit('ip', 'google');
  await assert.rejects(
    auth.rateLimit('ip', 'google'),
    (error: { getStatus(): number }) => error.getStatus() === 429,
  );
  redis.now = 61;
  await auth.rateLimit('ip', 'google');
  redis.fail = true;
  await assert.rejects(auth.begin(), (error: Error) => {
    assert.doesNotMatch(error.message, /private Redis/);
    return error instanceof ServiceUnavailableException;
  });
});

test('Google account creation stores no password and never exposes private fields', async () => {
  let created: Partial<User> | undefined;
  const repo = {
    findOneBy: async () => null,
    existsBy: async () => false,
    create: (value: Partial<User>) => {
      created = value;
      return value;
    },
    save: async (value: Partial<User>) => ({ ...user, ...value }),
  } as unknown as Repository<User>;
  const users = new UsersService(repo);
  assert.deepEqual(await users.findOrCreateGoogleUser(profile), user);
  assert.equal(created?.passwordHash, null);
  assert.equal(created?.googleSubject, profile.subject);
});

test('returning Google accounts are matched by subject, not changed email', async () => {
  const users = new UsersService({
    findOneBy: async (where: unknown) => {
      assert.deepEqual(where, { googleSubject: profile.subject });
      return {
        ...user,
        passwordHash: 'private-hash',
        googleSubject: profile.subject,
      };
    },
  } as unknown as Repository<User>);
  assert.deepEqual(
    await users.findOrCreateGoogleUser({
      ...profile,
      email: 'changed@example.test',
    }),
    user,
  );
});

test('matching email never auto-links a different Google identity', async () => {
  const users = new UsersService({
    findOneBy: async () => null,
    existsBy: async () => true,
    save: async () => {
      throw new Error('must not save');
    },
  } as unknown as Repository<User>);
  await assert.rejects(
    users.findOrCreateGoogleUser(profile),
    ConflictException,
  );
});

test('first login racing the email check still returns the same Google account', async () => {
  let reads = 0;
  const users = new UsersService({
    findOneBy: async () => (++reads > 1 ? user : null),
    existsBy: async () => true,
  } as unknown as Repository<User>);
  assert.deepEqual(await users.findOrCreateGoogleUser(profile), user);
});

test('concurrent unique-subject insert returns winner and database failures are sanitized', async () => {
  let reads = 0;
  const users = new UsersService({
    findOneBy: async () => (++reads > 1 ? user : null),
    existsBy: async () => false,
    create: (value: unknown) => value,
    save: async () => {
      throw new QueryFailedError(
        'private query',
        [],
        Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }),
      );
    },
  } as unknown as Repository<User>);
  assert.deepEqual(await users.findOrCreateGoogleUser(profile), user);
  const broken = new UsersService({
    findOneBy: async () => {
      throw new Error('private database host');
    },
  } as unknown as Repository<User>);
  await assert.rejects(
    broken.findOrCreateGoogleUser(profile),
    (error: Error) => {
      assert.doesNotMatch(error.message, /private database/);
      return error instanceof ServiceUnavailableException;
    },
  );
});

test('production cookies are host-only, Secure and HttpOnly; clearing uses identical scope', () => {
  const prod = new ConfigService<AppEnvironment, true>(
    validateEnvironment({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://example.test',
      GOOGLE_CLIENT_ID: CLIENT_ID,
      MYSQL_PASSWORD: 'test',
      REDIS_PASSWORD: 'test',
    }),
  );
  const cookies = new AuthCookies(prod);
  const headers: string[] = [];
  const response = {
    append: (_name: string, value: string) => headers.push(value),
  } as unknown as Response;
  cookies.set(response, 'session', 'a'.repeat(43));
  cookies.clear(response, 'session');
  for (const header of headers) {
    assert.match(header, /^__Host-matjary_session=/);
    assert.match(header, /HttpOnly/);
    assert.match(header, /Secure/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, /Path=\//);
    assert.doesNotMatch(header, /Domain=/);
  }
  assert.match(headers[1]!, /Max-Age=0/);
  assert.equal(
    cookies.read(
      {
        headers: { cookie: `__Host-matjary_session=${'a'.repeat(43)}` },
      } as Request,
      'session',
    ),
    'a'.repeat(43),
  );
});

test('HTTP auth flow enforces CSRF, validates input, restores sessions and revokes logout', async () => {
  const { auth } = fixture();
  @Module({
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: ConfigService, useValue: config },
      AuthCookies,
      AuthOriginGuard,
      AuthRateLimitGuard,
      SessionGuard,
    ],
  })
  class TestModule {}
  const app = await NestFactory.create<NestExpressApplication>(TestModule, {
    logger: false,
  });
  setupApp(app, false);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const post = (
    path: string,
    body: unknown,
    cookie = '',
    origin = 'http://localhost:3000',
  ) =>
    fetch(base + '/api/v1/auth/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    });
  try {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Welcome to Matjary/);
    assert.match(
      page.headers.get('content-security-policy')!,
      /frame-ancestors 'none'/,
    );
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + '/api/v1/auth/me')).status, 401);
    assert.equal(
      (await post('bootstrap', {}, '', 'https://evil.test')).status,
      403,
    );
    assert.equal((await post('bootstrap', {}, '', '')).status, 403);
    assert.equal(
      (
        await fetch(base + '/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:3000',
            'Content-Type': 'text/plain',
          },
          body: '{}',
        })
      ).status,
      415,
    );
    const bootstrap = await post('bootstrap', {});
    assert.equal(bootstrap.status, 200);
    const challenge = (await bootstrap.json()) as {
      clientId: string;
      nonce: string;
      token?: string;
    };
    assert.equal(challenge.clientId, CLIENT_ID);
    assert.equal(challenge.token, undefined);
    const cookie = bootstrap.headers.getSetCookie()[0]!.split(';')[0]!;
    assert.match(bootstrap.headers.getSetCookie()[0]!, /HttpOnly/);
    assert.equal(
      (
        await post(
          'google',
          { credential: 'valid.token.signature', extra: 'blocked' },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (await post('google', { credential: 123 }, cookie)).status,
      400,
    );
    assert.equal(
      (await post('google', { credential: 'not-a-jwt' }, cookie)).status,
      400,
    );
    assert.equal(
      (await post('google', { credential: 'x'.repeat(20000) }, cookie)).status,
      413,
    );
    assert.equal(
      (await post('google', { credential: 'valid.token.signature' })).status,
      401,
    );
    assert.equal(
      (await post('google', { credential: 'bad.token.signature' }, cookie))
        .status,
      401,
    );
    const login = await post(
      'google',
      { credential: 'valid.token.signature' },
      cookie,
    );
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), {
      user: { ...user, createdAt: user.createdAt.toISOString() },
      isAdmin: false,
    });
    const sessionHeader = login.headers
      .getSetCookie()
      .find((item) => item.startsWith('matjary_session='))!;
    assert.match(sessionHeader, /HttpOnly/);
    const session = sessionHeader.split(';')[0]!;
    assert.equal(
      (await fetch(base + '/api/v1/auth/me', { headers: { Cookie: session } }))
        .status,
      200,
    );
    assert.equal(
      (await post('logout', {}, session, 'https://evil.test')).status,
      403,
    );
    const logout = await post('logout', {}, session);
    assert.equal(logout.status, 204);
    assert.match(logout.headers.getSetCookie()[0]!, /Max-Age=0/);
    assert.equal(
      (await fetch(base + '/api/v1/auth/me', { headers: { Cookie: session } }))
        .status,
      401,
    );
  } finally {
    await app.close();
  }
});
