'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { AdminCandidateProfile } from '@/components/admin/candidates/AdminCandidateProfile';

/** Screen 25's detail — the admin candidate view + actions + the danger zone. */
export default function AdminCandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id) return null;
  return <AdminCandidateProfile candidateId={id} />;
}
