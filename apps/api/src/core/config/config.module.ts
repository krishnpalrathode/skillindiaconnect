import * as path from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from '@skillindiaconnect/shared-config';

// Compiled location: apps/api/dist/core/config/config.module.js
// Five levels up reaches the monorepo root where .env lives.
// On Railway, the file won't exist — NestJS silently skips it and
// validateEnv() reads the vars Railway already injected into process.env.
const ROOT_ENV_PATH = path.resolve(__dirname, '../../../../../.env');

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ROOT_ENV_PATH,
      validate: (config: Record<string, unknown>) => validateEnv(config),
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
