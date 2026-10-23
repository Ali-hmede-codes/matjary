const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Parse the combined model without reading private .env files, contacting a
// daemon, creating secrets, or starting services. Values below are synthetic.
const root = path.resolve(__dirname, '..');
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|systemdrive|windir|comspec|pathext|home|userprofile|appdata|localappdata|programdata|programfiles|programfiles\(x86\)|allusersprofile|temp|tmp)$/i.test(
      key,
    ),
  ),
);
Object.assign(env, {
  MYSQL_PASSWORD: 'configuration-check-only',
  MYSQL_ROOT_PASSWORD: 'configuration-check-only',
  REDIS_PASSWORD: 'configuration-check-only',
  APP_ORIGIN: 'https://example.test',
  GOOGLE_CLIENT_ID: 'configuration-check.apps.googleusercontent.com',
  APP_ENV_FILE: path.join(root, '.env.example'),
  MONITORING_HOST_ADDRESS: '172.17.0.1',
  METRICS_TOKEN_HOST_FILE: path.join(root, '.env.example'),
});
const result = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env.example',
    '-f',
    'infra/compose.yaml',
    '-f',
    'infra/compose.production.yaml',
    '-f',
    'infra/compose.monitoring.yaml',
    '--profile',
    'app',
    'config',
    '--quiet',
    '--no-env-resolution',
  ],
  { cwd: root, env, encoding: 'utf8', timeout: 30000, windowsHide: true },
);
if (result.error || result.status !== 0) {
  console.error(
    'Monitoring Compose validation failed (no services were started).',
  );
  if (result.stderr) console.error(result.stderr);
  process.exitCode = 1;
} else
  console.log(
    'Combined monitoring Compose model is valid. Host installation and promtool validation are separate checks.',
  );
