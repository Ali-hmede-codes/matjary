import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

// The grace window is days long, so a ten-minute sweep is precise enough while
// keeping the candidate query cheap. Writes are already refused the moment the
// plan ends, so only public hiding waits for this timer.
const SWEEP_INTERVAL_MS = 10 * 60_000;
const BOOT_DELAY_MS = 10_000;

@Injectable()
export class SubscriptionLifecycleScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SubscriptionLifecycleScheduler.name);
  private timer?: NodeJS.Timeout;
  private bootTimer?: NodeJS.Timeout;

  constructor(
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  onModuleInit(): void {
    // Unit tests never start the application context, but the guard keeps a
    // future integration harness from writing lock rows in the background.
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => {
      void this.lifecycle
        .lockExpiredShops()
        .catch(() => this.logger.warn('Lock sweep will retry'));
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
    // A deploy or restart can cross the window; this short boot sweep makes the
    // first page load after a deploy consistent.
    this.bootTimer = setTimeout(() => {
      this.bootTimer = undefined;
      void this.lifecycle
        .lockExpiredShops()
        .catch(() => this.logger.warn('Lock sweep will retry'));
    }, BOOT_DELAY_MS);
    this.bootTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }
}
