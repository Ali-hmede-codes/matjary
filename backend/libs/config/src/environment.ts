export interface DatabaseEnvironment {
  MYSQL_HOST: string;
  MYSQL_PORT: number;
  MYSQL_DATABASE: string;
  MYSQL_USER: string;
  MYSQL_PASSWORD: string;
  MYSQL_POOL_SIZE: number;
  MYSQL_CONNECT_TIMEOUT_MS: number;
}

export interface AppEnvironment extends DatabaseEnvironment {
  NODE_ENV: 'development' | 'test' | 'production';
  API_HOST: string;
  API_PORT: number;
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  AUTH_SESSION_TTL_SECONDS: number;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD: string;
  // Media storage provider: 's3' (object storage, production recommendation)
  // or 'local' (files on this VPS disk). Flipped by config, no code change.
  STORAGE_PROVIDER: 's3' | 'local';
  STORAGE_LOCAL_DIR: string;
  STORAGE_PUBLIC_BASE_URL: string;
  // Engagement (like/view) counters are buffered in Redis and flushed to
  // MySQL asynchronously, so a click never writes synchronously to the DB.
  ENGAGEMENT_RATE_LIMIT_PER_MIN: number;
  ENGAGEMENT_VIEW_DEDUPE_TTL_SECONDS: number;
  ENGAGEMENT_FLUSH_INTERVAL_SECONDS: number;
  ENGAGEMENT_REDIS_KEY_TTL_SECONDS: number;
  // S3-compatible object storage for direct media uploads. Credentials are
  // optional until media upload is wired up; empty values disable presigned URLs.
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_FORCE_PATH_STYLE: boolean;
  MEDIA_PUBLIC_BASE_URL: string;
  // Media limits, in bytes unless noted.
  MEDIA_MAX_IMAGE_SIZE_BYTES: number;
  MEDIA_MAX_VIDEO_SIZE_BYTES: number;
  MEDIA_MAX_VIDEO_DURATION_SECONDS: number;
  // Comma-separated list of admin email addresses. Empty means no admins.
  ADMIN_EMAILS: string;
}

type Environment = Record<string, unknown>;

function text(env: Environment, key: string, fallback?: string): string {
  const value = env[key] ?? fallback;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a nonempty string`);
  }
  return value;
}

function integer(
  env: Environment,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key] ?? fallback;
  if (
    (typeof raw !== 'string' && typeof raw !== 'number') ||
    !/^\d+$/.test(String(raw))
  ) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

// The migration CLI needs only MySQL, not Redis or future storage credentials.
export function validateDatabaseEnvironment(
  env: Environment,
): DatabaseEnvironment {
  return {
    MYSQL_HOST: text(env, 'MYSQL_HOST', '127.0.0.1'),
    MYSQL_PORT: integer(env, 'MYSQL_PORT', 3306, 1, 65535),
    MYSQL_DATABASE: text(env, 'MYSQL_DATABASE', 'matjary'),
    MYSQL_USER: text(env, 'MYSQL_USER', 'matjary'),
    MYSQL_PASSWORD: text(env, 'MYSQL_PASSWORD'),
    MYSQL_POOL_SIZE: integer(env, 'MYSQL_POOL_SIZE', 10, 1, 50),
    MYSQL_CONNECT_TIMEOUT_MS: integer(
      env,
      'MYSQL_CONNECT_TIMEOUT_MS',
      5000,
      100,
      60000,
    ),
  };
}

export function validateEnvironment(
  env: Environment,
): AppEnvironment & Environment {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(String(nodeEnv))) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const apiPort = integer(env, 'API_PORT', 3000, 1, 65535);
  const appOrigin = text(env, 'APP_ORIGIN', `http://localhost:${apiPort}`);
  let url: URL;
  try {
    url = new URL(appOrigin);
  } catch {
    throw new Error('APP_ORIGIN must be a valid HTTP(S) origin without a path');
  }
  if (
    url.origin !== appOrigin ||
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' &&
      (nodeEnv === 'production' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    throw new Error(
      'APP_ORIGIN must be HTTPS, or HTTP localhost in development, without a path',
    );
  }
  const googleClientId = env.GOOGLE_CLIENT_ID ?? '';
  if (
    typeof googleClientId !== 'string' ||
    (googleClientId !== '' &&
      !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(googleClientId)) ||
    (nodeEnv === 'production' && googleClientId === '')
  ) {
    throw new Error(
      'GOOGLE_CLIENT_ID must be a Google web client ID; required in production',
    );
  }
  return {
    ...env,
    ...validateDatabaseEnvironment(env),
    NODE_ENV: nodeEnv as AppEnvironment['NODE_ENV'],
    API_HOST: text(env, 'API_HOST', '127.0.0.1'),
    API_PORT: apiPort,
    APP_ORIGIN: appOrigin,
    GOOGLE_CLIENT_ID: googleClientId,
    AUTH_SESSION_TTL_SECONDS: integer(
      env,
      'AUTH_SESSION_TTL_SECONDS',
      604800,
      300,
      2592000,
    ),
    REDIS_HOST: text(env, 'REDIS_HOST', '127.0.0.1'),
    REDIS_PORT: integer(env, 'REDIS_PORT', 6379, 1, 65535),
    REDIS_PASSWORD: text(env, 'REDIS_PASSWORD'),
    // Storage credentials are optional until media upload is wired up; empty
    // values disable presigned URLs (sanitized 503 from S3Service).
    S3_ENDPOINT: String(env.S3_ENDPOINT ?? ''),
    S3_REGION: String(env.S3_REGION ?? 'us-east-1'),
    S3_BUCKET: String(env.S3_BUCKET ?? ''),
    S3_ACCESS_KEY_ID: String(env.S3_ACCESS_KEY_ID ?? ''),
    S3_SECRET_ACCESS_KEY: String(env.S3_SECRET_ACCESS_KEY ?? ''),
    S3_FORCE_PATH_STYLE:
      String(env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true',
    MEDIA_PUBLIC_BASE_URL: String(env.MEDIA_PUBLIC_BASE_URL ?? ''),
    MEDIA_MAX_IMAGE_SIZE_BYTES: integer(
      env,
      'MEDIA_MAX_IMAGE_SIZE_BYTES',
      10485760,
      1,
      104857600,
    ),
    MEDIA_MAX_VIDEO_SIZE_BYTES: integer(
      env,
      'MEDIA_MAX_VIDEO_SIZE_BYTES',
      209715200,
      1,
      1073741824,
    ),
    MEDIA_MAX_VIDEO_DURATION_SECONDS: integer(
      env,
      'MEDIA_MAX_VIDEO_DURATION_SECONDS',
      90,
      1,
      3600,
    ),
    // Storage provider selection: 's3' (object storage) or 'local' (VPS disk).
    STORAGE_PROVIDER: (() => {
      const value = String(env.STORAGE_PROVIDER ?? 's3');
      if (value !== 's3' && value !== 'local') {
        throw new Error("STORAGE_PROVIDER must be 's3' or 'local'");
      }
      return value as AppEnvironment['STORAGE_PROVIDER'];
    })(),
    STORAGE_LOCAL_DIR: String(env.STORAGE_LOCAL_DIR ?? 'storage'),
    STORAGE_PUBLIC_BASE_URL: String(env.STORAGE_PUBLIC_BASE_URL ?? ''),
    // Engagement counters: buffered in Redis, flushed to MySQL asynchronously.
    ENGAGEMENT_RATE_LIMIT_PER_MIN: integer(
      env,
      'ENGAGEMENT_RATE_LIMIT_PER_MIN',
      30,
      1,
      600,
    ),
    ENGAGEMENT_VIEW_DEDUPE_TTL_SECONDS: integer(
      env,
      'ENGAGEMENT_VIEW_DEDUPE_TTL_SECONDS',
      300,
      1,
      86400,
    ),
    ENGAGEMENT_FLUSH_INTERVAL_SECONDS: integer(
      env,
      'ENGAGEMENT_FLUSH_INTERVAL_SECONDS',
      60,
      5,
      3600,
    ),
    ENGAGEMENT_REDIS_KEY_TTL_SECONDS: integer(
      env,
      'ENGAGEMENT_REDIS_KEY_TTL_SECONDS',
      86400,
      60,
      604800,
    ),
    // Admin emails (comma-separated) that can access admin-only boost endpoints.
    // Empty means no admin endpoints are accessible.
    ADMIN_EMAILS: String(env.ADMIN_EMAILS ?? ''),
  };
}
