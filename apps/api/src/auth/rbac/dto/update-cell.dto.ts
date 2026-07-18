import { UserRole } from '@prisma/client';
import { IsBoolean, IsIn } from 'class-validator';
import { ALL_PERMISSION_KEYS, PermissionKey } from '../permission.constants';
import { MATRIX_ROLES } from '../rbac-matrix.constants';

/**
 * ONE cell per request. There is deliberately no bulk-replacement shape: a whole
 * -matrix PUT is one fat-fingered payload away from a platform-wide privilege
 * change, and it audits as a single opaque blob. One cell per call means every
 * change is individually reviewable in the trail.
 *
 * Both enums are whitelisted against the SAME arrays the rest of the system uses
 * (ALL_PERMISSION_KEYS, MATRIX_ROLES) — an unknown role or permission is
 * REJECTED, loudly, by the global ValidationPipe. It is never a silent no-op, and
 * it can never create a new cell: permission keys are a code+seed change.
 */
export class UpdateCellDto {
  @IsIn(MATRIX_ROLES as UserRole[])
  role!: UserRole;

  @IsIn(ALL_PERMISSION_KEYS as PermissionKey[])
  permission!: PermissionKey;

  @IsBoolean()
  enabled!: boolean;
}
