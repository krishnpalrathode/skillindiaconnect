'use client';

import React, { useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { UserCircle2, Camera, Upload, Languages } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { DatePicker } from '@/components/ui/date-picker';
import { PhoneVerify } from '@/components/onboarding/PhoneVerify';
import { patchCandidateProfile } from '@/lib/api/candidate';
import type { PatchCandidateBody } from '@/lib/api/candidate';
import { compressImage } from '@/components/upload/imageCompress';

type CandidateProfile = components['schemas']['CandidateProfile'];
type MaritalStatus = components['schemas']['MaritalStatus'];

const MARITAL_STATUSES: MaritalStatus[] = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'];

// Blue-collar recruitment: candidates must be of legal working age. 100 is a
// sane upper bound that also rejects obviously-mistyped years (e.g. 1900).
const MIN_AGE = 18;
const MAX_AGE = 100;

/** ISO (YYYY-MM-DD) date exactly `years` before today — used for the picker bounds. */
function isoYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/** Whole years between `dob` (YYYY-MM-DD) and today, or null if unparseable. */
function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const b = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const monthDelta = now.getMonth() - b.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

interface PersonalInfoStepProps {
  profile: CandidateProfile;
  onProfileUpdate: (updated: CandidateProfile) => void;
  onNext: () => void;
}

/**
 * Step 1 — Personal Info.
 * Required to advance: fullName + dob + a VERIFIED mobile number.
 * Profile photo: local preview only (no API endpoint in S1).
 */
export function PersonalInfoStep({ profile, onProfileUpdate, onNext }: PersonalInfoStepProps) {
  const t = useTranslations('onboarding.personalInfo');
  const tStep = useTranslations('onboarding.nav');
  const tStatus = useTranslations('onboarding.maritalStatus');
  const tCal = useTranslations('common.calendar');

  const [fullName, setFullName] = useState(profile.fullName ?? '');
  const [dob, setDob] = useState(profile.dob ?? '');
  const [phoneVerified, setPhoneVerified] = useState(!!profile.phoneVerifiedAt);
  const [maritalStatus, setMaritalStatus] = useState<MaritalStatus | ''>(
    profile.maritalStatus ?? '',
  );
  const [languages, setLanguages] = useState((profile.languages ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Bounds for the date picker: no future dates, no under-18s, no absurd ages.
  const maxDob = isoYearsAgo(MIN_AGE);
  const minDob = isoYearsAgo(MAX_AGE);

  const nameValid = fullName.trim().length >= 2;
  const age = ageFromDob(dob);
  const ageValid = age !== null && age >= MIN_AGE && age <= MAX_AGE;

  // Inline errors only surface once the user has actually entered something —
  // we don't scold an empty, untouched field.
  const showNameError = fullName.trim().length > 0 && !nameValid;
  const showAgeError = dob.length > 0 && !ageValid;

  const canAdvance = nameValid && ageValid && phoneVerified;

  // Display-only chips parsed from the comma-separated languages input — the
  // saved value remains the same comma string the API has always received.
  const languageChips = languages
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

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
    <div className="flex flex-col gap-7">
      <div className="text-center">
        <h2 className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">
          {t('title')}
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600">{t('subtitle')}</p>
      </div>

      {/* Profile photo (local preview — no API in S1) — premium dashed upload card */}
      <div
        // Width-capped and centred: at the wider shell a full-bleed dropzone
        // became a long empty band around a small avatar. Capping it keeps the
        // target compact and deliberate rather than stretched.
        className="group mx-auto flex w-full max-w-md cursor-pointer flex-col items-center gap-3 rounded-[22px] border-2 border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-6 transition-all duration-200 hover:border-[#0F3D91]/40 hover:bg-[#E8F0FE]/40"
        onClick={() => photoInputRef.current?.click()}
      >
        <div className="relative h-24 w-24">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-md transition-transform duration-200 group-hover:scale-105">
            {photoPreview ? (
              <Image
                src={photoPreview}
                alt="Profile"
                width={96}
                height={96}
                className="h-full w-full object-cover"
                unoptimized
              />
            ) : (
              <UserCircle2 className="size-14 text-neutral-600" aria-hidden="true" />
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              photoInputRef.current?.click();
            }}
            className="absolute bottom-0 end-0 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] text-white shadow-md transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('photoUpload')}
          >
            <Camera className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
          <Upload className="size-4 text-[#0F3D91]" aria-hidden="true" />
          {t('photoUpload')}
        </div>
        <p className="text-xs text-neutral-600">{t('photoHint')}</p>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={handlePhotoChange}
          onClick={(e) => e.stopPropagation()}
          aria-label={t('photoLabel')}
        />
      </div>

      {/*
        Two columns from md up. Short fields (date, marital status) pair off;
        long ones span the row via col-span-2 below. Single column on mobile is
        unchanged.
      */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-x-6">
        <Field
          id="pi-fullname"
          label={t('nameLabel')}
          required
          error={showNameError ? t('nameError') : undefined}
          className="md:col-span-2"
        >
          <Input
            placeholder={t('namePlaceholder')}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            className="h-12 rounded-xl"
          />
        </Field>

        <Field
          id="pi-dob"
          label={t('dobLabel')}
          required
          hint={t('dobHint')}
          error={showAgeError ? t('ageError') : undefined}
        >
          <DatePicker
            value={dob}
            onChange={setDob}
            min={minDob}
            max={maxDob}
            placeholder={t('dobPlaceholder')}
            className="rounded-xl"
            labels={{
              prevMonth: tCal('prevMonth'),
              nextMonth: tCal('nextMonth'),
              month: tCal('month'),
              year: tCal('year'),
              clear: tCal('clear'),
              today: tCal('today'),
            }}
          />
        </Field>

        {/* Marital status */}
        <div className="flex flex-col gap-1.5">
          {/* leading-none matches the shared <Label>; without it this label is
              ~7px taller than its neighbour and the select sits visibly lower
              than the date input it now sits beside. */}
          <label htmlFor="pi-marital" className="text-sm font-medium leading-none text-neutral-700">
            {t('maritalStatusLabel')}
          </label>
          <select
            id="pi-marital"
            value={maritalStatus}
            onChange={(e) => setMaritalStatus(e.target.value as MaritalStatus | '')}
            className="flex h-12 w-full rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground outline-none transition-colors focus-visible:border-primary-600 focus-visible:ring-[3px] focus-visible:ring-ring/70"
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
        <Field
          id="pi-languages"
          label={t('languagesLabel')}
          hint={t('languagesPlaceholder')}
          className="md:col-span-2"
        >
          <Input
            placeholder="Hindi, English, Arabic"
            value={languages}
            onChange={(e) => setLanguages(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>

        {/* Display-only language chips mirroring the input above */}
        {languageChips.length > 0 && (
          <ul className="-mt-2 flex flex-wrap gap-1.5 md:col-span-2" aria-hidden="true">
            {languageChips.map((lang) => (
              <li
                key={lang}
                className="inline-flex items-center gap-1 rounded-full bg-[#E8F0FE] px-3 py-1 text-xs font-medium text-[#0F3D91]"
              >
                <Languages className="size-3" aria-hidden="true" />
                {lang}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Phone verify — REQUIRED: a verified mobile number gates advancing. */}
      <PhoneVerify
        initialPhone={profile.phone ?? ''}
        alreadyVerified={!!profile.phoneVerifiedAt}
        onVerified={(phone) => {
          setPhoneVerified(true);
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
          className="rounded-xl bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] px-8 shadow-md transition-all hover:shadow-lg"
        >
          {tStep('next')}
        </Button>
      </div>
    </div>
  );
}
