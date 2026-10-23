const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { validateMonitoringHost } = require('./check-monitoring.cjs');

try {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  validateMonitoringHost(process.env.MONITORING_HOST_ADDRESS);
  if (![0, 1000].includes(process.getuid()))
    throw new Error(
      'Run token initialization as the application UID 1000 or root.',
    );
  const directory = path.resolve('.monitoring');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink())
    throw new Error('Refusing a symbolic-link monitoring directory.');
  const file = path.join(directory, 'metrics-token');
  const descriptor = fs.openSync(file, 'wx', 0o640);
  try {
    fs.writeFileSync(descriptor, randomBytes(32).toString('base64url') + '\n');
    if (process.getuid() === 0) fs.fchownSync(descriptor, 1000, 1000);
    fs.fchmodSync(descriptor, 0o640);
  } finally {
    fs.closeSync(descriptor);
  }
  console.log(
    'Created the private metrics token without displaying it. Set METRICS_TOKEN_HOST_FILE to the absolute .monitoring/metrics-token path in your deployment environment.',
  );
} catch {
  console.error(
    'Monitoring initialization did not complete. Check Linux/private bridge configuration, UID 1000 permissions, and whether the token already exists. Existing tokens are never overwritten.',
  );
  process.exitCode = 1;
}
