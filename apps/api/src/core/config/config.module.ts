import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from '@skillindiaconnect/shared-config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, unknown>) => validateEnv(config),
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
