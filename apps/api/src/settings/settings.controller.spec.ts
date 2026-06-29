import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Setting, UserRole } from '@prisma/client';
import { SettingsController } from './settings.controller';
import { SETTING_KEYS } from './settings.keys';
import { SettingsService } from './settings.service';

const SUPER_ADMIN_USER = { userId: 'super-1', role: UserRole.SUPER_ADMIN, jti: 'j1', exp: 9_999_999_999 };
const ADMIN_USER = { userId: 'admin-1', role: UserRole.ADMIN, jti: 'j2', exp: 9_999_999_999 };

function makeSetting(key: string, value: unknown): Setting {
  return {
    id: `id-${key}`,
    key,
    value: value as never,
    isCoreRule: key.startsWith('worker_protection'),
    version: 1,
    updatedById: null,
    updatedAt: new Date(),
  };
}

const SEED_SETTINGS: Setting[] = Object.values(SETTING_KEYS).map((def) =>
  makeSetting(def.key, def.type === 'boolean' ? true : def.type === 'number' ? 1 : []),
);

describe('SettingsController', () => {
  let controller: SettingsController;
  let serviceMock: jest.Mocked<Pick<SettingsService, 'getAll' | 'set'>>;

  beforeEach(async () => {
    serviceMock = {
      getAll: jest.fn().mockResolvedValue(SEED_SETTINGS),
      set: jest.fn().mockImplementation(async (_keyDef, value, _actor) =>
        makeSetting(_keyDef.key, value),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: serviceMock }],
    }).compile();

    controller = module.get(SettingsController);
  });

  // ── GET /admin/settings ─────────────────────────────────────────────────────

  describe('GET /admin/settings', () => {
    it('returns { data: Setting[] }', async () => {
      const result = await controller.getAll();
      expect(result).toEqual({ data: SEED_SETTINGS });
      expect(serviceMock.getAll).toHaveBeenCalledTimes(1);
    });
  });

  // ── PATCH /admin/settings — validate-all-first ──────────────────────────────

  describe('PATCH /admin/settings', () => {
    it('non-core key by ADMIN → applied, returns updated settings', async () => {
      const result = await controller.batchUpdate(
        { updates: [{ key: SETTING_KEYS.MIN_COMPLETION_PCT.key, value: 80 }] },
        ADMIN_USER,
      );
      expect(serviceMock.set).toHaveBeenCalledTimes(1);
      expect(result.data[0]!.key).toBe(SETTING_KEYS.MIN_COMPLETION_PCT.key);
    });

    it('core-rule key by ADMIN → 403 CORE_RULE_FORBIDDEN, no writes applied', async () => {
      await expect(
        controller.batchUpdate(
          { updates: [{ key: SETTING_KEYS.ACCOMMODATION_REQUIRED.key, value: false }] },
          ADMIN_USER,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(serviceMock.set).not.toHaveBeenCalled();
    });

    it('core-rule key by SUPER_ADMIN → applied', async () => {
      const result = await controller.batchUpdate(
        { updates: [{ key: SETTING_KEYS.ACCOMMODATION_REQUIRED.key, value: false }] },
        SUPER_ADMIN_USER,
      );
      expect(serviceMock.set).toHaveBeenCalledTimes(1);
      expect(result.data[0]!.key).toBe(SETTING_KEYS.ACCOMMODATION_REQUIRED.key);
    });

    it('unknown key → 422 SETTING_KEY_UNKNOWN, no writes', async () => {
      await expect(
        controller.batchUpdate(
          { updates: [{ key: 'does.not.exist', value: true }] },
          ADMIN_USER,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(serviceMock.set).not.toHaveBeenCalled();
    });

    it('wrong-typed value → 422 SETTING_INVALID_VALUE, no writes', async () => {
      await expect(
        controller.batchUpdate(
          { updates: [{ key: SETTING_KEYS.MIN_COMPLETION_PCT.key, value: 'not-a-number' }] },
          ADMIN_USER,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(serviceMock.set).not.toHaveBeenCalled();
    });

    it('batch atomicity: if second entry fails, no writes at all', async () => {
      // First item valid, second has unknown key → batch rejected, zero writes
      await expect(
        controller.batchUpdate(
          {
            updates: [
              { key: SETTING_KEYS.MIN_COMPLETION_PCT.key, value: 80 },
              { key: 'bad.key', value: true },
            ],
          },
          ADMIN_USER,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(serviceMock.set).not.toHaveBeenCalled();
    });

    it('batch atomicity: if first entry is core-rule by ADMIN, second valid never written', async () => {
      await expect(
        controller.batchUpdate(
          {
            updates: [
              { key: SETTING_KEYS.ACCOMMODATION_REQUIRED.key, value: false },
              { key: SETTING_KEYS.MIN_COMPLETION_PCT.key, value: 80 },
            ],
          },
          ADMIN_USER,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(serviceMock.set).not.toHaveBeenCalled();
    });

    it('multi-item valid batch for SUPER_ADMIN → all written', async () => {
      const result = await controller.batchUpdate(
        {
          updates: [
            { key: SETTING_KEYS.ACCOMMODATION_REQUIRED.key, value: false },
            { key: SETTING_KEYS.MIN_COMPLETION_PCT.key, value: 80 },
          ],
        },
        SUPER_ADMIN_USER,
      );
      expect(serviceMock.set).toHaveBeenCalledTimes(2);
      expect(result.data).toHaveLength(2);
    });
  });
});
