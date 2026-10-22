import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import express from 'express';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

// Local-storage uploads (STORAGE_PROVIDER=local) arrive as raw binary bodies.
// express.raw() on the uploads route lets the API receive them without the
// 16 KB JSON body limit corrupting media bytes.
const RAW_UPLOAD_LIMIT_BYTES = 200 * 1024 * 1024;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<AppEnvironment, true>);
  setupApp(app, config.get('NODE_ENV', { infer: true }) === 'production');
  app.use(
    '/api/v1/uploads/',
    express.raw({ type: '*/*', limit: String(RAW_UPLOAD_LIMIT_BYTES) }),
  );
  app.enableShutdownHooks();

  try {
    await app.listen(
      config.get('API_PORT', { infer: true }),
      config.get('API_HOST', { infer: true }),
    );
  } catch (error) {
    await app.close();
    throw error;
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
