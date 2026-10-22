// Preload before importing Nest modules: unit tests never read application secrets
// or inherit connection targets. Integration tests intentionally do not use this.
for (const key of Object.keys(process.env)) {
  if (/^(MYSQL_|REDIS_|S3_|STORAGE_|MEDIA_|AUTH_|ENGAGEMENT_|API_|APP_|GOOGLE_|ADMIN_|TRUST_|WORKER_|FFMPEG_|FFPROBE_)/.test(key)) {
    delete process.env[key];
  }
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  MYSQL_HOST: '127.0.0.1',
  MYSQL_DATABASE: 'matjary_unit_test',
  MYSQL_PASSWORD: 'unit-test-only',
  REDIS_HOST: '127.0.0.1',
  REDIS_PASSWORD: 'unit-test-only',
  STORAGE_PROVIDER: 'local',
});
