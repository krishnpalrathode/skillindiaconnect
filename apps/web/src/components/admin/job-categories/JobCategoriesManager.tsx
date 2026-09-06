'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  createJobCategory,
  deleteJobCategory,
  getAdminJobCategories,
  updateJobCategory,
  type AdminJobCategory,
} from '@/lib/api/admin-job-categories';
import { ApiRequestError } from '@/lib/api/client';
import { useAdmin } from '@/lib/admin/admin-context';
import { ForbiddenState } from '@/components/admin/ForbiddenState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogShell } from '@/components/ui/dialog-shell';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';

const PROTECTED_SLUG = 'other';

type FormState = { mode: 'create' } | { mode: 'edit'; category: AdminJobCategory } | null;

/**
 * Admin → Job Categories. The employer post-a-job picker and the public search
 * chips both read this taxonomy (GET /job-categories, active only), so this
 * screen is where the marketplace's trade list is actually decided.
 *
 * Never optimistic: every write refetches the server's list (mirrors the RBAC
 * matrix). Delete is guarded server-side — a category with jobs can't be
 * hard-deleted, and the "Other" row is protected — so those return calm,
 * explained states rather than errors.
 */
export function JobCategoriesManager() {
  const t = useTranslations('admin.jobCategories');
  const { has } = useAdmin();
  const canManage = has('job_categories.manage');

  const [categories, setCategories] = useState<AdminJobCategory[] | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [deleting, setDeleting] = useState<AdminJobCategory | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      setCategories(await getAdminJobCategories());
    } catch (err) {
      setError(err as Error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error instanceof ApiRequestError && error.error.status === 403) {
    return (
      <ForbiddenState
        requiredPermission={error.error.meta?.['requiredPermission'] as string | undefined}
      />
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 py-8">
        <p className="text-sm font-medium text-error-fg">{t('loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!categories) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-neutral-600">
        <Spinner size={18} label={t('loading')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-600">{t('count', { count: categories.length })}</p>
        {canManage && (
          <Button variant="primary" size="sm" onClick={() => setForm({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden="true" />
            {t('add')}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-start">
              <th className="px-4 py-2.5 text-start font-semibold text-neutral-700">
                {t('colName')}
              </th>
              <th className="px-4 py-2.5 text-start font-semibold text-neutral-700">
                {t('colSlug')}
              </th>
              <th className="px-4 py-2.5 text-start font-semibold text-neutral-700">
                {t('colStatus')}
              </th>
              <th className="px-4 py-2.5 text-end font-semibold text-neutral-700">
                {t('colJobs')}
              </th>
              {canManage && (
                <th className="px-4 py-2.5 text-end font-semibold text-neutral-700">
                  <span className="sr-only">{t('colActions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3">
                  <span className="font-medium text-neutral-900">{c.nameEn}</span>
                  {(c.nameHi || c.nameAr) && (
                    <span className="ms-2 text-xs text-neutral-600">
                      {[c.nameHi, c.nameAr].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-neutral-600">{c.slug}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      c.isActive
                        ? 'inline-flex items-center rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-medium text-success-fg'
                        : 'inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600'
                    }
                  >
                    {c.isActive ? t('active') : t('inactive')}
                  </span>
                </td>
                <td className="px-4 py-3 text-end tabular-nums text-neutral-700">{c.jobCount}</td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('editAria', { name: c.nameEn })}
                        onClick={() => setForm({ mode: 'edit', category: c })}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('deleteAria', { name: c.nameEn })}
                        disabled={c.slug === PROTECTED_SLUG}
                        onClick={() => setDeleting(c)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <CategoryFormDialog
          state={form}
          onClose={() => setForm(null)}
          onSaved={async (msg) => {
            setForm(null);
            showToast({ variant: 'success', message: msg });
            await load();
          }}
        />
      )}

      {deleting && (
        <DeleteCategoryDialog
          category={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            const name = deleting.nameEn;
            setDeleting(null);
            showToast({ variant: 'success', message: t('toastDeleted', { name }) });
            await load();
          }}
        />
      )}
    </div>
  );
}

// ─── Create / edit dialog ─────────────────────────────────────────────────────

function CategoryFormDialog({
  state,
  onClose,
  onSaved,
}: {
  state: Exclude<FormState, null>;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const t = useTranslations('admin.jobCategories');
  const isCreate = state.mode === 'create';
  const existing = state.mode === 'edit' ? state.category : null;

  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [nameEn, setNameEn] = useState(existing?.nameEn ?? '');
  const [nameHi, setNameHi] = useState(existing?.nameHi ?? '');
  const [nameAr, setNameAr] = useState(existing?.nameAr ?? '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const canSubmit = nameEn.trim().length > 0 && (!isCreate || slugValid);

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setFieldError(null);
    try {
      if (isCreate) {
        await createJobCategory({ slug, nameEn, nameHi, nameAr, isActive });
        await onSaved(t('toastCreated'));
      } else {
        await updateJobCategory(existing!.id, { nameEn, nameHi, nameAr, isActive });
        await onSaved(t('toastUpdated'));
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'CATEGORY_SLUG_TAKEN') {
        setFieldError(t('errSlugTaken'));
      } else {
        setFieldError(t('errGeneric'));
      }
      setBusy(false);
    }
  }

  return (
    <DialogShell
      titleId="job-category-form"
      title={isCreate ? t('createTitle') : t('editTitle')}
      busy={busy}
      confirmLabel={isCreate ? t('create') : t('save')}
      confirmDisabled={!canSubmit}
      onConfirm={submit}
      onClose={onClose}
      cancelLabel={t('cancel')}
    >
      <div className="flex flex-col gap-4">
        {isCreate ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-700">{t('fieldSlug')}</span>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="rigger"
              aria-invalid={slug.length > 0 && !slugValid}
            />
            <span className="text-xs text-neutral-600">{t('fieldSlugHint')}</span>
          </label>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-700">{t('fieldSlug')}</span>
            <p className="font-mono text-sm text-neutral-600">{existing!.slug}</p>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">{t('fieldNameEn')}</span>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">{t('fieldNameHi')}</span>
          <Input value={nameHi} onChange={(e) => setNameHi(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">{t('fieldNameAr')}</span>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
        </label>

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="size-4 rounded border-neutral-300"
          />
          <span className="text-sm text-neutral-700">{t('fieldActive')}</span>
        </label>

        {fieldError && (
          <p role="alert" className="text-sm font-medium text-error-fg">
            {fieldError}
          </p>
        )}
      </div>
    </DialogShell>
  );
}

// ─── Delete dialog ────────────────────────────────────────────────────────────

function DeleteCategoryDialog({
  category,
  onClose,
  onDeleted,
}: {
  category: AdminJobCategory;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const t = useTranslations('admin.jobCategories');
  const [busy, setBusy] = useState(false);
  // A server-side guard we surface as a calm explanation, not an error: the row
  // is in use, so it can only be deactivated (via Edit), never hard-deleted.
  const [blocked, setBlocked] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    try {
      await deleteJobCategory(category.id);
      await onDeleted();
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === 'CATEGORY_IN_USE') {
        setBlocked(t('inUseBody', { name: category.nameEn, count: category.jobCount }));
      } else if (err instanceof ApiRequestError && err.error.code === 'CATEGORY_PROTECTED') {
        setBlocked(t('protectedBody'));
      } else {
        setBlocked(t('errGeneric'));
      }
      setBusy(false);
    }
  }

  if (blocked) {
    return (
      <DialogShell
        titleId="job-category-delete-blocked"
        title={t('cannotDeleteTitle')}
        busy={false}
        confirmLabel={t('ok')}
        onConfirm={onClose}
        onClose={onClose}
        role="alertdialog"
      >
        <p className="text-sm text-neutral-700">{blocked}</p>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      titleId="job-category-delete"
      title={t('deleteTitle')}
      busy={busy}
      confirmLabel={t('deleteConfirm')}
      confirmVariant="destructive"
      onConfirm={confirm}
      onClose={onClose}
      cancelLabel={t('cancel')}
      role="alertdialog"
    >
      <p className="text-sm text-neutral-700">{t('deleteBody', { name: category.nameEn })}</p>
    </DialogShell>
  );
}
