import { isIP } from 'node:net';
import path from 'node:path';

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
  // Renewal reminders are generated at 00:00 in this zone. The 48-hour window
  // then covers "expires today or tomorrow" exactly, independent of server TZ.
  NOTIFICATION_TIME_ZONE: string;
  // The free plan is a one-time trial; expired owners become read-only.
  FREE_TRIAL_DAYS: number;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD: string;
  // Local disk is supported in development and deployment. Changing providers
  // requires copying/verifying existing objects and arranging delivery.
  STORAGE_PROVIDER: 's3' | 'local';
  STORAGE_LOCAL_DIR: string;
  // Optional second root for locked-shop media. Bytes are moved unchanged, so a
  // separate volume frees the live one without losing anything on renewal.
  // Empty disables archiving (locked shops keep their files in place).
  MEDIA_ARCHIVE_ROOT: string;
  STORAGE_PUBLIC_BASE_URL: string;
  // Engagement (like/view) counters are buffered in Redis and flushed to
  // MySQL asynchronously, so a click never writes synchronously to the DB.
  ENGAGEMENT_RATE_LIMIT_PER_MIN: number;
  ENGAGEMENT_VIEW_DEDUPE_TTL_SECONDS: number;
  ENGAGEMENT_FLUSH_INTERVAL_SECONDS: number;
  ENGAGEMENT_REDIS_KEY_TTL_SECONDS: number;
  // S3 credentials are required only when the optional S3 provider is selected.
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
  // How long browsers/proxies may reuse a public (published) media variant.
  // 0 falls back to revalidating every request.
  MEDIA_PUBLIC_CACHE_SECONDS: number;
  // Comma-separated list of admin email addresses. Empty means no admins.
  ADMIN_EMAILS: string;
  PROMETHEUS_URL: string;
  METRICS_TOKEN_FILE: string;
  ERROR_RETENTION_DAYS: number;
  MEDIA_WORKER_CONCURRENCY: number;
  MEDIA_JOB_TIMEOUT_MS: number;
  MEDIA_UPLOAD_TIMEOUT_MS: number;
  MEDIA_ORIGINAL_RETENTION_HOURS: number;
  MEDIA_MAX_IMAGE_PIXELS: number;
  MEDIA_MAX_VIDEO_HEIGHT: number;
  MEDIA_TEMP_DIR: string;
  FFMPEG_PATH: string;
  FFPROBE_PATH: string;
  TRUST_PROXY_CIDRS: string;
  WORKER_HEARTBEAT_FILE: string;
  // Prerendered storefront shells for link previews. Empty paths or a missing
  // template simply disable the refresher (development default).
  SHARE_SHELL_TEMPLATE: string;
  SHARE_SHELL_ROOT: string;
  // Change-check interval; unchanged shells reconcile only after an hour.
  SHARE_SHELL_REFRESH_SECONDS: number;
  SHARE_SHELL_TOKEN: string;
}

type Environment = Record<string, unknown>;

function resolveEnvironmentPath(value: string): string {
  return path.resolve(value);
}

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
  const storageProvider = String(env.STORAGE_PROVIDER ?? 'local');
  if (!['local', 's3'].includes(storageProvider))
    throw new Error("STORAGE_PROVIDER must be 's3' or 'local'");
  if (storageProvider === 's3') {
    for (const key of [
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ])
      text(env, key);
    try {
      const endpoint = new URL(String(env.S3_ENDPOINT));
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        (nodeEnv === 'production' && endpoint.protocol !== 'https:')
      )
        throw new Error();
    } catch {
      throw new Error(
        'S3_ENDPOINT must be an HTTP(S) URL; HTTPS is required in production',
      );
    }
  }
  const localBase = String(env.STORAGE_PUBLIC_BASE_URL || appOrigin);
  try {
    const base = new URL(localBase);
    if (
      base.origin !== localBase ||
      !['http:', 'https:'].includes(base.protocol) ||
      (nodeEnv === 'production' && base.protocol !== 'https:')
    )
      throw new Error();
  } catch {
    throw new Error(
      'STORAGE_PUBLIC_BASE_URL must be an HTTP(S) origin; HTTPS is required in production',
    );
  }
  const proxies = String(env.TRUST_PROXY_CIDRS ?? '');
  for (const cidr of proxies
    ? proxies.split(',').map((value) => value.trim())
    : []) {
    const [address, prefix, extra] = cidr.split('/');
    const family = isIP(address ?? '');
    if (
      !family ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)))
    )
      throw new Error('TRUST_PROXY_CIDRS must contain IP addresses or CIDRs');
  }
  const pathStyle = String(env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase();
  if (!['true', 'false'].includes(pathStyle))
    throw new Error('S3_FORCE_PATH_STYLE must be true or false');
  const mediaBase = String(env.MEDIA_PUBLIC_BASE_URL ?? '');
  if (mediaBase) {
    try {
      const mediaUrl = new URL(mediaBase);
      if (
        !['http:', 'https:'].includes(mediaUrl.protocol) ||
        mediaUrl.username ||
        mediaUrl.password ||
        mediaUrl.search ||
        mediaUrl.hash ||
        (nodeEnv === 'production' && mediaUrl.protocol !== 'https:')
      )
        throw new Error();
    } catch {
      throw new Error(
        'MEDIA_PUBLIC_BASE_URL must be an HTTP(S) URL; HTTPS is required in production',
      );
    }
  }
  const adminEmails = String(env.ADMIN_EMAILS ?? '')
    .trim()
    .toLowerCase();
  if (
    adminEmails &&
    adminEmails
      .split(',')
      .some(
        (email) =>
          !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email.trim()) ||
          email.trim().length > 254,
      )
  ) {
    throw new Error(
      'ADMIN_EMAILS must be a comma-separated list of email addresses',
    );
  }
  // Intl validates the zone with the same data the scheduler uses, so a typo
  // crashes at boot instead of silently sweeping at the wrong hour.
  const notificationTimeZone = String(
    env.NOTIFICATION_TIME_ZONE ?? 'Asia/Beirut',
  ).trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: notificationTimeZone });
  } catch {
    throw new Error(
      'NOTIFICATION_TIME_ZONE must be a valid IANA time zone such as Asia/Beirut',
    );
  }
  const prometheusUrl = String(env.PROMETHEUS_URL ?? '');
  if (prometheusUrl) {
    try {
      const parsed = new URL(prometheusUrl);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.origin !== prometheusUrl ||
        parsed.username ||
        parsed.password
      )
        throw new Error();
    } catch {
      throw new Error(
        'PROMETHEUS_URL must be an HTTP(S) origin without credentials or a path',
      );
    }
  }
  // The archive must be a separate tree; keeping it inside the live root would
  // move bytes into the same volume (no saving) and confuse key resolution.
  const archiveRoot = String(env.MEDIA_ARCHIVE_ROOT ?? '').trim();
  if (archiveRoot) {
    const liveRoot = resolveEnvironmentPath(
      String(env.STORAGE_LOCAL_DIR ?? 'storage'),
    );
    const resolvedArchive = resolveEnvironmentPath(archiveRoot);
    const nested =
      resolvedArchive === liveRoot ||
      resolvedArchive.startsWith(`${liveRoot}${path.sep}`) ||
      liveRoot.startsWith(`${resolvedArchive}${path.sep}`);
    if (nested)
      throw new Error(
        'MEDIA_ARCHIVE_ROOT must be a directory outside STORAGE_LOCAL_DIR',
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
    NOTIFICATION_TIME_ZONE: notificationTimeZone,
    FREE_TRIAL_DAYS: integer(env, 'FREE_TRIAL_DAYS', 3, 1, 90),
    REDIS_HOST: text(env, 'REDIS_HOST', '127.0.0.1'),
    REDIS_PORT: integer(env, 'REDIS_PORT', 6379, 1, 65535),
    REDIS_PASSWORD: text(env, 'REDIS_PASSWORD'),
    // Local storage does not require an external account or credentials.
    S3_ENDPOINT: String(env.S3_ENDPOINT ?? ''),
    S3_REGION: String(env.S3_REGION ?? 'us-east-1'),
    S3_BUCKET: String(env.S3_BUCKET ?? ''),
    S3_ACCESS_KEY_ID: String(env.S3_ACCESS_KEY_ID ?? ''),
    S3_SECRET_ACCESS_KEY: String(env.S3_SECRET_ACCESS_KEY ?? ''),
    S3_FORCE_PATH_STYLE: pathStyle === 'true',
    MEDIA_PUBLIC_BASE_URL: mediaBase,
    MEDIA_MAX_IMAGE_SIZE_BYTES: integer(
      env,
      'MEDIA_MAX_IMAGE_SIZE_BYTES',
      10485760,
      1,
      10485760,
    ),
    MEDIA_MAX_VIDEO_SIZE_BYTES: integer(
      env,
      'MEDIA_MAX_VIDEO_SIZE_BYTES',
      209715200,
      1,
      209715200,
    ),
    MEDIA_MAX_VIDEO_DURATION_SECONDS: integer(
      env,
      'MEDIA_MAX_VIDEO_DURATION_SECONDS',
      90,
      1,
      90,
    ),
    // Public variants are immutable URLs: the key embeds the asset UUID and the
    // encoder writes it once, so browsers may keep the bytes for a year without
    // any staleness risk. Every request is still authorized, so moderation hides
    // unpublished content immediately; only already-downloaded copies persist.
    // Set 0 to revalidate every request instead.
    MEDIA_PUBLIC_CACHE_SECONDS: integer(
      env,
      'MEDIA_PUBLIC_CACHE_SECONDS',
      31536000,
      0,
      31536000,
    ),
    // Storage provider selection: 's3' (object storage) or 'local' (VPS disk).
    STORAGE_PROVIDER: storageProvider as AppEnvironment['STORAGE_PROVIDER'],
    STORAGE_LOCAL_DIR: text(env, 'STORAGE_LOCAL_DIR', 'storage'),
    MEDIA_ARCHIVE_ROOT: archiveRoot,
    STORAGE_PUBLIC_BASE_URL: localBase,
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
    ADMIN_EMAILS: adminEmails,
    PROMETHEUS_URL: prometheusUrl,
    METRICS_TOKEN_FILE: String(env.METRICS_TOKEN_FILE ?? ''),
    ERROR_RETENTION_DAYS: integer(env, 'ERROR_RETENTION_DAYS', 30, 1, 90),
    MEDIA_WORKER_CONCURRENCY: integer(env, 'MEDIA_WORKER_CONCURRENCY', 1, 1, 4),
    MEDIA_JOB_TIMEOUT_MS: integer(
      env,
      'MEDIA_JOB_TIMEOUT_MS',
      300000,
      1000,
      900000,
    ),
    MEDIA_UPLOAD_TIMEOUT_MS: integer(
      env,
      'MEDIA_UPLOAD_TIMEOUT_MS',
      300000,
      1000,
      900000,
    ),
    MEDIA_ORIGINAL_RETENTION_HOURS: integer(
      env,
      'MEDIA_ORIGINAL_RETENTION_HOURS',
      24,
      1,
      168,
    ),
    MEDIA_MAX_IMAGE_PIXELS: integer(
      env,
      'MEDIA_MAX_IMAGE_PIXELS',
      40000000,
      1,
      100000000,
    ),
    MEDIA_MAX_VIDEO_HEIGHT: integer(
      env,
      'MEDIA_MAX_VIDEO_HEIGHT',
      1080,
      240,
      1080,
    ),
    MEDIA_TEMP_DIR: text(env, 'MEDIA_TEMP_DIR', '.tmp/media'),
    FFMPEG_PATH: text(env, 'FFMPEG_PATH', 'ffmpeg'),
    FFPROBE_PATH: text(env, 'FFPROBE_PATH', 'ffprobe'),
    TRUST_PROXY_CIDRS: proxies,
    WORKER_HEARTBEAT_FILE: text(
      env,
      'WORKER_HEARTBEAT_FILE',
      '.tmp/worker-heartbeat',
    ),
    SHARE_SHELL_TEMPLATE: text(
      env,
      'SHARE_SHELL_TEMPLATE',
      '/srv/share/.matjary-template.html',
    ),
    SHARE_SHELL_ROOT: text(env, 'SHARE_SHELL_ROOT', '/srv/share'),
    SHARE_SHELL_REFRESH_SECONDS: integer(
      env,
      'SHARE_SHELL_REFRESH_SECONDS',
      120,
      30,
      3600,
    ),
    SHARE_SHELL_TOKEN: String(env.SHARE_SHELL_TOKEN ?? ''),
  };
}
