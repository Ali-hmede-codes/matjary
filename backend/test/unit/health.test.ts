import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { RedisService } from '../../libs/queue/src/redis.service';
import {
  HealthController,
  checkDependency,
} from '../../apps/api/src/modules/health/health.controller';

function controller(
  query: () => Promise<unknown>,
  ping: () => Promise<void>,
): HealthController {
  return new HealthController(
    { query } as unknown as DataSource,
    { ping } as RedisService,
  );
}

test('liveness does not query dependencies', () => {
  const fail = async () => {
    throw new Error('offline');
  };
  assert.deepEqual(controller(fail, fail).live(), { status: 'ok' });
});

test('readiness succeeds only when both dependencies are available', async () => {
  const health = controller(
    async () => [{ 1: 1 }],
    async () => {},
  );
  assert.deepEqual(await health.ready(), {
    status: 'ok',
    checks: { mysql: 'up', redis: 'up' },
  });
});

for (const failing of ['mysql', 'redis', 'both']) {
  test(`readiness returns a sanitized 503 when ${failing} fails`, async () => {
    const ok = async () => {};
    const fail = async () => {
      throw new Error('private credential / host details');
    };
    const health = controller(
      failing !== 'redis' ? fail : ok,
      failing !== 'mysql' ? fail : ok,
    );
    await assert.rejects(
      health.ready(),
      (error: ServiceUnavailableException) => {
        assert.equal(error.getStatus(), 503);
        assert.deepEqual(error.getResponse(), {
          status: 'error',
          checks: {
            mysql: failing !== 'redis' ? 'down' : 'up',
            redis: failing !== 'mysql' ? 'down' : 'up',
          },
        });
        assert.doesNotMatch(
          JSON.stringify(error.getResponse()),
          /private|credential/,
        );
        return true;
      },
    );
  });
}

test('dependency timeouts and synchronous failures are reported as down', async () => {
  // Use a generous timeout so the test is not flaky on loaded CI runners.
  assert.equal(await checkDependency(() => new Promise(() => {}), 50), 'down');
  assert.equal(
    await checkDependency(() => {
      throw new Error('offline');
    }),
    'down',
  );
});

test('concurrent readiness requests share the database query and recover after failure', async () => {
  let calls = 0;
  let rejectQuery!: (error: Error) => void;
  const query = new Promise((_, reject) => {
    rejectQuery = reject;
  });
  const health = controller(
    () => {
      calls++;
      return query;
    },
    async () => {},
  );
  const results = Promise.allSettled([health.ready(), health.ready()]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  rejectQuery(new Error('offline'));
  assert.equal(
    (await results).every((result) => result.status === 'rejected'),
    true,
  );
  assert.equal(calls, 1);
  await assert.rejects(health.ready());
  assert.equal(calls, 2);
});
