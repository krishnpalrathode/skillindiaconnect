/**
 * The locked-cell rule and the permission-key registry — no Docker needed.
 *
 * These are tiny, but they are the two things everything else in Screen 27
 * assumes: that lockedness has exactly ONE definition, and that the key list the
 * DTO whitelists against is the same one the matrix renders.
 */
import { UserRole } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ALL_PERMISSION_KEYS, Permission } from './permission.constants';
import { MATRIX_ROLES, isCellLocked } from './rbac-matrix.constants';
import { UpdateCellDto } from './dto/update-cell.dto';

describe('isCellLocked — the single source of lockedness', () => {
  it('locks EVERY SUPER_ADMIN cell even when the DB row says isLocked=false', () => {
    // THE last-administrator protection. It is asserted in CODE precisely so that
    // no DB state — a bad migration, a careless seed edit, a stray UPDATE — can
    // unlock the super-admin column and leave the platform unadministrable.
    expect(isCellLocked(UserRole.SUPER_ADMIN, { isLocked: false })).toBe(true);
    expect(isCellLocked(UserRole.SUPER_ADMIN, { isLocked: true })).toBe(true);
  });

  it('honours the seeded locked set for non-super roles', () => {
    expect(isCellLocked(UserRole.ADMIN, { isLocked: true })).toBe(true);
    expect(isCellLocked(UserRole.MODERATOR, { isLocked: true })).toBe(true);
  });

  it('leaves ordinary non-super cells unlocked', () => {
    expect(isCellLocked(UserRole.ADMIN, { isLocked: false })).toBe(false);
    expect(isCellLocked(UserRole.MODERATOR, { isLocked: false })).toBe(false);
    expect(isCellLocked(UserRole.SUPPORT, { isLocked: false })).toBe(false);
  });
});

describe('the matrix registry', () => {
  it('columns are the four admin roles — CANDIDATE and EMPLOYER are never columns', () => {
    expect([...MATRIX_ROLES]).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MODERATOR,
      UserRole.SUPPORT,
    ]);
    expect(MATRIX_ROLES).not.toContain(UserRole.CANDIDATE);
    expect(MATRIX_ROLES).not.toContain(UserRole.EMPLOYER);
  });

  it('carries all 27 keys, unique, and in module-grouped declaration order', () => {
    expect(ALL_PERMISSION_KEYS).toHaveLength(27);
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(27);

    // Row order IS declaration order — the FE renders straight down this list, so
    // a key landing in the wrong group would scatter it across Screen 27's grid.
    const groupOf = (k: string) => k.split('.')[0];
    const firstIndexOfGroup = new Map<string, number>();
    ALL_PERMISSION_KEYS.forEach((k, i) => {
      const g = groupOf(k)!;
      if (!firstIndexOfGroup.has(g)) firstIndexOfGroup.set(g, i);
    });
    // Every key sits contiguously with its group: no key may appear after a
    // LATER group has already started.
    ALL_PERMISSION_KEYS.forEach((k, i) => {
      const g = groupOf(k)!;
      const groupStart = firstIndexOfGroup.get(g)!;
      const strays = ALL_PERMISSION_KEYS.slice(groupStart, i).filter((o) => groupOf(o) !== g);
      expect(strays).toEqual([]);
    });
  });
});

describe('UpdateCellDto — the whitelist', () => {
  const build = (payload: Record<string, unknown>) =>
    validate(plainToInstance(UpdateCellDto, payload));

  it('accepts a valid cell', async () => {
    await expect(
      build({ role: UserRole.MODERATOR, permission: Permission.LOGS_EXPORT, enabled: true }),
    ).resolves.toEqual([]);
  });

  it('REJECTS an unknown permission key — never a silent no-op', async () => {
    const errors = await build({
      role: UserRole.MODERATOR,
      permission: 'jobs.delete_everything',
      enabled: true,
    });
    expect(errors.map((e) => e.property)).toContain('permission');
  });

  it('REJECTS a non-matrix role (CANDIDATE/EMPLOYER hold no matrix rows)', async () => {
    for (const role of [UserRole.CANDIDATE, UserRole.EMPLOYER]) {
      const errors = await build({ role, permission: Permission.LOGS_VIEW, enabled: true });
      expect(errors.map((e) => e.property)).toContain('role');
    }
  });

  it('REJECTS a non-boolean enabled (no truthy-string coercion into a grant)', async () => {
    const errors = await build({
      role: UserRole.ADMIN,
      permission: Permission.LOGS_VIEW,
      enabled: 'yes',
    });
    expect(errors.map((e) => e.property)).toContain('enabled');
  });
});
