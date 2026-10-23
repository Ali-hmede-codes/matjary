import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import {
  SafeLogger,
  errorTracker,
  installFatalReporting,
} from '@app/observability';

async function bootstrap(): Promise<void> {
  // MySQL and Redis connections keep this isolated process alive.
  // Queue consumers will be added with the media pipeline; no HTTP listener.
  const worker = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new SafeLogger('worker'),
    abortOnError: false,
  });
  worker.enableShutdownHooks();
}

installFatalReporting('worker');
bootstrap().catch(() => {
  errorTracker.capture('worker', 'application', 'STARTUP_FAILURE');
  process.exit(1);
});
