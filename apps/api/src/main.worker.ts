import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import { AppWorkerModule } from './app-worker.module';
import { REDIS_CLIENT } from './core/redis/redis.provider';

async function bootstrap(): Promise<void> {
  // No HTTP listener — createApplicationContext boots Nest without Express.
  const app = await NestFactory.createApplicationContext(AppWorkerModule);

  // Retrieve the eagerly-connected Redis client. Its open connection keeps the
  // event loop alive so the worker process stays running without an HTTP server.
  const redisClient = app.get<Redis>(REDIS_CLIENT);

  console.log('SkillIndiaConnect Worker process started');

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
