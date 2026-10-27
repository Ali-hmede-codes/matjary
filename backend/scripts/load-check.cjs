#!/usr/bin/env node
'use strict';

/**
 * Read-only load check for the public feed and its media.
 *
 * Sends GET requests only: no sign-in, no uploads, no writes. Point it at a
 * staging instance (or your own machine while the stack is running) and use the
 * latency percentiles to decide where capacity stops, instead of guessing.
 *
 *   node scripts/load-check.cjs --url http://127.0.0.1:3000
 *   node scripts/load-check.cjs --url https://staging.example.com --requests 3000 --concurrency 100
 *   node scripts/load-check.cjs --url https://staging.example.com --include-media
 *
 * Non-loopback origins require --allow-remote so a production site is never
 * hit by accident.
 */

const { performance } = require('node:perf_hooks');

const options = {
  url: '',
  requests: 1000,
  concurrency: 50,
  timeout: 20000,
  includeMedia: false,
  allowRemote: false,
};

for (const argument of process.argv.slice(2)) {
  const [key, value] = argument.split('=');
  if (key === '--url') options.url = value ?? '';
  else if (key === '--requests') options.requests = Number(value);
  else if (key === '--concurrency') options.concurrency = Number(value);
  else if (key === '--timeout') options.timeout = Number(value);
  else if (argument === '--include-media') options.includeMedia = true;
  else if (argument === '--allow-remote') options.allowRemote = true;
  else {
    console.error(`Unknown option: ${argument}`);
    process.exit(2);
  }
}

const fail = (message) => {
  console.error(message);
  process.exit(2);
};

if (!options.url) fail('Pass --url=https://your-site.example');
if (!Number.isInteger(options.requests) || options.requests < 1)
  fail('--requests must be a positive integer');
if (!Number.isInteger(options.concurrency) || options.concurrency < 1)
  fail('--concurrency must be a positive integer');

const base = new URL(options.url);
if (!['http:', 'https:'].includes(base.protocol))
  fail('--url must start with http:// or https://');
if (
  !options.allowRemote &&
  !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
)
  fail('Refusing to load a remote site without --allow-remote');

const absolute = (value) => {
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
};

function percentiles(durations) {
  const sorted = [...durations].sort((a, b) => a - b);
  const at = (ratio) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1)];
  return {
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
  };
}

async function runPhase(name, urls, count, concurrency) {
  const durations = [];
  let completed = 0;
  let failures = 0;
  const started = performance.now();
  const worker = async () => {
    while (true) {
      const index = completed++;
      if (index >= count) return;
      const url = urls[index % urls.length];
      const begin = performance.now();
      try {
        const response = await fetch(url, {
          headers: { Accept: '*/*' },
          signal: AbortSignal.timeout(options.timeout),
        });
        // Consume the body so the connection can be reused.
        await response.arrayBuffer();
        if (!response.ok) failures++;
      } catch {
        failures++;
      } finally {
        durations.push(performance.now() - begin);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, count) }, () => worker()),
  );
  const elapsed = (performance.now() - started) / 1000;
  const result = percentiles(durations);
  console.log(
    `${name}: ${count} requests, ${concurrency} concurrent\n` +
      `  ${failures === 0 ? 'ok' : `${failures} failed`}, ` +
      `${(count / elapsed).toFixed(0)} req/s, ` +
      `p50 ${result.p50.toFixed(0)}ms, p95 ${result.p95.toFixed(0)}ms, ` +
      `p99 ${result.p99.toFixed(0)}ms, max ${result.max.toFixed(0)}ms`,
  );
  return { failures, ...result };
}

(async () => {
  console.log(`Target: ${base.origin}`);
  const feedUrls = [
    absolute('/api/v1/feed/explore?limit=12&algorithm=mixed'),
    absolute('/api/v1/feed/explore?limit=12&algorithm=recent'),
  ].filter(Boolean);
  const feed = await runPhase(
    'Feed',
    feedUrls,
    options.requests,
    options.concurrency,
  );

  if (options.includeMedia) {
    const sample = await fetch(feedUrls[0], {
      signal: AbortSignal.timeout(options.timeout),
    });
    const body = await sample.json().catch(() => ({ items: [] }));
    const media = [];
    for (const item of body.items ?? []) {
      for (const asset of item.media ?? []) {
        // A card loads one image variant or the video poster, not every size.
        const url = asset.kind === 'video' ? asset.posterUrl : asset.primaryUrl;
        const resolved = url ? absolute(url) : null;
        if (resolved) media.push(resolved);
      }
    }
    if (media.length === 0)
      console.log('Media: no published media in the sample page, skipped');
    else await runPhase('Media', media, options.requests, options.concurrency);
  }

  if (feed.failures > 0) process.exitCode = 1;
})();
