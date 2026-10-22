const { randomBytes } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const template = readFileSync(resolve(root, '.env.example'), 'utf8');
const content = template.replace(
  /^(MYSQL_PASSWORD|MYSQL_ROOT_PASSWORD|REDIS_PASSWORD)=$/gm,
  (_, key) => `${key}=${randomBytes(32).toString('hex')}`,
);

try {
  writeFileSync(resolve(root, '.env'), content, { flag: 'wx', mode: 0o600 });
  console.log(
    'Created backend/.env with unique local passwords. Keep it private.',
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('backend/.env already exists; nothing was changed.');
}
