import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from './queue.constants';

/**
 * Producer-only queue registration. Processors (consumers) are added by each
 * worker unit when it is built — this module registers the queues so the API
 * can call queue.add() without running any BullMQ workers.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.ACCOUNT_PURGE },
      { name: QUEUE_NAMES.R2_DELETE },
      { name: QUEUE_NAMES.NOTIFICATION },
      { name: QUEUE_NAMES.AUTO_ARCHIVE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
