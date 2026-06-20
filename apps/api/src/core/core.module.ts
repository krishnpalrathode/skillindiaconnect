import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { RedisModule } from './redis/redis.module';
import { PrismaModule } from './prisma/prisma.module';

@Global()
@Module({
  imports: [AppConfigModule, RedisModule, PrismaModule],
  exports: [AppConfigModule, RedisModule, PrismaModule],
})
export class CoreModule {}
