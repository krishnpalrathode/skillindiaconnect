'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { AdminCandidateCard } from '@/lib/api/admin-candidates';
import { Badge } from '@/components/ui/badge';

/**
 * The four ACCOUNT states an admin reasons about. Note the derivation: a purged
 * account's `status` stays PENDING_DELETION on the wire (the contract's
 * UserStatus enum has no PURGED value) — `purgedAt` IS the terminal marker, so
 * it wins over everything else. Text-conveyed, never color-only.
 */
export type CandidateAccountState = 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION' | 'PURGED';

export function accountState(
  card: Pick<AdminCandidateCard, 'status' | 'purgedAt'>,
): CandidateAccountState {
  if (card.purgedAt) return 'PURGED';
  return card.status as CandidateAccountState;
}

const VARIANT: Record<CandidateAccountState, 'success' | 'neutral' | 'warning' | 'error'> = {
  ACTIVE: 'success',
  SUSPENDED: 'neutral',
  PENDING_DELETION: 'warning',
  PURGED: 'error',
};

export function CandidateStatusBadge({
  card,
}: {
  card: Pick<AdminCandidateCard, 'status' | 'purgedAt'>;
}) {
  const t = useTranslations('admin.candidates.state');
  const state = accountState(card);
  return <Badge variant={VARIANT[state]}>{t(state)}</Badge>;
}
