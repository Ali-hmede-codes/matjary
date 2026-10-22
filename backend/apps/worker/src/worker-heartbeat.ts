import { Injectable, OnApplicationBootstrap, BeforeApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RedisService } from '@app/queue';
import type { AppEnvironment } from '@app/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MediaProcessor } from './jobs/media.process';
import { EngagementFlusher } from './jobs/engagement.flush';

@Injectable()
export class WorkerHeartbeat implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private pending?: Promise<void>;
  private readonly logger = new Logger(WorkerHeartbeat.name);
  constructor(
    private readonly config: ConfigService<AppEnvironment, true>,
    private readonly database: DataSource,
    private readonly redis: RedisService,
    private readonly media: MediaProcessor,
    private readonly engagement: EngagementFlusher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const file = this.config.get('WORKER_HEARTBEAT_FILE', { infer: true });
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tick = () => {
      if (this.pending) return;
      this.pending = this.probe(file).catch(() => {
        this.logger.warn('Worker readiness probe failed');
      }).finally(() => { this.pending = undefined; });
    };
    tick();
    this.timer = setInterval(tick, 10000);
    this.timer.unref();
  }

  private async probe(file: string): Promise<void> {
    if (!this.media.isRunning() || !this.engagement.isRunning()) throw new Error('Consumer stopped');
    await Promise.all([this.database.query('SELECT 1'), this.redis.ping()]);
    // Freshness only advances after both dependencies and consumers are healthy.
    await fs.writeFile(file, String(Date.now()), { mode: 0o600 });
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.pending;
    await fs.writeFile(this.config.get('WORKER_HEARTBEAT_FILE', { infer: true }), '0');
  }
}
