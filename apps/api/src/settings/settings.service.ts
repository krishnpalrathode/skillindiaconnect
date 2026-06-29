import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Setting, UserRole } from '@prisma/client';
import { Redis } from 'ioredis';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { AnyKeyDef, isValidValue, SettingType, TypedValue } from './settings.keys';

// TTL is a backstop only. The primary freshness mechanism is explicit DEL on write.
// A stale worker-protection rule after a change would allow a non-compliant job to publish.
export const SETTINGS_CACHE_TTL_SECONDS = 300;

export interface SettingsChangedPayload {
  key: string;
}

function cacheKey(key: string): string {
  return `settings:${key}`;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async get<D extends AnyKeyDef>(keyDef: D): Promise<TypedValue<D>> {
    const raw = await this.redis.get(cacheKey(keyDef.key));
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (!isValidValue(keyDef.type as SettingType, parsed)) {
        throw new InternalServerErrorException({
          code: 'SETTING_TYPE_MISMATCH',
          detail: `Setting "${keyDef.key}" cached value has wrong type (expected ${keyDef.type})`,
        });
      }
      return parsed as TypedValue<D>;
    }

    const row = await this.prisma.setting.findUniqueOrThrow({
      where: { key: keyDef.key },
    });

    const parsed: unknown = row.value;
    if (!isValidValue(keyDef.type as SettingType, parsed)) {
      // A corrupt setting is a bug — throw rather than silently falling back to a default.
      // A silent default on a protection rule is dangerous.
      throw new InternalServerErrorException({
        code: 'SETTING_TYPE_MISMATCH',
        detail: `Setting "${keyDef.key}" DB value has wrong type (expected ${keyDef.type})`,
      });
    }

    await this.redis.setex(cacheKey(keyDef.key), SETTINGS_CACHE_TTL_SECONDS, JSON.stringify(parsed));
    return parsed as TypedValue<D>;
  }

  async getMany(keyDefs: AnyKeyDef[]): Promise<Setting[]> {
    const keys = keyDefs.map((d) => d.key);
    return this.prisma.setting.findMany({ where: { key: { in: keys } } });
  }

  async getAll(): Promise<Setting[]> {
    return this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
  }

  async set<D extends AnyKeyDef>(
    keyDef: D,
    value: TypedValue<D>,
    actor: Pick<CurrentUserPayload, 'userId' | 'role'>,
  ): Promise<Setting> {
    // Layer 1: core-rule Super-Admin gate (controller's @RequirePermissions is layer 0).
    // A regular ADMIN with settings-write cannot flip a core rule.
    if (keyDef.core && actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException({ code: 'CORE_RULE_FORBIDDEN' });
    }

    // Layer 2: type validation
    if (!isValidValue(keyDef.type as SettingType, value)) {
      throw new UnprocessableEntityException({
        code: 'SETTING_INVALID_VALUE',
        detail: `Value for "${keyDef.key}" must be of type ${keyDef.type}`,
      });
    }

    // Persist: bump version, record actor
    const updated = await this.prisma.setting.update({
      where: { key: keyDef.key },
      data: {
        value: value as never,
        version: { increment: 1 },
        updatedById: actor.userId,
      },
    });

    // Cache invalidation — SAFETY-CRITICAL.
    // DEL happens synchronously before we return so no window exists where a
    // concurrent reader could get a stale protection-rule value.
    await this.redis.del(cacheKey(keyDef.key));

    this.eventEmitter.emit('settings.changed', { key: keyDef.key } satisfies SettingsChangedPayload);

    return updated;
  }
}
