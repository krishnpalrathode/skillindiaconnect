'use client';

import React from 'react';
import { useAdmin } from '@/lib/admin/admin-context';
import type { PermissionKey } from '@/lib/api/admin';

/**
 * Renders `children` only when the caller holds `permission`.
 *
 * For in-screen affordances — the Approve button, the Export link, the Save bar.
 * F2/F3/S6b consume it so a MODERATOR is not shown an Export button that will
 * hand them a 403 the moment they click it.
 *
 * ⚠️ THIS IS NOT SECURITY. It is presentation. Anything gated here MUST also be
 * refused by the server, because a determined caller can render whatever they
 * like in their own browser. The rule for every consumer: gate the button with
 * PermissionGate for the honest UX, and rely on the endpoint's 403 for the
 * actual guarantee. If a capability is ONLY protected by this component, it is
 * not protected.
 */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionKey;
  children: React.ReactNode;
  /** Rendered instead when the caller lacks the key. Default: nothing. */
  fallback?: React.ReactNode;
}) {
  const { has } = useAdmin();
  return <>{has(permission) ? children : fallback}</>;
}
