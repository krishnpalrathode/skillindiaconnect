/**
 * PasswordResetService — the security properties, asserted directly.
 *
 * The two that matter most and are easiest to regress silently:
 *   1. ENUMERATION SAFETY: request() behaves identically for a registered and an
 *      unregistered address, so no caller can tell them apart.
 *   2. The raw token is NEVER persisted — only its SHA-256.
 */
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { NotificationType } from '@prisma/client';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';

const WEB_APP_URL = 'https://app.skillindiaconnect.com';

type Row = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

function buildHarness(opts: { user?: Record<string, unknown> | null } = {}) {
  const tokens: Row[] = [];
  const userUpdates: Array<Record<string, unknown>> = [];
  const revokedFor: string[] = [];
  const notified: Array<{
    userId: string;
    type: NotificationType;
    payload: Record<string, unknown>;
  }> = [];

  // Narrow stand-ins for the Prisma argument shapes this service actually uses.
  type TokenWhere = { userId?: string; id?: string; consumedAt?: null; tokenHash?: string };
  type UpdateManyArgs = { where: TokenWhere; data: { consumedAt: Date } };
  type CreateArgs = { data: { userId: string; tokenHash: string; expiresAt: Date } };
  type FindUniqueArgs = { where: { tokenHash: string } };

  const tokenTable = {
    updateMany: jest.fn(async ({ where, data }: UpdateManyArgs) => {
      let count = 0;
      for (const r of tokens) {
        const matchesUser = where.userId ? r.userId === where.userId : true;
        const matchesId = where.id ? r.id === where.id : true;
        const matchesUnconsumed = where.consumedAt === null ? r.consumedAt === null : true;
        if (matchesUser && matchesId && matchesUnconsumed) {
          r.consumedAt = data.consumedAt;
          count++;
        }
      }
      return { count };
    }),
    create: jest.fn(async ({ data }: CreateArgs) => {
      const row: Row = { id: `t${tokens.length + 1}`, consumedAt: null, ...data };
      tokens.push(row);
      return row;
    }),
    findUnique: jest.fn(
      async ({ where }: FindUniqueArgs) =>
        tokens.find((r) => r.tokenHash === where.tokenHash) ?? null,
    ),
  };

  const tx = {
    passwordResetToken: tokenTable,
    user: {
      update: jest.fn(
        async ({ data }: { data: Record<string, unknown> }) => void userUpdates.push(data),
      ),
    },
    refreshSession: {
      updateMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
        revokedFor.push(where.userId);
        return { count: 1 };
      }),
    },
  };

  const prisma = {
    user: {
      findUnique: jest.fn(async () => (opts.user === undefined ? null : opts.user)),
    },
    passwordResetToken: tokenTable,
    $transaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn(tx)),
  };

  const notifications = {
    notify: jest.fn(
      async (userId: string, type: NotificationType, payload: Record<string, unknown>) => {
        notified.push({ userId, type, payload });
      },
    ),
  };

  const redis = {
    incr: jest.fn(async () => 1),
    expire: jest.fn(async () => 1),
  };

  const config = {
    get: (k: string) => (k === 'WEB_APP_URL' ? WEB_APP_URL : undefined),
  } as unknown as ConfigService;

  const service = new PasswordResetService(
    prisma as never,
    new PasswordService(),
    notifications as never,
    config,
    redis as never,
  );

  return { service, prisma, notifications, redis, tokens, userUpdates, revokedFor, notified };
}

/** Pull the raw token back out of the emailed link, as a recipient would. */
function tokenFromEmail(text: string): string {
  return new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
}

describe('PasswordResetService.request', () => {
  it('ENUMERATION SAFETY: an unknown address resolves normally and writes nothing', async () => {
    const h = buildHarness({ user: null });
    await expect(h.service.request('nobody@example.com')).resolves.toBeUndefined();
    expect(h.tokens).toHaveLength(0);
    expect(h.notified).toHaveLength(0);
  });

  it('ENUMERATION SAFETY: known and unknown addresses are indistinguishable to the caller', async () => {
    const known = buildHarness({ user: { id: 'u1', email: 'a@b.com', passwordHash: 'argon2$x' } });
    const unknown = buildHarness({ user: null });

    const a = await known.service.request('a@b.com');
    const b = await unknown.service.request('nobody@example.com');

    // Same return value, same absence of a thrown error — nothing to branch on.
    expect(a).toEqual(b);
  });

  it('issues a token and emails a link carrying it', async () => {
    const h = buildHarness({ user: { id: 'u1', email: 'a@b.com', passwordHash: 'argon2$x' } });
    await h.service.request('a@b.com');

    expect(h.tokens).toHaveLength(1);
    expect(h.notified).toHaveLength(1);
    expect(h.notified[0]!.type).toBe(NotificationType.PASSWORD_RESET);

    const link = String(
      (h.notified[0]!.payload as never as { data: { resetUrl: string } }).data.resetUrl,
    );
    expect(link).toContain(`${WEB_APP_URL}/reset-password?token=`);
  });

  it('the RAW token is never stored — only its SHA-256', async () => {
    const h = buildHarness({ user: { id: 'u1', email: 'a@b.com', passwordHash: 'argon2$x' } });
    await h.service.request('a@b.com');

    const raw = tokenFromEmail(
      String((h.notified[0]!.payload as never as { data: { resetUrl: string } }).data.resetUrl),
    );
    const stored = h.tokens[0]!.tokenHash;

    expect(stored).not.toBe(raw);
    expect(stored).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('requesting again retires the previous unconsumed token', async () => {
    const h = buildHarness({ user: { id: 'u1', email: 'a@b.com', passwordHash: 'argon2$x' } });
    await h.service.request('a@b.com');
    await h.service.request('a@b.com');

    expect(h.tokens).toHaveLength(2);
    expect(h.tokens[0]!.consumedAt).not.toBeNull(); // the first is dead
    expect(h.tokens[1]!.consumedAt).toBeNull();
  });

  it('a Google-only account gets a "use Google" email and NO reset token', async () => {
    const h = buildHarness({ user: { id: 'u1', email: 'a@b.com', passwordHash: null } });
    await h.service.request('a@b.com');

    expect(h.tokens).toHaveLength(0);
    expect(h.notified).toHaveLength(1);

    /*
      The copy now lives in the branded email template, so this asserts on the
      PAYLOAD the service emits rather than on hand-written body text: the
      account is flagged as Google-only, the explanation mentions Google, and —
      the security-relevant part — no reset link is minted for an account that
      has no password.
    */
    const payload = h.notified[0]!.payload as never as {
      body: string;
      data: { googleAccount?: boolean; resetUrl?: string };
    };
    expect(payload.data.googleAccount).toBe(true);
    expect(payload.data.resetUrl).toBeUndefined();
    expect(payload.body).toMatch(/Google/);
  });

  it('the per-address budget throttles the 6th request in an hour', async () => {
    const h = buildHarness({ user: { id: 'u1', email: 'a@b.com', passwordHash: 'argon2$x' } });
    h.redis.incr.mockResolvedValueOnce(6);
    await expect(h.service.request('a@b.com')).rejects.toBeInstanceOf(HttpException);
  });

  it('the budget is applied BEFORE the account lookup, so throttling cannot leak existence', async () => {
    const h = buildHarness({ user: null });
    h.redis.incr.mockResolvedValueOnce(6);
    await expect(h.service.request('nobody@example.com')).rejects.toBeInstanceOf(HttpException);
    expect(h.prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('PasswordResetService.reset', () => {
  async function issued() {
    const h = buildHarness({ user: { id: 'u1', email: 'a@b.com', passwordHash: 'argon2$old' } });
    await h.service.request('a@b.com');
    const raw = tokenFromEmail(
      String((h.notified[0]!.payload as never as { data: { resetUrl: string } }).data.resetUrl),
    );
    return { h, raw };
  }

  it('a valid token sets a NEW argon2 hash', async () => {
    const { h, raw } = await issued();
    await h.service.reset(raw, 'NewPassw0rd');

    expect(h.userUpdates).toHaveLength(1);
    const hash = String(h.userUpdates[0]!['passwordHash']);
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(new PasswordService().verify(hash, 'NewPassw0rd')).resolves.toBe(true);
  });

  it('every refresh session is revoked — a reset must not leave an attacker signed in', async () => {
    const { h, raw } = await issued();
    await h.service.reset(raw, 'NewPassw0rd');
    expect(h.revokedFor).toEqual(['u1']);
  });

  it('SINGLE USE: replaying the same link fails', async () => {
    const { h, raw } = await issued();
    await h.service.reset(raw, 'NewPassw0rd');
    await expect(h.service.reset(raw, 'Another0ne')).rejects.toMatchObject({
      response: { code: 'INVALID_RESET_TOKEN' },
    });
    expect(h.userUpdates).toHaveLength(1); // no second write
  });

  it('an EXPIRED token fails and changes nothing', async () => {
    const { h, raw } = await issued();
    h.tokens[0]!.expiresAt = new Date(Date.now() - 1000);
    await expect(h.service.reset(raw, 'NewPassw0rd')).rejects.toMatchObject({
      response: { code: 'INVALID_RESET_TOKEN' },
    });
    expect(h.userUpdates).toHaveLength(0);
  });

  it('a FORGED token fails with the SAME code as an expired one (no oracle)', async () => {
    const { h } = await issued();
    await expect(h.service.reset('deadbeef'.repeat(8), 'NewPassw0rd')).rejects.toMatchObject({
      response: { code: 'INVALID_RESET_TOKEN' },
    });
    expect(h.userUpdates).toHaveLength(0);
  });
});
