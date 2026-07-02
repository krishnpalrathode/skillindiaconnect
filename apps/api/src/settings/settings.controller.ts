import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Setting } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AnyKeyDef, isValidValue, SETTING_KEYS, SettingType } from './settings.keys';
import { SettingsService } from './settings.service';

// O(1) lookup from string key → typed keyDef.
const KEY_DEF_MAP: Map<string, AnyKeyDef> = new Map(
  Object.values(SETTING_KEYS).map((def) => [def.key, def]),
);

/**
 * Permission choices (noted per S2-B1 spec — no dedicated settings.read/settings.write
 * exists in the current 20-key permission matrix; seed pins exactly 20 keys):
 *
 *   GET  /admin/settings → Permission.LOGS_VIEW  (logs.view)
 *        Enabled for ADMIN, MODERATOR, SUPER_ADMIN. Not SUPPORT.
 *
 *   PATCH /admin/settings → Permission.LOGS_VIEW  (logs.view)
 *        Same set. SettingsService.set enforces the SUPER_ADMIN gate for core rules.
 *        Replace both with settings.read / settings.write when Screen-27 perms land.
 *
 * Batch atomicity: validate-all-first. Every entry is checked (type + core-rule gate)
 * before any write is applied. A single failure rejects the whole batch with no side effects.
 *
 * Response: flat Setting[] ordered by key. Frontend groups by key prefix
 * (worker_protection.* / jobs.* / candidates.*) for tabbed display.
 */
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @RequirePermissions(Permission.LOGS_VIEW)
  async getAll(): Promise<{ data: Setting[] }> {
    const data = await this.settingsService.getAll();
    return { data };
  }

  @Patch()
  @RequirePermissions(Permission.LOGS_VIEW)
  async batchUpdate(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() actor: CurrentUserPayload,
  ): Promise<{ data: Setting[] }> {
    // ── PHASE 1: validate-all-first ──────────────────────────────────────────
    // Resolve every entry and check type + core-rule gate before any DB writes.
    // If any check fails the whole batch is rejected atomically.
    const resolved: Array<{ keyDef: AnyKeyDef; value: unknown }> = [];

    for (const item of dto.updates) {
      const keyDef = KEY_DEF_MAP.get(item.key);
      if (!keyDef) {
        throw new UnprocessableEntityException({
          code: 'SETTING_KEY_UNKNOWN',
          detail: `Unknown setting key: "${item.key}"`,
        });
      }

      if (!isValidValue(keyDef.type as SettingType, item.value)) {
        throw new UnprocessableEntityException({
          code: 'SETTING_INVALID_VALUE',
          detail: `Value for "${item.key}" must be of type ${keyDef.type}`,
        });
      }

      if (keyDef.core && actor.role !== 'SUPER_ADMIN') {
        throw new ForbiddenException({ code: 'CORE_RULE_FORBIDDEN' });
      }

      resolved.push({ keyDef, value: item.value });
    }

    // ── PHASE 2: apply writes ────────────────────────────────────────────────
    const results: Setting[] = [];
    for (const { keyDef, value } of resolved) {
      // value is pre-validated in PHASE 1; cast is safe
      const updated = await this.settingsService.set(keyDef, value as never, actor);
      results.push(updated);
    }

    return { data: results };
  }
}
