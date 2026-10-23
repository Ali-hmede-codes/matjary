import type { Request, Response } from 'express';
import { errorTracker, processSnapshot } from './error-tracker';

export function routeTemplate(request: Request): string {
  const path: unknown = request.route?.path;
  return typeof path === 'string' && /^[a-zA-Z0-9_/:.*{}-]{1,160}$/.test(path)
    ? path
    : 'unmatched';
}
export function requestMethod(request: Request): string {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(
    request.method,
  )
    ? request.method
    : 'OTHER';
}

export class HttpMetrics {
  private readonly counters = new Map<
    string,
    { requests: number; seconds: number }
  >();
  record(method: string, route: string, status: number, seconds: number): void {
    const key = `method="${method}",route="${route}",status="${Math.floor(status / 100)}xx"`;
    const current = this.counters.get(key);
    if (!current && this.counters.size >= 256) return;
    const value = current ?? { requests: 0, seconds: 0 };
    value.requests++;
    value.seconds += Math.max(0, seconds);
    this.counters.set(key, value);
  }

  observe(request: Request, response: Response): void {
    const started = process.hrtime.bigint();
    response.once('finish', () => {
      if (request.path === '/api/v1/internal/metrics') return;
      this.record(
        requestMethod(request),
        routeTemplate(request),
        response.statusCode,
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    });
  }

  render(): string {
    const current = processSnapshot();
    const lines = [
      '# TYPE matjary_http_requests_total counter',
      '# TYPE matjary_http_duration_seconds_sum counter',
      '# TYPE matjary_http_duration_seconds_count counter',
      '# TYPE matjary_api_cpu_seconds_total counter',
      `matjary_api_cpu_seconds_total ${current.cpuSeconds}`,
      '# TYPE matjary_api_rss_bytes gauge',
      `matjary_api_rss_bytes ${current.rssBytes}`,
      '# TYPE matjary_api_uptime_seconds gauge',
      `matjary_api_uptime_seconds ${current.uptimeSeconds}`,
      '# TYPE matjary_errors_dropped_total counter',
      `matjary_errors_dropped_total ${errorTracker.dropped}`,
    ];
    for (const [labels, value] of this.counters) {
      lines.push(
        `matjary_http_requests_total{${labels}} ${value.requests}`,
        `matjary_http_duration_seconds_sum{${labels}} ${value.seconds}`,
        `matjary_http_duration_seconds_count{${labels}} ${value.requests}`,
      );
    }
    return lines.join('\n') + '\n';
  }
}
export const httpMetrics = new HttpMetrics();
