import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { AppApiModule } from './app-api.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppApiModule);

  // Global prefix for all routes except /health (used by load balancers).
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  // URI versioning: /api/v1/...  (defaultVersion applies when no @Version() decorator is set)
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Validate and strip unknown fields from all incoming DTOs.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env['PORT'] ?? 3001;
  await app.listen(port);
  console.log(`SkillIndiaConnect API process started on :${port}`);
}

bootstrap().catch((err: unknown) => {
  console.error('API failed to start:', err);
  process.exit(1);
});
