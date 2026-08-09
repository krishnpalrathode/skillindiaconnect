'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BadgeCheck,
  Building2,
  Factory,
  FileText,
  Globe2,
  Link as LinkIcon,
  MapPin,
  Phone,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { EditableSection } from '@/components/profile/EditableSection';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { patchCompany } from '@/lib/api/employer';
import { cn } from '@/lib/utils';
import type { components } from '@skillindiaconnect/shared-types';

type Company = components['schemas']['Company'];
type EmployeeRange = components['schemas']['EmployeeRange'];

interface CompanyInfoSectionProps {
  company: Company;
  onUpdated: (updated: Company) => void;
}

const EMPLOYEE_RANGES: EmployeeRange[] = ['1-10', '11-50', '51-200', '201-500', '500+'];

/**
 * One company field as a tile: icon chip, label, value.
 *
 * The section was eight label-over-value pairs in small grey text — nothing to
 * scan by, so finding "Location" meant reading all of them. The icon gives each
 * field a landmark, and an EMPTY field becomes an "Add" affordance that opens
 * the same edit form rather than a dead "Not set": half this grid is blank on a
 * fresh company, and every blank is something that makes the profile weaker to
 * candidates.
 *
 * Deliberately mirrors the candidate PersonalInfoSection tile, so the two
 * profile screens read as one product.
 */
function InfoRow({
  label,
  value,
  icon: Icon,
  onAdd,
  className,
}: {
  label: string;
  value?: React.ReactNode;
  icon: LucideIcon;
  onAdd?: () => void;
  className?: string;
}) {
  const t = useTranslations('employer.profile.companyInfo');
  const filled = Boolean(value);

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-neutral-200/60 bg-neutral-50/40 p-3 transition-colors hover:border-neutral-200 hover:bg-white',
        className,
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
          filled ? 'bg-[#E8F0FE] text-[#0F3D91]' : 'bg-neutral-100 text-neutral-600',
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>

      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{label}</dt>
        <dd className="text-sm font-semibold break-words text-neutral-900">
          {filled ? (
            value
          ) : onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="rounded font-medium text-[#0F3D91] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {t('addValue', { field: label.toLowerCase() })}
            </button>
          ) : (
            <span className="font-normal text-neutral-600">{t('notSet')}</span>
          )}
        </dd>
      </div>
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
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <InfoRow label={t('nameLabel')} value={company.name} icon={Building2} />

      {/* Type and registration number are NOT editable here, so they get no
          "Add" affordance — offering one would open a form that cannot change
          them. */}
      <InfoRow
        label={t('typeLabel')}
        icon={Globe2}
        value={
          <Badge variant="neutral" className="w-fit font-semibold">
            {typeLabel}
          </Badge>
        }
      />
      <InfoRow
        label={t('registrationNumberLabel')}
        value={company.registrationNumber}
        icon={BadgeCheck}
      />

      <InfoRow
        label={t('industryLabel')}
        value={company.industryType}
        icon={Factory}
        onAdd={handleEdit}
      />
      <InfoRow
        label={t('phoneLabel')}
        // The dial code is stored separately; showing the number without it is
        // an uncallable string.
        value={
          company.phone ? `${company.phoneCode ? `${company.phoneCode} ` : ''}${company.phone}` : ''
        }
        icon={Phone}
        onAdd={handleEdit}
      />
      <InfoRow
        label={t('locationLabel')}
        value={company.location}
        icon={MapPin}
        onAdd={handleEdit}
      />
      <InfoRow
        label={t('websiteLabel')}
        icon={LinkIcon}
        onAdd={handleEdit}
        value={
          company.website ? (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded text-[#0F3D91] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {company.website.replace(/^https?:\/\//, '')}
            </a>
          ) : (
            ''
          )
        }
      />
      <InfoRow
        label={t('employeeRangeLabel')}
        value={company.employeeRange}
        icon={Users}
        onAdd={handleEdit}
      />
      <InfoRow
        label={t('descriptionLabel')}
        value={company.description}
        icon={FileText}
        onAdd={handleEdit}
        className="sm:col-span-2"
      />
    </dl>
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
