import {
  Inject,
  Optional,
  Injectable,
  Module,
  type DynamicModule,
  type OnModuleInit,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { ConfigurationModule, type AppEnvironment } from '@app/config';
import { errorTracker, type ErrorEvent } from './error-tracker';

@Injectable()
export class ErrorPersistence
  implements OnModuleInit, BeforeApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private pending?: Promise<void>;
  private lastPrune = 0;
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService<AppEnvironment, true>,
    @Optional() @Inject('ERROR_PRUNING') private readonly pruning = false,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (!this.pending)
        this.pending = this.flush().finally(() => {
          this.pending = undefined;
        });
    }, 5000);
    this.timer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.pending ?? this.flush(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async flush(): Promise<void> {
    if (
      !errorTracker.pending &&
      (!this.pruning || Date.now() - this.lastPrune < 60000)
    )
      return;
    let runner: QueryRunner | undefined;
    let locked = false;
    let uncommitted = 0;
    try {
      runner = this.database.createQueryRunner();
      await runner.connect();
      const lock = (await runner.query(
        "SELECT GET_LOCK('matjary:error-groups', 0) AS acquired",
      )) as Array<{ acquired: number }>;
      locked = lock[0]?.acquired === 1;
      if (!locked) return;
      if (this.pruning && Date.now() - this.lastPrune >= 60000) {
        const cutoff = new Date(
          Date.now() -
            this.config.get('ERROR_RETENTION_DAYS', { infer: true }) * 86400000,
        );
        await runner.query(
          'DELETE FROM system_errors WHERE last_seen_at < ? ORDER BY last_seen_at LIMIT 100',
          [cutoff],
        );
        this.lastPrune = Date.now();
      }
      const count = (await runner.query(
        'SELECT COUNT(*) AS total FROM system_errors',
      )) as Array<{ total: string | number }>;
      let total = Number(count[0]?.total ?? 10000);
      if (!Number.isSafeInteger(total) || total < 0) total = 10000;
      const groups = new Map<string, ErrorEvent[]>();
      const batch = errorTracker.drain();
      uncommitted = batch.length;
      for (const event of batch) {
        const group = groups.get(event.fingerprint) ?? [];
        group.push(event);
        groups.set(event.fingerprint, group);
      }
      for (const [fingerprint, events] of groups) {
        const first = events[0];
        const last = events.at(-1);
        if (!first || !last) continue;
        const existing = (await runner.query(
          'SELECT id FROM system_errors WHERE fingerprint = ? LIMIT 1',
          [fingerprint],
        )) as Array<{ id: string }>;
        if (!existing.length && total >= 10000) {
          errorTracker.dropped += events.length;
          uncommitted -= events.length;
          continue;
        }
        const ids = [
          ...new Set(events.map((event) => event.requestId).filter(Boolean)),
        ].slice(-5);
        await runner.query(
          `INSERT INTO system_errors
          (id, fingerprint, service, operation, code, severity, state, occurrences, request_ids, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE occurrences = occurrences + VALUES(occurrences),
          last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at)), request_ids = VALUES(request_ids),
          severity = VALUES(severity), state = IF(state = 'resolved', 'open', state)`,
          [
            randomUUID(),
            fingerprint,
            first.service,
            first.operation.slice(0, 100),
            first.code,
            last.severity,
            events.length,
            JSON.stringify(ids),
            first.at,
            last.at,
          ],
        );
        if (!existing.length) total++;
        uncommitted -= events.length;
      }
    } catch {
      errorTracker.dropped += uncommitted;
      // Do not send persistence failures through the tracker itself.
      process.stderr.write('{"code":"ERROR_STORAGE_UNAVAILABLE"}\n');
    } finally {
      if (locked && runner)
        await runner
          .query("SELECT RELEASE_LOCK('matjary:error-groups')")
          .catch(() => undefined);
      await runner?.release().catch(() => undefined);
    }
  }
}

@Module({ imports: [ConfigurationModule], providers: [ErrorPersistence] })
export class ObservabilityModule {
  static forWorker(): DynamicModule {
    return {
      module: ObservabilityModule,
      providers: [{ provide: 'ERROR_PRUNING', useValue: true }],
    };
  }
}
