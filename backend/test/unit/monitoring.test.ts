import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { Request } from 'express';
import {
  validateEnvironment,
  type AppEnvironment,
} from '../../libs/config/src/environment';
import {
  ErrorTracker,
  SafeLogger,
  errorTracker,
  parseWorkerSnapshot,
  processSnapshot,
} from '../../libs/observability/src/error-tracker';
import { ErrorPersistence } from '../../libs/observability/src/observability.module';
import {
  HttpMetrics,
  routeTemplate,
} from '../../libs/observability/src/http-metrics';
import {
  PrometheusService,
  boundedPrometheusJson,
  METRIC_QUERIES,
} from '../../apps/api/src/modules/monitoring/prometheus.service';
import { MonitoringService } from '../../apps/api/src/modules/monitoring/monitoring.service';
import { MonitoringWindowDto } from '../../apps/api/src/modules/monitoring/monitoring.controller';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const { validateMonitoringHost } =
  require('../../scripts/check-monitoring.cjs') as {
    validateMonitoringHost: (
      address: unknown,
      platform: string,
      interfaces: object,
    ) => void;
  };
const configuration = (extra: Record<string, string> = {}) =>
  new ConfigService<AppEnvironment, true>(
    validateEnvironment({
      MYSQL_PASSWORD: 'test',
      REDIS_PASSWORD: 'test',
      ...extra,
    }),
  );
const clearErrors = () => {
  while (errorTracker.pending) errorTracker.drain();
  errorTracker.dropped = 0;
};

test('error events are bounded, grouped and contain no raw synthetic secrets', (context) => {
  const output: string[] = [];
  context.mock.method(process.stderr, 'write', (value: string) => {
    output.push(value);
    return true;
  });
  const tracker = new ErrorTracker();
  const secret = 'secret-cookie=credential-sql-password';
  for (let i = 0; i < 1010; i++)
    tracker.capture('api', secret, 'HTTP_FAILURE', 'error', secret);
  assert.equal(tracker.pending, 1000);
  assert.equal(tracker.dropped, 10);
  const batch = tracker.drain(10000);
  assert.equal(batch.length, 100);
  assert.equal(new Set(batch.map((event) => event.fingerprint)).size, 1);
  assert.equal(batch[0]?.operation, 'application');
  assert.equal(batch[0]?.requestId, undefined);
  assert.doesNotMatch(
    JSON.stringify(batch) + output.join(''),
    /secret-cookie|credential-sql-password/,
  );
  clearErrors();
  new SafeLogger('worker').error(
    secret,
    new Error(secret).stack,
    'MediaProcessor',
  );
  const event = errorTracker.drain()[0];
  assert.equal(event?.operation, 'MediaProcessor');
  assert.equal(event?.service, 'worker');
  assert.doesNotMatch(JSON.stringify(event), /secret-cookie/);
});

function persistenceFixture(
  options: { full?: boolean; fail?: boolean; prune?: boolean } = {},
) {
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  let releases = 0;
  const runner = {
    connect: async () => {},
    release: async () => {
      releases++;
    },
    query: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (sql.includes('GET_LOCK')) return [{ acquired: 1 }];
      if (sql.startsWith('SELECT COUNT'))
        return [{ total: options.full ? 10000 : 0 }];
      if (sql.startsWith('INSERT') && options.fail)
        throw new Error('database-password=synthetic-secret');
      return [];
    },
  };
  const persistence = new ErrorPersistence(
    { createQueryRunner: () => runner } as unknown as DataSource,
    configuration(),
    options.prune ?? false,
  );
  return { persistence, statements, releases: () => releases };
}

test('error persistence deduplicates a bounded batch, samples IDs and reopens resolved groups', async (context) => {
  context.mock.method(process.stderr, 'write', () => true);
  clearErrors();
  for (let i = 0; i < 12; i++)
    errorTracker.capture(
      'api',
      'GET /items/:id',
      'HTTP_FAILURE',
      'error',
      randomUUID(),
    );
  const f = persistenceFixture();
  await f.persistence.flush();
  const inserts = f.statements.filter((item) => item.sql.startsWith('INSERT'));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.values?.[6], 12);
  assert.equal(JSON.parse(inserts[0]?.values?.[7] as string).length, 5);
  assert.match(
    inserts[0]!.sql,
    /state = IF\(state = 'resolved', 'open', state\)/,
  );
  assert.equal(f.releases(), 1);
  assert.ok(!f.statements.some((item) => item.sql.startsWith('DELETE')));
  assert.equal(errorTracker.pending, 0);
});

test('retention is worker-only and bounded; group caps and persistence outages drop safely', async (context) => {
  const output: string[] = [];
  context.mock.method(process.stderr, 'write', (value: string) => {
    output.push(value);
    return true;
  });
  for (const options of [{ full: true, prune: true }, { fail: true }]) {
    clearErrors();
    errorTracker.capture('worker', 'MediaProcessor', 'BACKGROUND_FAILURE');
    const f = persistenceFixture(options);
    await f.persistence.flush();
    assert.equal(errorTracker.dropped, 1);
    assert.equal(errorTracker.pending, 0);
    assert.equal(f.releases(), 1);
    if ('prune' in options) {
      const statement = f.statements.find((item) =>
        item.sql.startsWith('DELETE'),
      )!;
      assert.match(statement.sql, /LIMIT 100$/);
      assert.ok(
        Math.abs(
          Date.now() - (statement.values![0] as Date).getTime() - 30 * 86400000,
        ) < 1000,
      );
      assert.ok(!f.statements.some((item) => item.sql.startsWith('INSERT')));
    }
  }
  assert.doesNotMatch(output.join(''), /database-password|synthetic-secret/);
  assert.match(output.join(''), /ERROR_STORAGE_UNAVAILABLE/);
  clearErrors();
});

test('observability runner allocation failure remains best-effort', async (context) => {
  const output: string[] = [];
  context.mock.method(process.stderr, 'write', (value: string) => {
    output.push(value);
    return true;
  });
  clearErrors();
  errorTracker.capture('api', 'GET /items/:id', 'HTTP_FAILURE');
  const persistence = new ErrorPersistence(
    {
      createQueryRunner: () => {
        throw new Error('synthetic-driver-secret');
      },
    } as unknown as DataSource,
    configuration(),
  );
  await assert.doesNotReject(persistence.flush());
  assert.equal(errorTracker.pending, 1);
  assert.doesNotMatch(output.join(''), /synthetic-driver-secret/);
  clearErrors();
});

test('worker snapshots reject stale, oversized, future and malformed readings', () => {
  const now = Date.now();
  const snapshot = {
    timestamp: now,
    rssBytes: 1000,
    cpuSeconds: 1,
    uptimeSeconds: 10,
    secret: 'discard',
  };
  const result = parseWorkerSnapshot(JSON.stringify(snapshot), now);
  assert.ok(result);
  assert.ok(!('secret' in result));
  for (const value of [
    null,
    'null',
    'x'.repeat(1025),
    '{}',
    JSON.stringify({ ...snapshot, timestamp: now - 30000 }),
    JSON.stringify({ ...snapshot, timestamp: now + 2000 }),
    JSON.stringify({ ...snapshot, rssBytes: -1 }),
  ])
    assert.equal(parseWorkerSnapshot(value, now), null);
});

test('health probes share in-flight work and cached snapshots cannot extend worker freshness', async (context) => {
  let databaseCalls = 0;
  const snapshot = processSnapshot();
  snapshot.timestamp -= 29000;
  const database = {
    query: async (sql: string) => {
      databaseCalls++;
      return sql === 'SELECT 1' ? [{}] : [{ failed: 'bad' }];
    },
  };
  const redis = {
    ping: async () => 'PONG',
    get: async () => JSON.stringify(snapshot),
  };
  const queue = {
    getQueue: () => ({ getJobCounts: async () => ({ waiting: 2 }) }),
    getEngagementQueue: () => ({ getJobCounts: async () => ({ failed: 0 }) }),
  };
  const service = new MonitoringService(
    database as never,
    redis as never,
    queue as never,
    configuration(),
  );
  await Promise.all([service.health(), service.health()]);
  assert.equal(databaseCalls, 2);
  const now = Date.now();
  context.mock.method(Date, 'now', () => now + 2000);
  const cached = await service.health();
  assert.equal(cached.worker, null);
  assert.equal(cached.checks.worker, 'down');
  assert.equal(cached.media, null);
  const metrics = await service.metrics();
  assert.doesNotMatch(metrics, /NaN|Infinity|matjary_worker_rss_bytes/);
  assert.match(metrics, /matjary_worker_up 0/);
});

test('scrape tokens are file-backed, fail closed and never included in metrics', async () => {
  const directory = await fs.mkdtemp(join(process.cwd(), '.metrics-unit-'));
  try {
    const path = join(directory, 'token');
    const token = 'x'.repeat(43);
    await fs.writeFile(path, token);
    const service = new MonitoringService(
      {} as never,
      {} as never,
      {} as never,
      configuration({ METRICS_TOKEN_FILE: path }),
    );
    assert.throws(
      () => service.assertScrape('Bearer ' + token),
      NotFoundException,
    );
    await service.onModuleInit();
    assert.doesNotThrow(() => service.assertScrape('Bearer ' + token));
    for (const header of [undefined, token, 'Bearer ' + 'y'.repeat(43)])
      assert.throws(() => service.assertScrape(header), NotFoundException);
    await fs.writeFile(path, 'invalid');
    await assert.rejects(service.onModuleInit(), /unavailable or invalid/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Prometheus responses reject oversized and unsuccessful bodies', async () => {
  await assert.rejects(
    boundedPrometheusJson(new Response('x'.repeat(524289))),
    /limit/,
  );
  const failed = new Response('synthetic upstream secret', { status: 500 });
  await assert.rejects(boundedPrometheusJson(failed), /unavailable/);
  assert.ok(failed.bodyUsed);
  await assert.rejects(
    boundedPrometheusJson(Response.json({ status: 'error', error: 'secret' })),
    /unavailable/,
  );
});

test('VPS uses fixed queries and bounded windows; malformed samples remain unavailable', async (context) => {
  const calls: URL[] = [];
  context.mock.method(
    globalThis,
    'fetch',
    async (input: URL, init: RequestInit) => {
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal);
      const url = new URL(input);
      calls.push(url);
      if (url.pathname.endsWith('/query'))
        return Response.json({
          status: 'success',
          data: { result: [{ value: [Date.now() / 1000, '1'] }] },
        });
      assert.ok(
        Object.values(METRIC_QUERIES).some(
          (item) => item.query === url.searchParams.get('query'),
        ),
      );
      const end = Number(url.searchParams.get('end'));
      assert.ok(
        (end - Number(url.searchParams.get('start'))) /
          Number(url.searchParams.get('step')) <=
          240,
      );
      return Response.json({
        status: 'success',
        data: {
          result: [
            {
              values: [
                [end - 2, '10'],
                [end - 1, 'NaN'],
                [end, null],
              ],
            },
          ],
        },
      });
    },
  );
  const service = new PrometheusService(
    configuration({ PROMETHEUS_URL: 'http://prometheus:9090' }),
  );
  const [first, second] = await Promise.all([
    service.vps('7d'),
    service.vps('7d'),
  ]);
  assert.equal(first, second);
  assert.equal(first.status, 'up');
  assert.equal(calls.length, Object.keys(METRIC_QUERIES).length + 1);
  assert.ok(
    first.metrics.every(
      (item) =>
        item.current === null &&
        item.points.length === 3 &&
        item.points[0]?.[1] === 10,
    ),
  );
  await service.vps('7d');
  assert.equal(calls.length, Object.keys(METRIC_QUERIES).length + 1);
  await assert.rejects(service.vps('__proto__'), BadRequestException);
  assert.ok(
    (
      await validate(
        plainToInstance(MonitoringWindowDto, { window: '1h', query: 'secret' }),
        { whitelist: true, forbidNonWhitelisted: true },
      )
    ).length,
  );
});

test('missing collectors are explicit and alerts are cached and stripped of arbitrary metadata', async (context) => {
  const missing = new PrometheusService(configuration());
  assert.equal((await missing.vps()).status, 'not_configured');
  assert.equal((await missing.alerts()).status, 'not_configured');
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({
      status: 'success',
      data: {
        alerts: [
          {
            labels: {
              alertname: 'VpsUnavailable',
              severity: 'critical',
              secret: 'discard',
            },
            annotations: { secret: 'discard' },
            state: 'firing',
          },
          { labels: { alertname: 'UntrustedName' } },
        ],
      },
    });
  });
  const service = new PrometheusService(
    configuration({ PROMETHEUS_URL: 'http://prometheus:9090' }),
  );
  const [first] = await Promise.all([service.alerts(), service.alerts()]);
  assert.equal(calls, 1);
  assert.deepEqual(first?.items, [
    { name: 'VpsUnavailable', severity: 'critical', state: 'firing' },
  ]);
  context.mock.method(globalThis, 'fetch', async () => {
    throw new Error('upstream secret');
  });
  const down = new PrometheusService(
    configuration({ PROMETHEUS_URL: 'http://prometheus:9090' }),
  );
  assert.equal((await down.vps()).status, 'unavailable');
});

test('admin and monitoring configuration reject unsafe origins, malformed emails and unbounded retention', () => {
  const invalidConfigurations: Array<Record<string, string>> = [
    { ADMIN_EMAILS: 'not-an-address' },
    { PROMETHEUS_URL: 'https://user:synthetic-password@example.test' },
    { PROMETHEUS_URL: 'http://prometheus:9090/api/v1/query' },
    { PROMETHEUS_URL: 'file:///tmp/metrics' },
    { ERROR_RETENTION_DAYS: '0' },
    { ERROR_RETENTION_DAYS: '91' },
  ];
  for (const values of invalidConfigurations)
    assert.throws(
      () => configuration(values),
      (error: Error) => {
        assert.doesNotMatch(error.message, /synthetic-password/);
        return true;
      },
    );
});

test('monitoring binds only to private Docker bridge addresses on Linux', () => {
  const interfaces = {
    docker0: [{ address: '172.17.0.1', internal: false }],
    eth0: [{ address: '10.0.0.1', internal: false }],
  };
  assert.doesNotThrow(() =>
    validateMonitoringHost('172.17.0.1', 'linux', interfaces),
  );
  for (const address of [
    undefined,
    '0.0.0.0',
    '127.0.0.1',
    '8.8.8.8',
    '10.0.0.1',
    '172.18.0.1',
  ])
    assert.throws(() => validateMonitoringHost(address, 'linux', interfaces));
  assert.throws(() =>
    validateMonitoringHost('172.17.0.1', 'win32', interfaces),
  );
});

test('HTTP metric cardinality is bounded and raw URLs are not route labels', () => {
  assert.equal(
    routeTemplate({ url: '/private/secret?token=secret' } as Request),
    'unmatched',
  );
  assert.equal(
    routeTemplate({ route: { path: '/items/:id' } } as Request),
    '/items/:id',
  );
  const metrics = new HttpMetrics();
  for (let i = 0; i < 300; i++) metrics.record('GET', '/route' + i, 200, 0.1);
  assert.equal(
    metrics
      .render()
      .split('\n')
      .filter((line) => line.startsWith('matjary_http_requests_total{')).length,
    256,
  );
});
