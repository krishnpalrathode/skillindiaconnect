import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from './permission.constants';

export const REQUIRE_PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...keys: PermissionKey[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, keys);
