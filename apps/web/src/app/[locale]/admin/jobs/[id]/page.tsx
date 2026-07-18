'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { JobReviewPanel } from '@/components/admin/jobs/JobReviewPanel';

/** The job review / moderation detail — the job as candidates would see it + admin actions. */
export default function AdminJobDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id) return null;
  return <JobReviewPanel jobId={id} />;
}
