import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { SubscriptionReadService } from './subscription-read.service';

/**
 * Standalone provider module for SubscriptionReadService — the single plan-truth
 * source (S5-B3). Kept OUT of PaymentsModule deliberately: PaymentsModule imports
 * EmployerModule, and both JobsModule (publish quota) and EmployerModule (document
 * gate) need this service — routing it through PaymentsModule would force
 * forwardRef cycles on every consumer. This module depends only on Settings
 * (Prisma is @Global), so it slots in anywhere, including the worker root.
 */
@Module({
  imports: [SettingsModule],
  providers: [SubscriptionReadService],
  exports: [SubscriptionReadService],
})
export class SubscriptionReadModule {}
