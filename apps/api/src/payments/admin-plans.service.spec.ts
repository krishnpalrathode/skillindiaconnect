import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AdminPlansService, PLAN_PRICE_MAX_SUBUNITS } from './admin-plans.service';

/**
 * The money guards. These are not input validation — they encode the fact that
 * `CheckoutService` decides purchasability with `plan.priceSubunits === 0`, so a
 * price of zero is a STATE, not just a number.
 */
const ACTOR = { userId: 'admin-1', role: UserRole.SUPER_ADMIN };

const FREE = {
  id: 'p-free',
  code: 'FREE',
  name: 'Free',
  priceSubunits: 0,
  period: 'MONTHLY',
  maxActiveJobs: 1,
  features: [],
  isActive: true,
};
const PRO = { ...FREE, id: 'p-pro', code: 'PRO_MONTHLY', name: 'Pro Monthly', priceSubunits: 299900 };

function build(plan: unknown) {
  const update = jest.fn().mockImplementation(({ data }) => ({ ...(plan as object), ...data }));
  const prisma = {
    plan: {
      findUnique: jest.fn().mockResolvedValue(plan),
      findMany: jest.fn().mockResolvedValue([FREE, PRO]),
      update,
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminPlansService(prisma as never, audit as never);
  return { service, prisma, audit, update };
}

describe('AdminPlansService.updatePrice', () => {
  it('updates a paid plan and returns the new price', async () => {
    const { service, update } = build(PRO);
    const row = await service.updatePrice('PRO_MONTHLY', 349900, ACTOR);
    expect(update).toHaveBeenCalledWith({
      where: { code: 'PRO_MONTHLY' },
      data: { priceSubunits: 349900 },
    });
    expect(row.priceSubunits).toBe(349900);
  });

  it('audits the change with BOTH the old and new price', async () => {
    /*
      The before/after pair is the point. "Someone changed the price" cannot
      answer a customer disputing what they were charged; from → to and the actor
      can.
    */
    const { service, audit } = build(PRO);
    await service.updatePrice('PRO_MONTHLY', 349900, ACTOR);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        targetType: 'Plan',
        meta: expect.objectContaining({
          planCode: 'PRO_MONTHLY',
          fromSubunits: 299900,
          toSubunits: 349900,
        }),
      }),
    );
  });

  it('refuses to put a price on the Free plan', async () => {
    // Pricing Free would make it purchasable and start charging for the tier the
    // product promises at no cost.
    const { service, update } = build(FREE);
    await expect(service.updatePrice('FREE', 100, ACTOR)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to zero a paid plan — that removes it from sale silently', async () => {
    const { service, update } = build(PRO);
    await expect(service.updatePrice('PRO_MONTHLY', 0, ACTOR)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a non-integer price — subunits are paise, never fractions', async () => {
    const { service, update } = build(PRO);
    await expect(service.updatePrice('PRO_MONTHLY', 2999.5, ACTOR)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a price past the ceiling — the mistyped-extra-zero guard', async () => {
    const { service } = build(PRO);
    await expect(
      service.updatePrice('PRO_MONTHLY', PLAN_PRICE_MAX_SUBUNITS + 1, ACTOR),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('is a no-op when the price is unchanged — no write, no audit noise', async () => {
    const { service, update, audit } = build(PRO);
    const row = await service.updatePrice('PRO_MONTHLY', 299900, ACTOR);
    expect(update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(row.priceSubunits).toBe(299900);
  });

  it('404s on an unknown plan code', async () => {
    const { service } = build(null);
    await expect(service.updatePrice('NOPE', 100, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminPlansService.list', () => {
  it('marks the Free plan as not price-editable so the UI disables it', async () => {
    const { service } = build(PRO);
    const rows = await service.list();
    expect(rows.find((r) => r.code === 'FREE')?.priceEditable).toBe(false);
    expect(rows.find((r) => r.code === 'PRO_MONTHLY')?.priceEditable).toBe(true);
  });
});
