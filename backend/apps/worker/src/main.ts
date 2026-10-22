import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  // MySQL and Redis connections keep this isolated process alive.
  // Queue consumers will be added with the media pipeline; no HTTP listener.
  const worker = await NestFactory.createApplicationContext(WorkerModule);
  worker.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
