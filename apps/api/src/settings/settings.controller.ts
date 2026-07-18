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
 * Permissions (S6a-F1 — the S2-B1 placeholder is now PAID OFF).
 *
 *   GET   /admin/settings → Permission.SETTINGS_VIEW   (settings.view)
 *   PATCH /admin/settings → Permission.SETTINGS_MANAGE (settings.manage)
 *
 * S2-B1 shipped both gated on `logs.view` because no settings key existed in the
 * 20-key matrix, and left a written instruction to replace them "when Screen-27
 * perms land". They landed in S6a-B2, and the placeholder had quietly become a
 * real hole: a MODERATOR holds `logs.view`, so they could not only read but
 * WRITE platform settings — the auto-archive window, the mandatory-document list,
 * the completion threshold — purely because they were allowed to look at the
 * audit log. Two unrelated capabilities behind one key is exactly how that
 * happens, and it is why read and write now have separate keys.
 *
 * Seeded: SUPER_ADMIN both (locked on); ADMIN both; MODERATOR and SUPPORT
 * neither. Core rules (worker-protection toggles) stay SUPER_ADMIN-gated inside
 * SettingsService.set regardless — that check is independent and unchanged, so
 * even an ADMIN with settings.manage cannot flip a core rule.
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
  @RequirePermissions(Permission.SETTINGS_VIEW)
  async getAll(): Promise<{ data: Setting[] }> {
    const data = await this.settingsService.getAll();
    return { data };
  }

  @Patch()
  @RequirePermissions(Permission.SETTINGS_MANAGE)
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
