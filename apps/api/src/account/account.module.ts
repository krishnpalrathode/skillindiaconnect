import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [AccountController],
  providers: [AccountService],
  // S6b-B1: the admin module drives suspend/reactivate/purge through this
  // service — the account module owns the users lifecycle columns.
  exports: [AccountService],
})
export class AccountModule {}
