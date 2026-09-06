'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { JobCategoriesManager } from '@/components/admin/job-categories/JobCategoriesManager';
import { ADMIN_PAGE_SHELL } from '@/lib/page-shell';

/** Admin → Job Categories: CRUD over the taxonomy the employer picker reads. */
export default function AdminJobCategoriesPage() {
  const t = useTranslations('admin.jobCategories');

  return (
    <div className={ADMIN_PAGE_SHELL}>
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>
      <JobCategoriesManager />
    </div>
  );
}
