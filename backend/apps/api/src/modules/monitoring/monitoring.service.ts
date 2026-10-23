import {
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { promises as fs } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { AppEnvironment } from '@app/config';
import { QueueService, RedisService } from '@app/queue';
import {
  httpMetrics,
  parseWorkerSnapshot,
  processSnapshot,
  WORKER_METRICS_KEY,
} from '@app/observability';

@Injectable()
export class MonitoringService implements OnModuleInit {
  private token?: Buffer;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private cached?: {
    at: number;
    value: Awaited<ReturnType<MonitoringService['collect']>>;
  };
  private pending?: Promise<Awaited<ReturnType<MonitoringService['collect']>>>;
  constructor(
    private readonly database: DataSource,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const file = this.config.get('METRICS_TOKEN_FILE', { infer: true });
    if (!file) return;
    try {
      const handle = await fs.open(file, 'r');
      try {
        if ((await handle.stat()).size > 128) throw new Error();
        const value = (await handle.readFile('utf8')).trim();
        if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) throw new Error();
        this.token = Buffer.from(value);
      } finally {
        await handle.close();
      }
    } catch {
      throw new Error('Metrics token file is unavailable or invalid');
    }
  }

  assertScrape(authorization?: string): void {
    const value =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? Buffer.from(authorization.slice(7))
        : Buffer.alloc(0);
    if (
      !this.token ||
      value.length !== this.token.length ||
      !timingSafeEqual(value, this.token)
    )
      throw new NotFoundException('Resource not found');
  }

  private async probe<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T | null> {
    let operation = this.inFlight.get(key) as Promise<T> | undefined;
    if (!operation) {
      operation = Promise.resolve()
        .then(action)
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, operation);
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 2000);
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async collect() {
    const [mysql, redis, rawWorker, queues, media] = await Promise.all([
      this.probe('mysql', async () => {
        await this.database.query('SELECT 1');
        return true;
      }),
      this.probe('redis', async () => {
        await this.redis.ping();
        return true;
      }),
      this.probe('worker', () => this.redis.get(WORKER_METRICS_KEY)),
      this.probe('queues', async () => ({
        media: await this.queue
          .getQueue()
          .getJobCounts('waiting', 'active', 'delayed', 'failed'),
        engagement: await this.queue
          .getEngagementQueue()
          .getJobCounts('waiting', 'active', 'delayed', 'failed'),
      })),
      this.probe('media', async () => {
        const rows = (await this.database.query(
          `SELECT /*+ MAX_EXECUTION_TIME(1500) */
          (SELECT COUNT(*) FROM media_assets WHERE status = 'failed') AS failed,
          (SELECT COUNT(*) FROM media_assets WHERE status = 'processing') AS processing,
          (SELECT COUNT(*) FROM media_processing_outbox) AS outbox,
          (SELECT COALESCE(TIMESTAMPDIFF(SECOND, MIN(created_at), UTC_TIMESTAMP()), 0) FROM media_processing_outbox) AS outboxAgeSeconds,
          (SELECT COUNT(*) FROM media_assets WHERE original_key IS NOT NULL AND (status = 'ready' OR (status = 'failed' AND updated_at < ?))) AS cleanupCandidates`,
          [
            new Date(
              Date.now() -
                this.config.get('MEDIA_ORIGINAL_RETENTION_HOURS', {
                  infer: true,
                }) *
                  3600000,
            ),
          ],
        )) as Array<Record<string, string | number>>;
        const row = rows[0];
        if (!row) return null;
        const fields = [
          'failed',
          'processing',
          'outbox',
          'outboxAgeSeconds',
          'cleanupCandidates',
        ];
        if (
          !fields.every(
            (key) =>
              row[key] !== undefined &&
              Number.isFinite(Number(row[key])) &&
              Number(row[key]) >= 0,
          )
        )
          return null;
        return Object.fromEntries(fields.map((key) => [key, Number(row[key])]));
      }),
    ]);
    const worker = parseWorkerSnapshot(rawWorker);
    return {
      timestamp: Date.now(),
      checks: {
        mysql: mysql ? 'up' : 'down',
        redis: redis ? 'up' : 'down',
        worker: worker ? 'up' : 'down',
      },
      api: { ...processSnapshot(), scope: 'API process (not the VPS)' },
      worker,
      queues,
      media,
    };
  }

  async health() {
    if (this.cached && Date.now() - this.cached.at < 10000) {
      const value = this.cached.value;
      const worker =
        value.worker && parseWorkerSnapshot(JSON.stringify(value.worker));
      return {
        ...value,
        worker,
        checks: { ...value.checks, worker: worker ? 'up' : 'down' },
      };
    }
    if (!this.pending)
      this.pending = this.collect()
        .then((value) => {
          this.cached = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          this.pending = undefined;
        });
    return this.pending;
  }

  async metrics(): Promise<string> {
    const health = await this.health();
    const gauges: Record<string, number> = {
      matjary_mysql_up: health.checks.mysql === 'up' ? 1 : 0,
      matjary_redis_up: health.checks.redis === 'up' ? 1 : 0,
      matjary_worker_up: health.worker ? 1 : 0,
      matjary_worker_heartbeat_seconds: health.worker
        ? health.worker.timestamp / 1000
        : 0,
    };
    if (health.worker) {
      gauges.matjary_worker_rss_bytes = health.worker.rssBytes;
      gauges.matjary_worker_cpu_seconds_total = health.worker.cpuSeconds;
      gauges.matjary_worker_uptime_seconds = health.worker.uptimeSeconds;
    }
    if (health.media)
      for (const [field, value] of Object.entries(health.media))
        gauges[
          `matjary_media_${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`
        ] = value;
    if (health.queues)
      for (const [queue, counts] of Object.entries(health.queues))
        for (const [state, value] of Object.entries(counts))
          gauges[`matjary_queue_${queue}_${state}`] = value;
    return (
      httpMetrics.render() +
      Object.entries(gauges)
        .filter(([, value]) => Number.isFinite(value) && value >= 0)
        .map(
          ([name, value]) =>
            `# TYPE ${name} ${name.endsWith('_total') ? 'counter' : 'gauge'}\n${name} ${value}`,
        )
        .join('\n') +
      '\n'
    );
  }
}
