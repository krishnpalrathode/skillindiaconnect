'use client';

import React, { useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { UserCircle2, Camera } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { PhoneVerify } from '@/components/onboarding/PhoneVerify';
import { patchCandidateProfile } from '@/lib/api/candidate';
import type { PatchCandidateBody } from '@/lib/api/candidate';
import { compressImage } from '@/components/upload/imageCompress';

type CandidateProfile = components['schemas']['CandidateProfile'];
type MaritalStatus = components['schemas']['MaritalStatus'];

const MARITAL_STATUSES: MaritalStatus[] = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'];

interface PersonalInfoStepProps {
  profile: CandidateProfile;
  onProfileUpdate: (updated: CandidateProfile) => void;
  onNext: () => void;
}

/**
 * Step 1 — Personal Info.
 * Required to advance: fullName + dob.
 * Soft-block (non-blocking): phone verification.
 * Profile photo: local preview only (no API endpoint in S1).
 */
export function PersonalInfoStep({ profile, onProfileUpdate, onNext }: PersonalInfoStepProps) {
  const t = useTranslations('onboarding.personalInfo');
  const tStep = useTranslations('onboarding.nav');
  const tStatus = useTranslations('onboarding.maritalStatus');

  const [fullName, setFullName] = useState(profile.fullName ?? '');
  const [dob, setDob] = useState(profile.dob ?? '');
  const [maritalStatus, setMaritalStatus] = useState<MaritalStatus | ''>(
    profile.maritalStatus ?? '',
  );
  const [languages, setLanguages] = useState((profile.languages ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const canAdvance = fullName.trim().length > 0 && dob.length > 0;

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    const url = URL.createObjectURL(compressed);
    setPhotoPreview(url);
  };

  const handleNext = async () => {
    if (!canAdvance) return;
    setError(null);
    setSaving(true);

    const patch: PatchCandidateBody = {
      fullName: fullName.trim(),
      dob: dob,
      ...(maritalStatus ? { maritalStatus } : {}),
      ...(languages.trim()
        ? {
            languages: languages
              .split(',')
              .map((l) => l.trim())
              .filter(Boolean),
          }
        : {}),
    };

    try {
      const updated = await patchCandidateProfile(patch);
      onProfileUpdate(updated);
      onNext();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-neutral-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-neutral-500">{t('subtitle')}</p>
      </div>

      {/* Profile photo (local preview — no API in S1) */}
      <div className="flex flex-col items-center gap-2">
        <div className="relative w-20 h-20">
          <div className="w-20 h-20 rounded-full bg-neutral-100 border-2 border-neutral-200 overflow-hidden flex items-center justify-center">
            {photoPreview ? (
              <Image
                src={photoPreview}
                alt="Profile"
                width={80}
                height={80}
                className="w-full h-full object-cover"
                unoptimized
              />
            ) : (
              <UserCircle2 className="size-12 text-neutral-400" aria-hidden="true" />
            )}
          </div>
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="absolute bottom-0 end-0 w-7 h-7 bg-primary-600 rounded-full flex items-center justify-center text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('photoUpload')}
          >
            <Camera className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <p className="text-xs text-neutral-500">{t('photoHint')}</p>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={handlePhotoChange}
          aria-label={t('photoLabel')}
        />
      </div>

      {/* Required fields */}
      <div className="flex flex-col gap-4">
        <Field id="pi-fullname" label={t('nameLabel')} required>
          <Input
            placeholder={t('namePlaceholder')}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
          />
        </Field>

        <Field id="pi-dob" label={t('dobLabel')} required>
          <Input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
          />
        </Field>

        {/* Marital status */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pi-marital" className="text-sm font-medium text-neutral-700">
            {t('maritalStatusLabel')}
          </label>
          <select
            id="pi-marital"
            value={maritalStatus}
            onChange={(e) => setMaritalStatus(e.target.value as MaritalStatus | '')}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600 transition-colors"
          >
            <option value="">— Select —</option>
            {MARITAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </select>
        </div>

        {/* Languages (comma-separated) */}
        <Field id="pi-languages" label={t('languagesLabel')} hint={t('languagesPlaceholder')}>
          <Input
            placeholder="Hindi, English, Arabic"
            value={languages}
            onChange={(e) => setLanguages(e.target.value)}
          />
        </Field>
      </div>

      {/* Phone verify (soft-block — non-required) */}
      <PhoneVerify
        initialPhone={profile.phone ?? ''}
        alreadyVerified={!!profile.phoneVerifiedAt}
        onVerified={(phone) => {
          onProfileUpdate({ ...profile, phone });
        }}
      />

      {error && (
        <p role="alert" className="text-sm text-error-fg">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          size="lg"
          loading={saving}
          disabled={!canAdvance}
          onClick={handleNext}
        >
          {tStep('next')}
        </Button>
      </div>
    </div>
  );
}
