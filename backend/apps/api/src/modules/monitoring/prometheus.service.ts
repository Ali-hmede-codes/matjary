import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';

export const METRIC_QUERIES = {
  cpu: {
    label: 'Host CPU',
    unit: '%',
    query:
      '100 * (1 - avg(rate(node_cpu_seconds_total{job="vps",mode="idle"}[5m])))',
  },
  memory: {
    label: 'Host RAM used',
    unit: '%',
    query:
      '100 * (1 - node_memory_MemAvailable_bytes{job="vps"} / node_memory_MemTotal_bytes{job="vps"})',
  },
  memoryTotal: {
    label: 'Host RAM capacity',
    unit: 'bytes',
    query: 'node_memory_MemTotal_bytes{job="vps"}',
  },
  swap: {
    label: 'Host swap used',
    unit: 'bytes',
    query:
      'node_memory_SwapTotal_bytes{job="vps"} - node_memory_SwapFree_bytes{job="vps"}',
  },
  disk: {
    label: 'Root disk used',
    unit: '%',
    query:
      '100 * (1 - node_filesystem_avail_bytes{job="vps",mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{job="vps",mountpoint="/",fstype!~"tmpfs|overlay"})',
  },
  diskFree: {
    label: 'Root disk available',
    unit: 'bytes',
    query:
      'node_filesystem_avail_bytes{job="vps",mountpoint="/",fstype!~"tmpfs|overlay"}',
  },
  diskTotal: {
    label: 'Root disk capacity',
    unit: 'bytes',
    query:
      'node_filesystem_size_bytes{job="vps",mountpoint="/",fstype!~"tmpfs|overlay"}',
  },
  inodes: {
    label: 'Root inodes used',
    unit: '%',
    query:
      '100 * (1 - node_filesystem_files_free{job="vps",mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_files{job="vps",mountpoint="/",fstype!~"tmpfs|overlay"})',
  },
  receive: {
    label: 'Network received',
    unit: 'bytes/s',
    query:
      'sum(rate(node_network_receive_bytes_total{job="vps",device!~"lo|veth.*|docker.*|br-.*"}[5m]))',
  },
  transmit: {
    label: 'Network sent',
    unit: 'bytes/s',
    query:
      'sum(rate(node_network_transmit_bytes_total{job="vps",device!~"lo|veth.*|docker.*|br-.*"}[5m]))',
  },
  load: {
    label: 'Host load (1 minute)',
    unit: 'load',
    query: 'node_load1{job="vps"}',
  },
  uptime: {
    label: 'Host uptime',
    unit: 'seconds',
    query: 'time() - node_boot_time_seconds{job="vps"}',
  },
  requests: {
    label: 'API requests',
    unit: 'requests/s',
    query: 'sum(rate(matjary_http_requests_total[5m]))',
  },
  latency: {
    label: 'API mean latency',
    unit: 'seconds',
    query:
      'sum(rate(matjary_http_duration_seconds_sum[5m])) / sum(rate(matjary_http_duration_seconds_count[5m]))',
  },
} as const;
export const WINDOWS = { '1h': 3600, '24h': 86400, '7d': 604800 } as const;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const result = (value: unknown): unknown[] => {
  const data = object(object(value).data);
  return Array.isArray(data.result) ? data.result : [];
};

export async function boundedPrometheusJson(
  response: Response,
): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Monitoring unavailable');
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 524288) throw new Error('Monitoring response limit exceeded');
      chunks.push(part.value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (object(parsed).status !== 'success')
      throw new Error('Monitoring unavailable');
    return parsed;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function sampleNumber(value: unknown): number | null {
  if (
    typeof value !== 'string' ||
    !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
  )
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

type AlertSnapshot = {
  status: string;
  items: Array<{ name: string; severity: string; state: string }>;
};

export interface MetricSeries {
  key: string;
  label: string;
  unit: string;
  points: Array<[number, number | null]>;
  current: number | null;
}
export interface VpsSnapshot {
  status: 'up' | 'down' | 'not_configured' | 'unavailable';
  timestamp: number;
  window: string;
  scope: string;
  metrics: MetricSeries[];
}

@Injectable()
export class PrometheusService {
  private readonly cached = new Map<
    string,
    { at: number; value: VpsSnapshot }
  >();
  private readonly pending = new Map<string, Promise<VpsSnapshot>>();
  private alertCache?: { at: number; value: AlertSnapshot };
  private alertPending?: Promise<AlertSnapshot>;
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  private async request(
    path: '/api/v1/query' | '/api/v1/query_range' | '/api/v1/alerts',
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const origin = this.config.get('PROMETHEUS_URL', { infer: true });
    if (!origin) throw new Error('Monitoring not configured');
    const url = new URL(path, origin);
    url.search = new URLSearchParams(params).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      redirect: 'error',
    });
    return boundedPrometheusJson(response);
  }

  async vps(window: string = '1h'): Promise<VpsSnapshot> {
    if (!Object.hasOwn(WINDOWS, window))
      throw new BadRequestException('Choose 1h, 24h, or 7d');
    const cached = this.cached.get(window);
    if (cached && Date.now() - cached.at < 15000) return cached.value;
    const pending = this.pending.get(window);
    if (pending) return pending;
    const task = this.collect(window as keyof typeof WINDOWS)
      .then((value) => {
        this.cached.set(window, { at: Date.now(), value });
        return value;
      })
      .finally(() => this.pending.delete(window));
    this.pending.set(window, task);
    return task;
  }

  private async collect(window: keyof typeof WINDOWS): Promise<VpsSnapshot> {
    const base = {
      timestamp: Date.now(),
      window,
      scope: 'Linux VPS host (node_exporter)',
      metrics: [] as MetricSeries[],
    };
    if (!this.config.get('PROMETHEUS_URL', { infer: true }))
      return { ...base, status: 'not_configured' };
    try {
      const target = result(
        await this.request('/api/v1/query', { query: 'up{job="vps"}' }),
      )[0];
      const value = object(target).value;
      const up =
        Array.isArray(value) &&
        sampleNumber(value[1]) === 1 &&
        typeof value[0] === 'number' &&
        value[0] <= Date.now() / 1000 + 1 &&
        Date.now() / 1000 - value[0] < 60;
      const end = Math.floor(Date.now() / 1000);
      const start = end - WINDOWS[window];
      const step = Math.ceil(WINDOWS[window] / 240);
      const entries = Object.entries(METRIC_QUERIES);
      const metrics: MetricSeries[] = [];
      for (let offset = 0; offset < entries.length; offset += 4) {
        metrics.push(
          ...(await Promise.all(
            entries.slice(offset, offset + 4).map(async ([key, definition]) => {
              const points: Array<[number, number | null]> = [];
              try {
                const series = result(
                  await this.request('/api/v1/query_range', {
                    query: definition.query,
                    start: String(start),
                    end: String(end),
                    step: String(step),
                  }),
                )[0];
                const values = object(series).values;
                if (Array.isArray(values))
                  for (const point of values.slice(0, 241)) {
                    if (
                      !Array.isArray(point) ||
                      typeof point[0] !== 'number' ||
                      !Number.isFinite(point[0]) ||
                      point[0] < start ||
                      point[0] > end
                    )
                      continue;
                    points.push([point[0], sampleNumber(point[1])]);
                  }
              } catch {
                /* A missing series is unavailable, not zero. */
              }
              return {
                key,
                label: definition.label,
                unit: definition.unit,
                points,
                current:
                  up && end - (points.at(-1)?.[0] ?? 0) <= 60
                    ? (points.at(-1)?.[1] ?? null)
                    : null,
              };
            }),
          )),
        );
      }
      return { ...base, status: up ? 'up' : 'down', metrics };
    } catch {
      return { ...base, status: 'unavailable' };
    }
  }

  async alerts(): Promise<AlertSnapshot> {
    if (this.alertCache && Date.now() - this.alertCache.at < 15000)
      return this.alertCache.value;
    if (!this.alertPending)
      this.alertPending = this.collectAlerts()
        .then((value) => {
          this.alertCache = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          this.alertPending = undefined;
        });
    return this.alertPending;
  }

  private async collectAlerts(): Promise<AlertSnapshot> {
    if (!this.config.get('PROMETHEUS_URL', { infer: true }))
      return { status: 'not_configured', items: [] };
    try {
      const data = object(object(await this.request('/api/v1/alerts')).data);
      const alerts = Array.isArray(data.alerts)
        ? data.alerts.slice(0, 100)
        : [];
      const names = new Set([
        'VpsUnavailable',
        'VpsHighCpu',
        'VpsHighMemory',
        'VpsDiskLow',
        'VpsInodesLow',
        'ApiUnavailable',
        'ApiErrorRate',
        'WorkerUnavailable',
        'MysqlUnavailable',
        'RedisUnavailable',
        'MediaBacklog',
        'MediaCleanupBacklog',
      ]);
      return {
        status: 'up',
        items: alerts
          .map(object)
          .filter((alert) => names.has(String(object(alert.labels).alertname)))
          .map((alert) => ({
            name: String(object(alert.labels).alertname),
            severity:
              object(alert.labels).severity === 'critical'
                ? 'critical'
                : 'warning',
            state: alert.state === 'firing' ? 'firing' : 'pending',
          })),
      };
    } catch {
      return { status: 'unavailable', items: [] };
    }
  }
}
