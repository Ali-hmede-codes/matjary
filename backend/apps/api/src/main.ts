import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '@app/config';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';
import {
  SafeLogger,
  errorTracker,
  installFatalReporting,
} from '@app/observability';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: new SafeLogger('api'),
    abortOnError: false,
  });
  const config = app.get(ConfigService<AppEnvironment, true>);
  setupApp(app, config.get('NODE_ENV', { infer: true }) === 'production');
  const proxies = config.get('TRUST_PROXY_CIDRS', { infer: true });
  if (proxies)
    app.set(
      'trust proxy',
      proxies.split(',').map((cidr) => cidr.trim()),
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

installFatalReporting('api');
bootstrap().catch(() => {
  errorTracker.capture('api', 'application', 'STARTUP_FAILURE');
  process.exit(1);
});
