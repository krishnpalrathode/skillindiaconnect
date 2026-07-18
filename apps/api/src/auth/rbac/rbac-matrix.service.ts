import {
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RolePermission, UserRole } from '@prisma/client';

/** 423. Not in Nest's HttpStatus enum; the contract mandates it for a locked cell. */
const HTTP_LOCKED = 423;
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../../audit/audit.types';
import { ALL_PERMISSION_KEYS, Permission, PermissionKey } from './permission.constants';
import { PermissionService } from './permission.service';
import { MATRIX_ROLES, isCellLocked } from './rbac-matrix.constants';
import { UpdateCellDto } from './dto/update-cell.dto';

/** Contract: RbacCell. */
export interface RbacCell {
  role: UserRole;
  permission: PermissionKey;
  enabled: boolean;
  locked: boolean;
}

/** Contract: RbacMatrix. */
export interface RbacMatrix {
  roles: readonly UserRole[];
  permissions: readonly PermissionKey[];
  cells: RbacCell[];
}

/**
 * The WRITE surface over 5b's RBAC machinery (Screen 27's data layer).
 *
 * 5b built permission RESOLUTION (PermissionsGuard → PermissionService → a
 * 300s-TTL Redis cache per role). It also built cache INVALIDATION — but nothing
 * had ever changed a permission at runtime, so that path had never actually run
 * in anger. This service is its first real exercise, and that is the whole point
 * of the unit: if invalidation is broken, a REVOKED PERMISSION KEEPS WORKING for
 * up to 300 seconds. A silent, time-boxed security hole. The integration spec
 * proves the grant and the revoke both take effect on the very NEXT request.
 *
 * Scope boundaries, stated because they are load-bearing:
 *   - This API FLIPS EXISTING CELLS. It does not create roles or permission keys.
 *     A new key is a code + seed change (permission.constants.ts + the seed
 *     matrix + its count assertion), reviewed like any other diff — never a
 *     runtime mutation. Hence an unseeded cell is a 404, not an implicit insert.
 *   - Grants are per-ROLE. There are no per-user overrides at MVP; "what can this
 *     person do" is answerable from their role alone, which is what makes the
 *     cache (keyed by role) sound in the first place.
 */
@Injectable()
export class RbacMatrixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * The full roles × permissions grid.
   *
   * Cells are emitted permission-major (for each permission, every role) so the
   * FE can lay out Screen 27's grid — permissions as ROWS, roles as COLUMNS — by
   * consuming `cells` in order, with no client-side sort. Row order is
   * ALL_PERMISSION_KEYS (grouped by module); column order is MATRIX_ROLES.
   *
   * A (role, permission) pair with no `role_permissions` row is synthesised as
   * `enabled: false` rather than omitted: the grid must be rectangular or the FE
   * renders a hole. In practice the seed writes every pair, so a synthesised cell
   * means the DB was not re-seeded after a key was added — and PATCHing it will
   * say so with a 404 rather than silently inserting a grant.
   */
  async getMatrix(): Promise<RbacMatrix> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { role: { in: MATRIX_ROLES as UserRole[] } },
    });

    const byCell = new Map<string, RolePermission>();
    for (const row of rows) {
      byCell.set(cellKey(row.role, row.permissionKey), row);
    }

    const cells: RbacCell[] = [];
    for (const permission of ALL_PERMISSION_KEYS) {
      for (const role of MATRIX_ROLES) {
        const row = byCell.get(cellKey(role, permission));
        cells.push({
          role,
          permission,
          enabled: row?.enabled ?? false,
          // Same helper the WRITE path enforces with — one source, so the greyed
          // checkbox and the 423 can never disagree.
          locked: isCellLocked(role, { isLocked: row?.isLocked ?? false }),
        });
      }
    }

    return { roles: MATRIX_ROLES, permissions: ALL_PERMISSION_KEYS, cells };
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Flip ONE cell. Every rejection below happens BEFORE any write — a rejected
   * PATCH leaves the matrix and the audit trail completely untouched.
   *
   * Validation order (deliberate):
   *   1. locked        → 423 PERMISSION_CELL_LOCKED
   *   2. self-lockout  → 422 SELF_LOCKOUT_FORBIDDEN
   *   3. last-manager  → 422 LAST_MANAGER_FORBIDDEN
   *   4. no-op         → 200, no write, NO audit row
   *
   * Lockedness is checked first and unconditionally, so even a no-op PATCH at a
   * locked cell is a 423: the cell is immutable, and reporting "fine, 200" to a
   * caller who just tried to modify it would be a lie about what the API allows.
   *
   * The no-op check sits AFTER the lockout guards on purpose. Asking to revoke
   * your own roles.manage is refused whether or not it happens to already be off
   * — the request expresses an intent the platform does not permit, and answering
   * 200 would teach the caller that the operation is available.
   */
  async updateCell(
    dto: UpdateCellDto,
    actor: { userId: string; role: UserRole },
  ): Promise<RbacCell> {
    const { role, permission, enabled } = dto;

    const row = await this.prisma.rolePermission.findUnique({
      where: { role_permissionKey: { role, permissionKey: permission } },
    });

    // No row = this key was declared in code but never seeded. NOT an implicit
    // insert: creating cells at runtime is exactly the "add a permission key
    // without a reviewed diff" path this API refuses to be.
    if (!row) {
      throw new NotFoundException({
        code: 'PERMISSION_NOT_FOUND',
        detail: 'No such role/permission cell.',
        meta: { role, permission },
      });
    }

    // 1. Locked — the guarantee. A disabled checkbox in the UI is a courtesy;
    //    THIS is the control. Note the SUPER_ADMIN column is locked in code, so
    //    no DB state can make the platform unadministrable.
    if (isCellLocked(role, row)) {
      throw new HttpException(
        {
          code: 'PERMISSION_CELL_LOCKED',
          detail: 'This permission is locked and cannot be changed.',
          meta: {
            role,
            permission,
            reason:
              role === UserRole.SUPER_ADMIN
                ? 'SUPER_ADMIN permissions can never be revoked (last-administrator protection).'
                : 'This cell is locked by platform policy.',
          },
        },
        HTTP_LOCKED,
      );
    }

    const revokingRolesManage = !enabled && permission === Permission.ROLES_MANAGE;

    // 2. Self-lockout: an ADMIN holding roles.manage must not be able to revoke
    //    it FROM ADMIN — they would be locked out of the screen they are standing
    //    on, with no way back in. The locked SUPER_ADMIN column covers the
    //    headline case; this covers the rest.
    //
    //    Under the SHIPPED seed this is unreachable: roles.manage is locked-OFF
    //    for every non-super role, so no ADMIN can hold it to begin with. The
    //    guard exists so that a future seed change granting roles.manage more
    //    widely cannot silently open the hole — the protection lands with the
    //    grant, not after the incident.
    if (revokingRolesManage && actor.role === role) {
      throw new UnprocessableEntityException({
        code: 'SELF_LOCKOUT_FORBIDDEN',
        detail: 'You cannot revoke your own ability to manage roles.',
        meta: { role, permission },
      });
    }

    // 3. Last manager: never let the LAST role holding roles.manage lose it —
    //    that is the degenerate case where the matrix becomes read-only forever
    //    and only a DBA can undo it. (Also normally unreachable, because
    //    SUPER_ADMIN holds roles.manage in a locked cell; a locked cell can never
    //    be the one being revoked, so SUPER_ADMIN always remains. Defence in
    //    depth, for the same reason as above.)
    if (revokingRolesManage) {
      const managers = await this.prisma.rolePermission.findMany({
        where: {
          permissionKey: Permission.ROLES_MANAGE,
          enabled: true,
          role: { in: MATRIX_ROLES as UserRole[] },
        },
        select: { role: true },
      });
      const remaining = managers.filter((m) => m.role !== role);
      if (remaining.length === 0) {
        throw new UnprocessableEntityException({
          code: 'LAST_MANAGER_FORBIDDEN',
          detail: 'At least one role must retain the ability to manage roles.',
          meta: { role, permission },
        });
      }
    }

    // 4. No-op — already in the requested state. 200, no write, and NO audit row:
    //    an audit trail that records non-events is a trail nobody reads.
    if (row.enabled === enabled) {
      return { role, permission, enabled, locked: false };
    }

    // The write and its audit COMMIT TOGETHER. A permission change with no audit
    // row is precisely the event the trail exists to capture, so it may not be
    // possible for one to land without the other — logInTransaction, not log().
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.update({
        where: { role_permissionKey: { role, permissionKey: permission } },
        data: { enabled },
      });

      await this.auditService.logInTransaction(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: AUDIT_ACTIONS.RBAC_PERMISSION_CHANGED,
        module: AUDIT_MODULES.ADMIN,
        targetType: 'RolePermission',
        targetId: `${role}/${permission}`,
        status: AuditStatus.SUCCESS,
        meta: { role, permission, from: row.enabled, to: enabled },
      });
    });

    // POST-COMMIT invalidation, using 5b's own mechanism (PermissionService owns
    // the cache key; a second `redis.del` here would drift the moment 5b changed
    // its key format, and the guard would keep serving stale grants while every
    // test still passed).
    //
    // After the commit, never inside the transaction: a concurrent request during
    // an open transaction would re-populate the cache from the PRE-commit row,
    // and that stale entry would then survive the full 300s TTL — the exact bug
    // invalidation exists to prevent.
    await this.permissionService.invalidateRoleCache(role);

    return { role, permission, enabled, locked: false };
  }
}

function cellKey(role: UserRole, permission: string): string {
  return `${role} ${permission}`;
}
