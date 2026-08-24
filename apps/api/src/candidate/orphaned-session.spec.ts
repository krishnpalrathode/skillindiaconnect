import { UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * A VALID TOKEN WHOSE USER NO LONGER EXISTS.
 *
 * JwtAuthGuard verifies signature, type and blacklist but deliberately does NOT
 * query the database — one Redis EXISTS is the entire cost of an authenticated
 * request. So a token outlives its user, gets past the guard, and only fails
 * downstream when something writes a row that references it.
 *
 * findOrCreateProfile is where that lands for every candidate page load: its
 * upsert creates candidate_profiles with a userId FK. Deleting users out from
 * under a live session (a manual data wipe) made every such request throw
 * Prisma P2003 — unhandled, so a 500. The client then showed "Failed to load
 * profile. Please refresh.", and refreshing could never work: the token stays
 * valid for its full TTL.
 *
 * A 401 is both true and useful — it drives refresh → fail → logout → sign-in.
 */
describe('orphaned session (valid token, deleted user)', () => {
  const P2003 = new Prisma.PrismaClientKnownRequestError('FK constraint failed', {
    code: 'P2003',
    clientVersion: 'test',
  });
  const P2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

  /** Mirrors the catch in findOrCreateProfile / findOrCreateProfileWithDocs. */
  function handle(err: unknown, refetch: () => string): string {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return refetch();
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new UnauthorizedException({ code: 'USER_NO_LONGER_EXISTS' });
    }
    throw err;
  }

  it('P2003 → 401 USER_NO_LONGER_EXISTS, never a 500', () => {
    let thrown: unknown;
    try {
      handle(P2003, () => 'refetched');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).getResponse()).toEqual({
      code: 'USER_NO_LONGER_EXISTS',
    });
  });

  it('P2002 still re-fetches — the concurrent-create race is unchanged', () => {
    expect(handle(P2002, () => 'refetched')).toBe('refetched');
  });

  it('any other error still propagates — this narrows nothing else', () => {
    const boom = new Error('db down');
    expect(() => handle(boom, () => 'refetched')).toThrow('db down');
  });
});
