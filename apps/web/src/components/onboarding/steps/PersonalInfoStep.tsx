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
import { EmailVerify } from '@/components/onboarding/EmailVerify';
import { SetPassword } from '@/components/onboarding/SetPassword';
import { BrandLoader } from '@/components/ui/brand-loader';
import { useAuth } from '@/lib/auth/auth-context';
import {
  patchCandidateProfile,
  presignPhoto,
  uploadToPresignedUrl,
  confirmPhoto,
} from '@/lib/api/candidate';
import type { PatchCandidateBody } from '@/lib/api/candidate';
import { useToast } from '@/components/ui/toast';
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
 *
 * The profile photo UPLOADS on selection (presign → PUT → confirm), the same
 * chain ProfileHero uses. It was previously a local `URL.createObjectURL`
 * preview with the note "no API endpoint in S1" — but that endpoint has existed
 * since, so the photo was never persisted at all. Stepping to Work Experience
 * unmounts this component, and the object URL went with it: the candidate saw
 * their photo vanish on the way back, and nothing had ever reached the server.
 */
export function PersonalInfoStep({ profile, onProfileUpdate, onNext }: PersonalInfoStepProps) {
  const t = useTranslations('onboarding.personalInfo');
  const tStep = useTranslations('onboarding.nav');
  const tStatus = useTranslations('onboarding.maritalStatus');
  const tCal = useTranslations('common.calendar');
  const tToast = useTranslations('toast');
  const { showToast } = useToast();
  const { refreshSession } = useAuth();

  const [fullName, setFullName] = useState(profile.fullName ?? '');
  const [dob, setDob] = useState(profile.dob ?? '');
  const [phoneVerified, setPhoneVerified] = useState(!!profile.phoneVerifiedAt);

  /*
    ── Which credential step this candidate owes ─────────────────────────────

    An email signup arrives with an address and a password and owes a verified
    phone. A phone signup arrives with a verified phone and owes the other two.
    Both are read from the SERVER's view of the account rather than remembered
    client-side, so a reload mid-onboarding resumes on the right step instead
    of restarting or skipping one.

    `hasGoogle` is why the password step is not simply `!hasPassword`: a Google
    account has no password hash either, and demanding one from someone who
    already has a durable way in would be a step invented out of a null.
  */
  const needsEmail = !profile.email;
  const needsPassword = !profile.hasPassword && !profile.hasGoogle;

  const [emailVerified, setEmailVerified] = useState(!needsEmail);
  const [passwordSet, setPasswordSet] = useState(!needsPassword);

  /*
    Each block is asked for INDEPENDENTLY, on its own condition. Nesting the
    password step inside the email branch looked equivalent and was not: once
    the address is saved, `needsEmail` is false, so after a reload the whole
    branch — password step included — disappeared, and a candidate who had
    verified their email but never set a password advanced without one.

    - the phone is asked for only when it is not already proven (a phone signup
      proved theirs to create the account);
    - the password is asked for only once there IS an address to sign in with,
      which is Decision 2's ordering.
  */
  const showPhoneVerify = !phoneVerified;
  const showEmailVerify = needsEmail && !emailVerified;
  const showSetPassword = !passwordSet && (emailVerified || !needsEmail);
  const [maritalStatus, setMaritalStatus] = useState<MaritalStatus | ''>(
    profile.maritalStatus ?? '',
  );
  const [languages, setLanguages] = useState((profile.languages ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
    Seeded from the SAVED profile, so returning to this step shows the photo the
    server already has instead of an empty circle.
  */
  const [photoPreview, setPhotoPreview] = useState<string | null>(profile.photoUrl ?? null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
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

  /*
    Every candidate must leave this step with at least one PROVEN way to be
    reached — whichever one their signup route did not already establish. A
    phone signup is gated on the email, an email signup on the phone, exactly
    as before. `passwordSet` starts true whenever no password was owed, so it
    adds nothing to the email-signup or Google paths.
  */
  const contactVerified = needsEmail ? emailVerified : phoneVerified;
  const canAdvance = nameValid && ageValid && contactVerified && passwordSet;

  // Display-only chips parsed from the comma-separated languages input — the
  // saved value remains the same comma string the API has always received.
  const languageChips = languages
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input so re-picking the SAME file after a failure still fires.
    e.target.value = '';
    if (!file || photoUploading) return;

    setPhotoError(null);
    setPhotoUploading(true);

    // Show the local bytes immediately — the presign→PUT→confirm round trip is
    // slow on a phone, and an unchanged empty circle reads as "nothing
    // happened". Replaced by the server's signed url once confirmed.
    let objectUrl: string | null = null;
    try {
      const compressed = await compressImage(file);
      objectUrl = URL.createObjectURL(compressed);
      setPhotoPreview(objectUrl);

      const presign = await presignPhoto({
        fileName: file.name,
        mimeType: compressed.type || file.type,
        sizeBytes: compressed.size,
      });
      await uploadToPresignedUrl(presign.uploadUrl, compressed);
      const updated = await confirmPhoto(presign.key);

      setPhotoPreview(updated.photoUrl ?? null);
      // Lift it to the stepper's profile so steps 2-4 and a return to step 1
      // all see the saved photo.
      onProfileUpdate(updated);
      showToast({ message: tToast('photoUpdated') });
    } catch {
      // Drop the optimistic preview — leaving it would show a photo that is not
      // actually saved, which is the bug this whole change removes.
      setPhotoPreview(profile.photoUrl ?? null);
      setPhotoError(t('photoUploadError'));
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPhotoUploading(false);
    }
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

      {/* Profile photo — uploads on selection (presign → PUT → confirm) */}
      <div
        // Width-capped and centred: at the wider shell a full-bleed dropzone
        // became a long empty band around a small avatar. Capping it keeps the
        // target compact and deliberate rather than stretched.
        className="group mx-auto flex w-full max-w-md cursor-pointer flex-col items-center gap-3 rounded-[22px] border-2 border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-6 transition-all duration-200 hover:border-[#0F3D91]/40 hover:bg-[#E8F0FE]/40"
        onClick={() => !photoUploading && photoInputRef.current?.click()}
        aria-busy={photoUploading}
      >
        <div className="relative h-24 w-24">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-md transition-transform duration-200 group-hover:scale-105">
            {photoUploading ? (
              <BrandLoader size="sm" label={t('photoUploading')} />
            ) : photoPreview ? (
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
        {photoError && (
          <p role="alert" className="text-xs font-medium text-error-fg">
            {photoError}
          </p>
        )}
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

      {/*
        The swap. A phone signup verified their number to create the account,
        so this slot asks for the things they still lack — an address, then a
        password — instead of re-asking for the number they already proved.
        An email signup sees exactly what it always has.
      */}
      {showEmailVerify && (
        <EmailVerify
          onVerified={(email) => {
            setEmailVerified(true);
            onProfileUpdate({ ...profile, email });
            // Re-issue the token so it carries the now-verified email. This is
            // what releases the (app) shell's email-verification gate — without
            // it, a phone-signup whose token still says `email: null` would be
            // bounced back to onboarding forever. Fire-and-forget: the user
            // stays on this step, and the refreshed token lands well before they
            // reach the dashboard.
            void refreshSession();
          }}
        />
      )}

      {/* Phone verify — REQUIRED for an email signup: a verified mobile number
          gates advancing. A phone signup never sees it; theirs is already
          proven, and re-asking would demand the one thing they have shown. */}
      {showPhoneVerify && (
        <PhoneVerify
          initialPhone={profile.phone ?? ''}
          alreadyVerified={false}
          onVerified={(phone) => {
            setPhoneVerified(true);
            onProfileUpdate({ ...profile, phone });
          }}
        />
      )}

      {/* Only once there is an address to sign in with — Decision 2. Offering it
          earlier would let someone set a password on an account we cannot yet
          reach if they forget it. */}
      {showSetPassword && (
        <SetPassword
          onSet={() => {
            setPasswordSet(true);
            onProfileUpdate({ ...profile, hasPassword: true });
            // Re-issue the token so its `hasPassword` claim flips true — this is
            // what releases the app's onboarding gate (mirrors EmailVerify).
            void refreshSession();
          }}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-error-fg">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="brand"
          size="lg"
          loading={saving}
          disabled={!canAdvance}
          onClick={handleNext}
          className="rounded-xl px-8 shadow-md transition-all hover:shadow-lg"
        >
          {tStep('next')}
        </Button>
      </div>
    </div>
  );
}
