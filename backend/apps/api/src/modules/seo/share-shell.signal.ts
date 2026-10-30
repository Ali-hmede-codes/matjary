import { Injectable } from '@nestjs/common';

/**
 * Lets services that change public content (SEO rows, website branding) ask
 * the prerenderer to run now instead of waiting for its next pass. A refresh
 * is coalesced: a burst of saves rewrites the shells once.
 *
 * The refresher registers itself on boot. Until then, and in tests, requests
 * are simply dropped.
 */
@Injectable()
export class ShareShellSignal {
  private refresh?: () => Promise<number>;
  private timer?: NodeJS.Timeout;

  register(refresh: () => Promise<number>): void {
    this.refresh = refresh;
  }

  /** Ask for a refresh soon; later calls keep postponing the single run. */
  request(delayMs = 3_000): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh?.().catch(() => undefined);
    }, delayMs);
    // A pending request must never keep the process alive during shutdown.
    this.timer.unref();
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
