'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EditableSection } from '@/components/profile/EditableSection';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { patchCompany } from '@/lib/api/employer';
import type { components } from '@skillindiaconnect/shared-types';

type Company = components['schemas']['Company'];
type EmployeeRange = components['schemas']['EmployeeRange'];

interface CompanyInfoSectionProps {
  company: Company;
  onUpdated: (updated: Company) => void;
}

const EMPLOYEE_RANGES: EmployeeRange[] = ['1-10', '11-50', '51-200', '201-500', '500+'];

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  const t = useTranslations('employer.profile.companyInfo');
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-neutral-600">{label}</span>
      <span className="text-sm text-neutral-900">{value || t('notSet')}</span>
    </div>
  );
}

/**
 * Company information section.
 *
 * Design decisions:
 * - Company TYPE is read-only with a "contact support to change" note (it is
 *   load-bearing for payment routing and is set at onboarding; see spec).
 * - Registration number is read-only after approval (verified identity).
 * - Editable fields: name, industry, phone, location, website, employeeRange, description.
 */
export function CompanyInfoSection({ company, onUpdated }: CompanyInfoSectionProps) {
  const t = useTranslations('employer.profile.companyInfo');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState({
    name: company.name,
    industryType: company.industryType ?? '',
    phone: company.phone ?? '',
    location: company.location ?? '',
    website: company.website ?? '',
    employeeRange: company.employeeRange ?? ('' as EmployeeRange | ''),
    description: company.description ?? '',
  });

  const handleEdit = () => {
    setDraft({
      name: company.name,
      industryType: company.industryType ?? '',
      phone: company.phone ?? '',
      location: company.location ?? '',
      website: company.website ?? '',
      employeeRange: company.employeeRange ?? '',
      description: company.description ?? '',
    });
    setError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await patchCompany({
        name: draft.name,
        industryType: draft.industryType || undefined,
        phone: draft.phone || undefined,
        location: draft.location || undefined,
        website: draft.website || undefined,
        employeeRange: (draft.employeeRange as EmployeeRange) || undefined,
        description: draft.description || undefined,
      });
      onUpdated(updated);
      setIsEditing(false);
    } catch {
      setError(t('saveError'));
      // `false` tells EditableSection the save failed, so it stays quiet and
      // the inline message above is the only thing the user sees.
      return false;
    } finally {
      setSaving(false);
    }
  };

  const set =
    (field: keyof typeof draft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setDraft((prev) => ({ ...prev, [field]: e.target.value }));

  const typeLabel = company.type === 'LOCAL' ? t('typeLocal') : t('typeForeign');

  const viewContent = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <InfoRow label={t('nameLabel')} value={company.name} />
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-neutral-600">{t('typeLabel')}</span>
        <Badge variant="neutral" className="w-fit">
          {typeLabel}
        </Badge>
      </div>
      <InfoRow label={t('registrationNumberLabel')} value={company.registrationNumber} />
      <InfoRow label={t('industryLabel')} value={company.industryType} />
      <InfoRow label={t('phoneLabel')} value={company.phone} />
      <InfoRow label={t('locationLabel')} value={company.location} />
      <InfoRow label={t('websiteLabel')} value={company.website} />
      <InfoRow label={t('employeeRangeLabel')} value={company.employeeRange} />
      <div className="sm:col-span-2">
        <InfoRow label={t('descriptionLabel')} value={company.description} />
      </div>
    </div>
  );

  const editForm = (
    <div className="flex flex-col gap-4">
      {/* Company type — always read-only */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-700">{t('typeLabel')}</span>
        <Badge variant="neutral" className="w-fit">
          {typeLabel}
        </Badge>
        <p className="text-xs text-neutral-600">{t('typeReadOnlyHint')}</p>
      </div>

      {/* Registration number — read-only after approval */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-700">{t('registrationNumberLabel')}</span>
        <span className="text-sm text-neutral-900">
          {company.registrationNumber ?? t('notSet')}
        </span>
        <p className="text-xs text-neutral-600">{t('registrationNumberReadOnlyHint')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="ci-name" label={t('nameLabel')} required>
          <Input id="ci-name" value={draft.name} onChange={set('name')} />
        </Field>
        <Field id="ci-industry" label={t('industryLabel')}>
          <Input id="ci-industry" value={draft.industryType} onChange={set('industryType')} />
        </Field>
        <Field id="ci-phone" label={t('phoneLabel')}>
          <Input id="ci-phone" type="tel" value={draft.phone} onChange={set('phone')} />
        </Field>
        <Field id="ci-location" label={t('locationLabel')}>
          <Input id="ci-location" value={draft.location} onChange={set('location')} />
        </Field>
        <Field id="ci-website" label={t('websiteLabel')}>
          <Input
            id="ci-website"
            type="url"
            value={draft.website}
            onChange={set('website')}
            placeholder={t('websitePlaceholder')}
          />
        </Field>
        <Field id="ci-range" label={t('employeeRangeLabel')}>
          <select
            id="ci-range"
            value={draft.employeeRange}
            onChange={set('employeeRange')}
            className="flex h-11 w-full rounded-md border border-input bg-background ps-3 pe-3 py-2 text-base text-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600"
          >
            <option value="" />
            {EMPLOYEE_RANGES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field id="ci-desc" label={t('descriptionLabel')}>
            <textarea
              id="ci-desc"
              rows={4}
              value={draft.description}
              onChange={set('description')}
              placeholder={t('descriptionPlaceholder')}
              className="flex w-full rounded-md border border-input bg-background ps-3 pe-3 py-2 text-base text-foreground placeholder:text-neutral-600 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600 resize-y"
            />
          </Field>
        </div>
      </div>

      {error && (
        <p className="text-xs text-error-fg font-medium" role="alert">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <EditableSection
      title={t('sectionTitle')}
      isEditing={isEditing}
      onEdit={handleEdit}
      onCancel={handleCancel}
      onSave={handleSave}
      saving={saving}
      form={editForm}
    >
      {viewContent}
    </EditableSection>
  );
}
