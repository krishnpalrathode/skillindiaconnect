import { type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (configService: ConfigService): Redis => {
    const url = configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const client = new Redis(url, {
      // Retry strategy keeps the connection alive for the worker process.
      // Exponential backoff capped at 30 s.
      retryStrategy: (times: number) => Math.min(times * 100, 30_000),
      lazyConnect: false,
      enableOfflineQueue: true,
    });
    client.on('error', (err: Error) => {
      // Log but do not crash — health controller reports redis: 'down' instead.
      console.error('[Redis] connection error:', err.message);
    });
    return client;
  },
  inject: [ConfigService],
};
