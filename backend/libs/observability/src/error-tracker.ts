import { createHash } from 'node:crypto';
import type { LoggerService } from '@nestjs/common';

export type ServiceName = 'api' | 'worker';
export type ErrorCode =
  'HTTP_FAILURE' | 'BACKGROUND_FAILURE' | 'STARTUP_FAILURE' | 'PROCESS_FAILURE';
export interface ErrorEvent {
  service: ServiceName;
  operation: string;
  code: ErrorCode;
  severity: 'error' | 'warning';
  requestId?: string;
  at: Date;
  fingerprint: string;
}

const CONTEXTS = new Set([
  'MediaProcessor',
  'MediaRecovery',
  'EngagementFlusher',
  'WorkerHeartbeat',
  'SeoService',
  'ShowcasesService',
  'StoresService',
  'ProductsService',
  'FeedExploreService',
  'PostEngagementService',
  'RedisService',
  'QueueService',
  'NestFactory',
  'InstanceLoader',
  'RouterExplorer',
  'RoutesResolver',
  'NestApplication',
  'TypeOrmModule',
  'ExceptionHandler',
]);

export class ErrorTracker {
  private events: ErrorEvent[] = [];
  dropped = 0;
  private logWindow = 0;
  private logCount = 0;

  capture(
    service: ServiceName,
    operation: string,
    code: ErrorCode,
    severity: 'error' | 'warning' = 'error',
    requestId?: string,
  ): void {
    // Operations are static route templates or allowlisted component names, never error messages.
    const safeOperation =
      /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|OTHER) [a-zA-Z0-9_/:.*{}-]{1,160}$/.test(
        operation,
      ) || CONTEXTS.has(operation)
        ? operation
        : 'application';
    const safeId =
      requestId && /^[0-9a-f-]{36}$/.test(requestId) ? requestId : undefined;
    const safeCode = [
      'HTTP_FAILURE',
      'BACKGROUND_FAILURE',
      'STARTUP_FAILURE',
      'PROCESS_FAILURE',
    ].includes(code)
      ? code
      : 'BACKGROUND_FAILURE';
    const fingerprint = createHash('sha256')
      .update(`${service}:${safeOperation}:${safeCode}`)
      .digest('hex');
    const event: ErrorEvent = {
      service,
      operation: safeOperation,
      code: safeCode,
      severity,
      requestId: safeId,
      at: new Date(),
      fingerprint,
    };
    if (this.events.length < 1000) this.events.push(event);
    else this.dropped++;
    const window = Math.floor(Date.now() / 1000);
    if (window !== this.logWindow) {
      this.logWindow = window;
      this.logCount = 0;
    }
    if (++this.logCount <= 10)
      process.stderr.write(JSON.stringify(event) + '\n');
  }

  drain(limit = 100): ErrorEvent[] {
    return this.events.splice(0, Math.min(limit, 100));
  }
  get pending(): number {
    return this.events.length;
  }
}

export const errorTracker = new ErrorTracker();

export class SafeLogger implements LoggerService {
  constructor(private readonly service: ServiceName) {}
  log(_message: unknown, ..._args: unknown[]): void {}
  debug(_message: unknown, ..._args: unknown[]): void {}
  verbose(_message: unknown, ..._args: unknown[]): void {}
  warn(_message: unknown, ...args: unknown[]): void {
    this.record(args, 'warning');
  }
  error(_message: unknown, ...args: unknown[]): void {
    this.record(args, 'error');
  }
  fatal(_message: unknown, ...args: unknown[]): void {
    this.record(args, 'error');
  }
  private record(args: unknown[], severity: 'error' | 'warning'): void {
    const context = args.at(-1);
    errorTracker.capture(
      this.service,
      typeof context === 'string' && CONTEXTS.has(context)
        ? context
        : 'application',
      'BACKGROUND_FAILURE',
      severity,
    );
  }
}

export function installFatalReporting(service: ServiceName): void {
  const fail = () => {
    errorTracker.capture(service, 'application', 'PROCESS_FAILURE');
    // A fatal process must terminate; continuing could serve corrupted state.
    process.exit(1);
  };
  process.once('uncaughtException', fail);
  process.once('unhandledRejection', fail);
}

export const WORKER_METRICS_KEY = 'matjary:monitoring:worker';
export interface WorkerSnapshot {
  timestamp: number;
  rssBytes: number;
  cpuSeconds: number;
  uptimeSeconds: number;
}
export function processSnapshot(): WorkerSnapshot {
  const cpu = process.cpuUsage();
  return {
    timestamp: Date.now(),
    rssBytes: process.memoryUsage().rss,
    cpuSeconds: (cpu.user + cpu.system) / 1e6,
    uptimeSeconds: process.uptime(),
  };
}

export function parseWorkerSnapshot(
  value: string | null,
  now = Date.now(),
): WorkerSnapshot | null {
  if (!value || value.length > 1024) return null;
  try {
    const data = JSON.parse(value) as WorkerSnapshot;
    if (
      !data ||
      !['timestamp', 'rssBytes', 'cpuSeconds', 'uptimeSeconds'].every(
        (key) =>
          typeof data[key as keyof WorkerSnapshot] === 'number' &&
          Number.isFinite(data[key as keyof WorkerSnapshot]) &&
          data[key as keyof WorkerSnapshot] >= 0,
      ) ||
      data.timestamp > now + 1000 ||
      now - data.timestamp >= 30000
    )
      return null;
    return {
      timestamp: data.timestamp,
      rssBytes: data.rssBytes,
      cpuSeconds: data.cpuSeconds,
      uptimeSeconds: data.uptimeSeconds,
    };
  } catch {
    return null;
  }
}
