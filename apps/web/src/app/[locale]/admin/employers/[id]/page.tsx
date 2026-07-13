'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { EmployerReviewPanel } from '@/components/admin/employers/EmployerReviewPanel';

/** Screen 24's review detail — one company, its certificate, and the actions. */
export default function AdminEmployerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id) return null;
  return <EmployerReviewPanel companyId={id} />;
}
