import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateDatabaseEnvironment,
  validateEnvironment,
} from '../../libs/config/src/environment';

const required = {
  MYSQL_PASSWORD: 'mysql-test-password',
  REDIS_PASSWORD: 'redis-test-password',
};

test('application environment supplies local defaults and parses numeric values', () => {
  const env = validateEnvironment({
    ...required,
    API_PORT: '3100',
    MYSQL_POOL_SIZE: '5',
  });
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.API_HOST, '127.0.0.1');
  assert.equal(env.API_PORT, 3100);
  assert.equal(env.MYSQL_PORT, 3306);
  assert.equal(env.MYSQL_POOL_SIZE, 5);
  assert.equal(env.REDIS_PORT, 6379);
});

test('auth defaults use the API origin and a seven-day absolute session', () => {
  const env = validateEnvironment({ ...required, API_PORT: '3100' });
  assert.equal(env.APP_ORIGIN, 'http://localhost:3100');
  assert.equal(env.AUTH_SESSION_TTL_SECONDS, 604800);
  assert.equal(env.GOOGLE_CLIENT_ID, '');
});

test('auth configuration rejects unsafe origins, invalid IDs and session lifetimes', () => {
  for (const APP_ORIGIN of [
    'invalid',
    'http://evil.test',
    'https://example.test/path',
    'https://example.test/',
    'https://user:password@example.test',
    'https://example.test?query=1',
  ]) {
    assert.throws(
      () => validateEnvironment({ ...required, APP_ORIGIN }),
      /APP_ORIGIN/,
    );
  }
  for (const AUTH_SESSION_TTL_SECONDS of ['0', '299', '2592001', 'abc']) {
    assert.throws(
      () => validateEnvironment({ ...required, AUTH_SESSION_TTL_SECONDS }),
      /AUTH_SESSION_TTL_SECONDS/,
    );
  }
  assert.throws(
    () =>
      validateEnvironment({ ...required, GOOGLE_CLIENT_ID: 'private-secret' }),
    /GOOGLE_CLIENT_ID/,
  );
  assert.throws(
    () => validateEnvironment({ ...required, NODE_ENV: 'production' }),
    /APP_ORIGIN/,
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...required,
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://example.test',
      }),
    /GOOGLE_CLIENT_ID/,
  );
  assert.equal(
    validateEnvironment({
      ...required,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://example.test',
      GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
    }).APP_ORIGIN,
    'https://example.test',
  );
});

test('database-only validation does not require Redis or storage credentials', () => {
  assert.equal(
    validateDatabaseEnvironment({ MYSQL_PASSWORD: 'test' }).MYSQL_USER,
    'matjary',
  );
});

test('passwords are preserved verbatim and never included in validation errors', () => {
  assert.equal(
    validateEnvironment({ ...required, MYSQL_PASSWORD: ' secret with spaces ' })
      .MYSQL_PASSWORD,
    ' secret with spaces ',
  );
  assert.throws(
    () => validateEnvironment({ ...required, API_PORT: 'private-value' }),
    (error: Error) => {
      assert.match(error.message, /API_PORT/);
      assert.doesNotMatch(error.message, /private-value|mysql-test-password/);
      return true;
    },
  );
});

for (const key of ['API_PORT', 'MYSQL_PORT', 'REDIS_PORT']) {
  for (const value of [
    '',
    '0',
    '65536',
    '3.5',
    '12garbage',
    'NaN',
    'Infinity',
    '-1',
  ]) {
    test(`${key} rejects invalid value ${JSON.stringify(value)}`, () => {
      assert.throws(
        () => validateEnvironment({ ...required, [key]: value }),
        new RegExp(key),
      );
    });
  }
}

for (const key of ['MYSQL_PASSWORD', 'REDIS_PASSWORD']) {
  test(`${key} must not be missing or blank`, () => {
    for (const value of [undefined, '', '   ']) {
      assert.throws(
        () => validateEnvironment({ ...required, [key]: value }),
        new RegExp(key),
      );
    }
  });
}

test('environment rejects unsupported runtime modes and unbounded pools', () => {
  assert.throws(
    () => validateEnvironment({ ...required, NODE_ENV: 'prod' }),
    /NODE_ENV/,
  );
  assert.throws(
    () => validateEnvironment({ ...required, MYSQL_POOL_SIZE: '51' }),
    /MYSQL_POOL_SIZE/,
  );
  assert.throws(
    () => validateEnvironment({ ...required, MYSQL_CONNECT_TIMEOUT_MS: '0' }),
    /MYSQL_CONNECT_TIMEOUT_MS/,
  );
});

test('storage provider defaults to s3 and accepts local', () => {
  assert.equal(validateEnvironment({ ...required }).STORAGE_PROVIDER, 's3');
  assert.equal(
    validateEnvironment({ ...required, STORAGE_PROVIDER: 'local' })
      .STORAGE_PROVIDER,
    'local',
  );
  assert.equal(
    validateEnvironment({ ...required }).STORAGE_LOCAL_DIR,
    'storage',
  );
  assert.equal(
    validateEnvironment({ ...required }).STORAGE_PUBLIC_BASE_URL,
    '',
  );
});

test('storage provider rejects invalid values', () => {
  for (const STORAGE_PROVIDER of ['S3', 'localhost', 'minio', '']) {
    assert.throws(
      () => validateEnvironment({ ...required, STORAGE_PROVIDER }),
      /STORAGE_PROVIDER/,
    );
  }
});

test('engagement config uses sane async-first defaults', () => {
  const env = validateEnvironment({ ...required });
  assert.equal(env.ENGAGEMENT_RATE_LIMIT_PER_MIN, 30);
  assert.equal(env.ENGAGEMENT_VIEW_DEDUPE_TTL_SECONDS, 300);
  assert.equal(env.ENGAGEMENT_FLUSH_INTERVAL_SECONDS, 60);
  assert.equal(env.ENGAGEMENT_REDIS_KEY_TTL_SECONDS, 86400);
});

test('engagement rate limit rejects out-of-range values', () => {
  for (const value of ['0', '-1', '601', 'abc']) {
    assert.throws(
      () =>
        validateEnvironment({
          ...required,
          ENGAGEMENT_RATE_LIMIT_PER_MIN: value,
        }),
      /ENGAGEMENT_RATE_LIMIT_PER_MIN/,
    );
  }
});
