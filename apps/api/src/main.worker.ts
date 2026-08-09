import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import { AppWorkerModule } from './app-worker.module';
import { REDIS_CLIENT } from './core/redis/redis.provider';
import { initErrorTracking } from './core/observability/error-tracking';
import {
  StructuredLogger,
  shouldUseStructuredLogging,
} from './core/observability/structured-logger';

async function bootstrap(): Promise<void> {
  // S8-H3: label this process's metrics so worker and API series are
  // distinguishable — the worker's RSS is the H1 OOM ceiling metric, and it is
  // useless if it cannot be told apart from the API's.
  process.env.SIC_PROCESS_ROLE = 'worker';

  initErrorTracking();

  // No HTTP listener — createApplicationContext boots Nest without Express.
  const app = await NestFactory.createApplicationContext(AppWorkerModule, {
    ...(shouldUseStructuredLogging() ? { logger: new StructuredLogger() } : {}),
  });

  // Retrieve the eagerly-connected Redis client. Its open connection keeps the
  // event loop alive so the worker process stays running without an HTTP server.
  const redisClient = app.get<Redis>(REDIS_CLIENT);

  console.log('Skill India Connect Worker process started');

  // Graceful shutdown: drain in-flight work before the process exits.
  // Required for zero-downtime rolling deploys on Railway.
  const shutdown = async (): Promise<void> => {
    await app.close();
    await redisClient.quit();
  };

  process.on('SIGTERM', () => {
    shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

bootstrap().catch((err: unknown) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
