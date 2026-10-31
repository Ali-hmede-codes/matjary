import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { RenewalNoticesService } from './renewal-notices.service';

// How long before midnight the sweep runs. A second of slack means the timer
// never fires just before the boundary it is meant to cross.
const MIDNIGHT_SLACK_MS = 1_000;

/**
 * Milliseconds until the next 00:00 in the configured zone. Intl gives the
 * zone's wall clock; treating it as UTC makes the offset fall out, so the
 * result does not depend on the server's TZ (containers usually run UTC while
 * the business day is Beirut). DST shifts between now and midnight are covered
 * by the catch-up sweep on read.
 */
export function nextMidnightDelay(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((value) => value.type === type)?.value);
  const year = part('year');
  const month = part('month');
  const day = part('day');
  // Some ICU versions report midnight as hour 24; both mean the same instant.
  const hour = part('hour') % 24;
  const minute = part('minute');
  const second = part('second');
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = wallAsUtc - now.getTime();
  const nextMidnightAsUtc = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
  return Math.max(
    MIDNIGHT_SLACK_MS,
    nextMidnightAsUtc - offset - now.getTime(),
  );
}

@Injectable()
export class RenewalScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RenewalScheduler.name);
  private timer?: NodeJS.Timeout;
  private bootTimer?: NodeJS.Timeout;

  constructor(
    private readonly notifications: RenewalNoticesService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  onModuleInit(): void {
    // Unit tests never start the application context, but this guard keeps a
    // future integration harness from scheduling writes at 00:00.
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.scheduleNext();
    // A deploy or restart can cross midnight. The read path catches this too;
    // this short boot sweep simply makes the owner's first visit consistent.
    this.bootTimer = setTimeout(() => {
      this.bootTimer = undefined;
      void this.notifications.generate();
    }, 10_000);
    this.bootTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  private scheduleNext(): void {
    let delay = 86_400_000;
    try {
      delay = nextMidnightDelay(
        new Date(),
        this.config.get('NOTIFICATION_TIME_ZONE', { infer: true }),
      );
    } catch {
      this.logger.warn('Renewal reminder schedule fell back to 24 hours');
    }
    this.timer = setTimeout(() => {
      void this.notifications.generate().finally(() => this.scheduleNext());
    }, delay);
    this.timer.unref();
  }
}
