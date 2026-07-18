import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppApiModule } from './app-api.module';
import { validationProblemFactory } from './core/http-problem.filter';
import { applyScopedBodyParsers } from './payments/webhooks/raw-body.middleware';

async function bootstrap(): Promise<void> {
  // bodyParser: false — body parsing is re-wired by applyScopedBodyParsers so
  // the two webhook routes receive the UNTOUCHED raw byte buffer (signature
  // verification runs on those exact bytes) while every other route keeps
  // normal JSON parsing. See raw-body.middleware.ts for the mechanism.
  const app = await NestFactory.create(AppApiModule, { bodyParser: false });
  applyScopedBodyParsers(app);

  // Parse cookies — required for the httpOnly refresh-token cookie.
  app.use(cookieParser());

  /**
   * SEC-005 (S8-H2) — security response headers.
   *
   * The API shipped with NONE of these and additionally advertised
   * `X-Powered-By: Express`. This is a JSON API, so the browser-facing risk is
   * narrower than for an HTML app, but two of these matter directly:
   *
   *  - `X-Content-Type-Options: nosniff` stops a browser from MIME-sniffing a
   *    JSON response containing attacker-supplied text (a cover letter, a
   *    company description) into HTML and executing it.
   *  - HSTS keeps the refresh cookie off plaintext HTTP.
   *
   * `contentSecurityPolicy` is disabled: helmet's default CSP is written for
   * HTML documents and would do nothing for JSON responses except add bytes to
   * every payload. The web app sets its own CSP; that is where it belongs.
   *
   * `crossOriginResourcePolicy` is disabled because it would contradict the
   * deliberately-scoped CORS configured just below — CORS is the control here.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );
  // Do not advertise the framework (helmet hides it, but Nest sets it again on
  // some paths — disabling it at the adapter is the reliable removal).
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  const configService = app.get(ConfigService);

  // CORS: allow the frontend origin with credentials (needed for the refresh cookie).
  app.enableCors({
    origin: configService.get<string>('WEB_APP_URL'),
    credentials: true,
  });

  // Global prefix for all routes except /health (used by load balancers).
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  // URI versioning: /api/v1/...
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Validate and strip unknown fields from all incoming DTOs. The factory
  // shapes validation failures per the contract (`code: VALIDATION_ERROR` +
  // `meta.errors[]` per-field codes); HttpProblemFilter adds the envelope.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: validationProblemFactory,
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
