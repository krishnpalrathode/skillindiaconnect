'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Badge } from '@/components/ui/badge';
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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="text-sm text-neutral-900">
        {value || <span className="text-neutral-400">—</span>}
      </dd>
    </div>
  );
}

const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  SINGLE: 'Single',
  MARRIED: 'Married',
  DIVORCED: 'Divorced',
  WIDOWED: 'Widowed',
};

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
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      <InfoRow
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
      <InfoRow label={t('dobLabel')} value={profile.dob ?? null} />
      <InfoRow label={t('fatherNameLabel')} value={profile.fatherName ?? null} />
      <InfoRow
        label={t('maritalStatusLabel')}
        value={profile.maritalStatus ? MARITAL_STATUS_LABELS[profile.maritalStatus] : null}
      />
      <InfoRow label={t('religionLabel')} value={profile.religion ?? null} />
      <InfoRow label={t('languagesLabel')} value={(profile.languages ?? []).join(', ') || null} />
      <InfoRow label={t('nationalityLabel')} value={profile.nationality ?? null} />
      <InfoRow label={t('locationLabel')} value={profile.currentLocation ?? null} />
      <InfoRow
        label={t('noticePeriodLabel')}
        value={profile.noticePeriod ? t('noticePeriodUnit', { days: profile.noticePeriod }) : null}
      />
    </dl>
  );

  const editForm = (
    <div className="flex flex-col gap-4">
      <Field id="pi-fullName" label={t('nameLabel') || 'Full name'} required>
        <Input
          value={(draft.fullName as string) ?? ''}
          onChange={(e) => set('fullName', e.target.value)}
          placeholder={t('namePlaceholder')}
        />
      </Field>

      <Field id="pi-fatherName" label={t('fatherNameLabel')}>
        <Input
          value={(draft.fatherName as string) ?? ''}
          onChange={(e) => set('fatherName', e.target.value)}
          placeholder={t('fatherNamePlaceholder')}
        />
      </Field>

      <Field id="pi-dob" label={t('dobLabel')}>
        <Input
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
          className="h-11 w-full rounded-md border border-input bg-background ps-3 pe-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
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
          value={(draft.religion as string) ?? ''}
          onChange={(e) => set('religion', e.target.value)}
          placeholder={t('religionPlaceholder')}
        />
      </Field>

      <Field id="pi-languages" label={t('languagesLabel')}>
        <Input
          value={languagesStr}
          onChange={(e) => setLanguagesStr(e.target.value)}
          placeholder={t('languagesPlaceholder')}
        />
      </Field>

      <Field id="pi-nationality" label={t('nationalityLabel')}>
        <Input
          value={(draft.nationality as string) ?? ''}
          onChange={(e) => set('nationality', e.target.value)}
          placeholder={t('nationalityPlaceholder')}
        />
      </Field>

      <Field id="pi-location" label={t('locationLabel')}>
        <Input
          value={(draft.currentLocation as string) ?? ''}
          onChange={(e) => set('currentLocation', e.target.value)}
          placeholder={t('locationPlaceholder')}
        />
      </Field>

      <Field id="pi-notice" label={t('noticePeriodLabel')}>
        <Input
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
