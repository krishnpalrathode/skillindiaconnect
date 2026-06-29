import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  // SettingsService is the only public seam. Other modules (Jobs S2-B5, Completion S1-2)
  // inject SettingsService — they NEVER query the settings table directly.
  exports: [SettingsService],
})
export class SettingsModule {}
