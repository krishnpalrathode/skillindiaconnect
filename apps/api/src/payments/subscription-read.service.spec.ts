/**
 * effectivePlan() — the single plan-truth source (S5-B3).
 * GRACE = paid entitlements; EXPIRED/none = FREE (cap from Settings);
 * FREE-plan subscription rows never count as paid.
 */
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { SubscriptionReadService } from './subscription-read.service';

describe('SubscriptionReadService.effectivePlan', () => {
  let findFirst: jest.Mock;
  let settingsGet: jest.Mock;
  let service: SubscriptionReadService;

  const paidSub = (status: SubscriptionStatus, maxActiveJobs: number | null = null) => ({
    id: 'sub-1',
    companyId: 'co-1',
    status,
    startsAt: new Date('2026-06-01'),
    plan: { code: 'PRO_MONTHLY', name: 'Pro Monthly', maxActiveJobs },
  });

  beforeEach(() => {
    findFirst = jest.fn();
    settingsGet = jest.fn().mockResolvedValue(1);
    service = new SubscriptionReadService(
      { subscription: { findFirst } } as unknown as PrismaService,
      { get: settingsGet } as unknown as SettingsService,
    );
  });

  it('ACTIVE paid sub → the paid plan entitlements, documentAccess true', async () => {
    findFirst.mockResolvedValue(paidSub(SubscriptionStatus.ACTIVE));
    await expect(service.effectivePlan('co-1')).resolves.toEqual({
      planCode: 'PRO_MONTHLY',
      maxActiveJobs: null,
      documentAccess: true,
      status: SubscriptionStatus.ACTIVE,
    });
    expect(settingsGet).not.toHaveBeenCalled();
  });

  it('GRACE keeps EVERYTHING — paid entitlements including documentAccess', async () => {
    findFirst.mockResolvedValue(paidSub(SubscriptionStatus.GRACE));
    await expect(service.effectivePlan('co-1')).resolves.toEqual({
      planCode: 'PRO_MONTHLY',
      maxActiveJobs: null,
      documentAccess: true,
      status: SubscriptionStatus.GRACE,
    });
  });

  it('EXPIRED paid sub → FREE entitlements (cap from the setting), status reported as EXPIRED', async () => {
    findFirst.mockResolvedValue(paidSub(SubscriptionStatus.EXPIRED));
    settingsGet.mockResolvedValue(2);
    await expect(service.effectivePlan('co-1')).resolves.toEqual({
      planCode: 'FREE',
      maxActiveJobs: 2,
      documentAccess: false,
      status: SubscriptionStatus.EXPIRED,
    });
    expect(settingsGet).toHaveBeenCalledWith(SETTING_KEYS.FREE_MAX_ACTIVE_JOBS);
  });

  it('no subscription at all → FREE entitlements, status NONE', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.effectivePlan('co-1')).resolves.toEqual({
      planCode: 'FREE',
      maxActiveJobs: 1,
      documentAccess: false,
      status: 'NONE',
    });
  });

  it('FREE-plan subscription rows never count as paid (query excludes plan.code FREE)', async () => {
    findFirst.mockResolvedValue(null);
    await service.effectivePlan('co-1');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ plan: { code: { not: 'FREE' } } }),
      }),
    );
  });
});
