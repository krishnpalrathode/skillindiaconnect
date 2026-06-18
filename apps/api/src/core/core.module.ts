import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { RedisModule } from './redis/redis.module';

@Global()
@Module({
  imports: [AppConfigModule, RedisModule],
  exports: [AppConfigModule, RedisModule],
})
export class CoreModule {}
