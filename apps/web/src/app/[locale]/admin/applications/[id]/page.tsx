'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { ApplicationDetailPanel } from '@/components/admin/applications/ApplicationDetailPanel';

/** The application detail — full timeline + override + notes + resend. */
export default function AdminApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id) return null;
  return <ApplicationDetailPanel applicationId={id} />;
}
