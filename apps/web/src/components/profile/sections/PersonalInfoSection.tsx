'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Flag,
  HeartHandshake,
  Landmark,
  Languages,
  MapPin,
  Phone,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { MARITAL_STATUS_LABELS } from '@/lib/maritalStatus';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { EditableSection } from '@/components/profile/EditableSection';
import { PhoneVerify } from '@/components/onboarding/PhoneVerify';
import { patchCandidateProfile } from '@/lib/api/candidate';
import type { PatchCandidateBody } from '@/lib/api/candidate';

type CandidateProfile = components['schemas']['CandidateProfile'];
type MaritalStatus = components['schemas']['MaritalStatus'];

interface PersonalInfoSectionProps {
  profile: CandidateProfile;
  onProfileUpdate: (p: CandidateProfile) => void;
  onCompletionRefetch: () => Promise<void>;
}

/**
 * One field as a tile: icon chip, label, value.
 *
 * This was a bare label-over-value pair in a two-column list, which at a glance
 * was an undifferentiated wall of small grey text — nothing to scan by. The icon
 * gives each field a landmark, and an EMPTY field becomes a button that opens
 * the edit form rather than rendering a dead "—": on a 20%-complete profile most
 * of this grid is empty, and every one of those dashes is something the
 * candidate needs to fill in to reach the 70% apply threshold.
 */
function InfoRow({
  label,
  value,
  icon: Icon,
  onAdd,
  addLabel,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  onAdd?: () => void;
  addLabel: string;
}) {
  const filled = Boolean(value);

  return (
    <div className="flex items-start gap-3 rounded-xl border border-neutral-200/60 bg-neutral-50/40 p-3 transition-colors hover:border-neutral-200 hover:bg-white">
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
        <dd className="text-sm font-semibold text-neutral-900">
          {filled ? (
            value
          ) : onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="rounded font-medium text-[#0F3D91] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
            >
              {addLabel}
            </button>
          ) : (
            <span className="font-normal text-neutral-600">—</span>
          )}
        </dd>
      </div>
    </div>
  );
}

export function PersonalInfoSection({
  profile,
  onProfileUpdate,
  onCompletionRefetch,
}: PersonalInfoSectionProps) {
  const t = useTranslations('profile.personalInfo');
  const tSec = useTranslations('profile.sections');

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // languages is string[] in schema; store as comma-separated string for the input field
  const [languagesStr, setLanguagesStr] = useState('');
  const [draft, setDraft] = useState<Omit<PatchCandidateBody, 'languages'>>({});

  function openEdit() {
    setLanguagesStr((profile.languages ?? []).join(', '));
    setDraft({
      fullName: profile.fullName ?? '',
      fatherName: profile.fatherName ?? '',
      dob: profile.dob ?? '',
      maritalStatus: profile.maritalStatus ?? undefined,
      religion: profile.religion ?? '',
      nationality: profile.nationality ?? '',
      currentLocation: profile.currentLocation ?? '',
      noticePeriod: profile.noticePeriod ?? undefined,
    });
    setIsEditing(true);
  }

  function cancelEdit() {
    setDraft({});
    setIsEditing(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const langArray = languagesStr
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      const updated = await patchCandidateProfile({
        ...draft,
        ...(langArray.length > 0 ? { languages: langArray } : {}),
      });
      onProfileUpdate(updated);
      await onCompletionRefetch();
      setIsEditing(false);
      setDraft({});
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof Omit<PatchCandidateBody, 'languages'>>(
    key: K,
    value: Omit<PatchCandidateBody, 'languages'>[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const viewContent = (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <InfoRow
        icon={Phone}
        onAdd={openEdit}
        addLabel={t('addValue')}
        label={t('phoneLabel')}
        value={
          profile.phone ? (
            <span className="flex items-center gap-1.5">
              {profile.phone}
              {profile.phoneVerifiedAt ? (
                <Badge variant="success" className="gap-0.5 text-xs">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  {t('phoneVerifiedBadge')}
                </Badge>
              ) : (
                <span className="text-xs text-warning-fg">{t('verifyPhoneLink')}</span>
              )}
            </span>
          ) : null
        }
      />
      <InfoRow
        icon={CalendarDays}
        onAdd={openEdit}
        addLabel={t('addValue')}
        label={t('dobLabel')}
        value={profile.dob ?? null}
      />
      <InfoRow
        icon={User}
        onAdd={openEdit}
        addLabel={t('addValue')}
        label={t('fatherNameLabel')}
        value={profile.fatherName ?? null}
      />
      <InfoRow
        icon={HeartHandshake}
        onAdd={openEdit}
        addLabel={t('addValue')}
        label={t('maritalStatusLabel')}
        value={profile.maritalStatus ? MARITAL_STATUS_LABELS[profile.maritalStatus] : null}
      />
      <InfoRow
        icon={Landmark}
        onAdd={openEdit}
        addLabel={t('addValue')}
        label={t('religionLabel')}
        value={profile.religion ?? null}
      />
      <InfoRow
        icon={Languages}
        onAdd={openEdit}
        addLabel={t('addValue')}
        label={t('languagesLabel')}
        value={(profile.languages ?? []).join(', ') || null}
      />
      <InfoRow
        icon={Flag}
        onAdd={openEdit}
        addLabel={t('addValue')}
        label={t('nationalityLabel')}
        value={profile.nationality ?? null}
      />
      <InfoRow
        icon={MapPin}
        onAdd={openEdit}
        addLabel={t('addValue')}
        label={t('locationLabel')}
        value={profile.currentLocation ?? null}
      />
      <InfoRow
        icon={Clock}
        onAdd={openEdit}
        addLabel={t('addValue')}
        label={t('noticePeriodLabel')}
        value={profile.noticePeriod ? t('noticePeriodUnit', { days: profile.noticePeriod }) : null}
      />
    </dl>
  );

  const editForm = (
    <div className="flex flex-col gap-4">
      <Field id="pi-fullName" label={t('nameLabel') || 'Full name'} required>
        <Input
          className="h-12 rounded-xl"
          value={(draft.fullName as string) ?? ''}
          onChange={(e) => set('fullName', e.target.value)}
          placeholder={t('namePlaceholder')}
        />
      </Field>

      <Field id="pi-fatherName" label={t('fatherNameLabel')}>
        <Input
          className="h-12 rounded-xl"
          value={(draft.fatherName as string) ?? ''}
          onChange={(e) => set('fatherName', e.target.value)}
          placeholder={t('fatherNamePlaceholder')}
        />
      </Field>

      <Field id="pi-dob" label={t('dobLabel')}>
        <Input
          className="h-12 rounded-xl"
          type="date"
          value={(draft.dob as string) ?? ''}
          onChange={(e) => set('dob', e.target.value)}
        />
      </Field>

      <Field id="pi-marital" label={t('maritalStatusLabel')}>
        <select
          id="pi-marital"
          value={(draft.maritalStatus as string) ?? ''}
          onChange={(e) =>
            set('maritalStatus', (e.target.value || undefined) as MaritalStatus | undefined)
          }
          className="h-12 w-full rounded-xl border border-input bg-background ps-3 pe-3 text-sm transition-colors focus-visible:border-primary-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <option value="">—</option>
          {(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'] as MaritalStatus[]).map((s) => (
            <option key={s} value={s}>
              {MARITAL_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>

      <Field id="pi-religion" label={t('religionLabel')}>
        <Input
          className="h-12 rounded-xl"
          value={(draft.religion as string) ?? ''}
          onChange={(e) => set('religion', e.target.value)}
          placeholder={t('religionPlaceholder')}
        />
      </Field>

      <Field id="pi-languages" label={t('languagesLabel')}>
        <Input
          className="h-12 rounded-xl"
          value={languagesStr}
          onChange={(e) => setLanguagesStr(e.target.value)}
          placeholder={t('languagesPlaceholder')}
        />
      </Field>

      <Field id="pi-nationality" label={t('nationalityLabel')}>
        <Input
          className="h-12 rounded-xl"
          value={(draft.nationality as string) ?? ''}
          onChange={(e) => set('nationality', e.target.value)}
          placeholder={t('nationalityPlaceholder')}
        />
      </Field>

      <Field id="pi-location" label={t('locationLabel')}>
        <Input
          className="h-12 rounded-xl"
          value={(draft.currentLocation as string) ?? ''}
          onChange={(e) => set('currentLocation', e.target.value)}
          placeholder={t('locationPlaceholder')}
        />
      </Field>

      <Field id="pi-notice" label={t('noticePeriodLabel')}>
        <Input
          className="h-12 rounded-xl"
          type="number"
          min={0}
          max={365}
          value={draft.noticePeriod ?? ''}
          onChange={(e) => set('noticePeriod', e.target.value ? Number(e.target.value) : undefined)}
          placeholder={t('noticePeriodPlaceholder')}
        />
      </Field>

      {/* Phone verification — always visible in edit mode; has its own save flow */}
      <div className="pt-2 border-t border-neutral-100">
        <PhoneVerify
          initialPhone={profile.phone ?? ''}
          alreadyVerified={!!profile.phoneVerifiedAt}
          onVerified={async (phone) => {
            const updated = await patchCandidateProfile({ fullName: profile.fullName });
            onProfileUpdate({ ...updated, phone, phoneVerifiedAt: new Date().toISOString() });
            await onCompletionRefetch();
          }}
        />
      </div>
    </div>
  );

  return (
    <EditableSection
      title={tSec('personalInfo')}
      isEditing={isEditing}
      onEdit={openEdit}
      onCancel={cancelEdit}
      onSave={handleSave}
      saving={saving}
      form={editForm}
    >
      {viewContent}
    </EditableSection>
  );
}
