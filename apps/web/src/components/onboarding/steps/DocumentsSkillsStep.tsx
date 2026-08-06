'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info, FileText, Sparkles, MapPin } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { FileUpload } from '@/components/upload/FileUpload';
import { SkillChips } from '@/components/onboarding/SkillChips';
import { patchCandidateProfile } from '@/lib/api/candidate';
import type { PatchCandidateBody } from '@/lib/api/candidate';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CandidateSkill = components['schemas']['CandidateSkill'];
type DocumentStatus = components['schemas']['DocumentStatus'];

const DOC_STATUS_VARIANT: Record<DocumentStatus, 'success' | 'warning' | 'error'> = {
  VERIFIED: 'success',
  PENDING: 'warning',
  REJECTED: 'error',
};

interface DocumentsSkillsStepProps {
  profile: CandidateProfile;
  onProfileUpdate: (updated: CandidateProfile) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Step 3 — Documents & Skills.
 * Required to advance: currentLocation + nationality + noticePeriod.
 * Soft-block (non-blocking): documents, skills.
 * Document uploads happen immediately via useUpload (presign → R2 → confirm).
 */
export function DocumentsSkillsStep({
  profile,
  onProfileUpdate,
  onNext,
  onBack,
}: DocumentsSkillsStepProps) {
  const t = useTranslations('onboarding.documentsSkills');
  const tNav = useTranslations('onboarding.nav');
  const tStatus = useTranslations('onboarding.documentsSkills.documentStatus');

  const [location, setLocation] = useState(profile.currentLocation ?? '');
  const [nationality, setNationality] = useState(profile.nationality ?? '');
  const [noticePeriod, setNoticePeriod] = useState(
    profile.noticePeriod !== undefined ? String(profile.noticePeriod) : '',
  );
  const [passportExpiry, setPassportExpiry] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdvance =
    location.trim().length > 0 && nationality.trim().length > 0 && noticePeriod.trim().length > 0;

  const hasPassport = (profile.documents ?? []).some((d) => d.type === 'PASSPORT');
  const hasSkills = (profile.skills?.length ?? 0) > 0;

  // Passport expiry must be in the future — a back-dated (already-expired)
  // passport can't be used to apply. YYYY-MM-DD strings compare chronologically.
  const todayIso = new Date().toISOString().slice(0, 10);
  const passportExpiryIsPast = passportExpiry !== '' && passportExpiry < todayIso;

  const handleSkillsChange = (skills: CandidateSkill[]) => {
    onProfileUpdate({ ...profile, skills });
  };

  const handleNext = async () => {
    if (!canAdvance) return;
    setError(null);
    setSaving(true);

    const patch: PatchCandidateBody = {
      currentLocation: location.trim(),
      nationality: nationality.trim(),
      noticePeriod: Number(noticePeriod),
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

      {/* Required location fields */}
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#E8F0FE] text-[#0F3D91]">
            <MapPin className="size-4" aria-hidden="true" />
          </span>
          <h3 className="text-sm font-bold text-neutral-800">{t('locationLabel')}</h3>
        </div>

        <Field id="ds-location" label={t('locationLabel')} required>
          <Input
            placeholder={t('locationPlaceholder')}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>

        <Field id="ds-nationality" label={t('nationalityLabel')} required>
          <Input
            placeholder={t('nationalityPlaceholder')}
            value={nationality}
            onChange={(e) => setNationality(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>

        <Field
          id="ds-notice"
          label={t('noticePeriodLabel')}
          hint={t('noticePeriodPlaceholder')}
          required
        >
          <Input
            type="number"
            min={0}
            max={365}
            placeholder="30"
            value={noticePeriod}
            onChange={(e) => setNoticePeriod(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>
      </div>

      {/* Documents section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#E8F0FE] text-[#0F3D91]">
            <FileText className="size-4" aria-hidden="true" />
          </span>
          <h3 className="text-sm font-bold text-neutral-800">{t('passportLabel')}</h3>
        </div>

        {/* Show existing passport if uploaded */}
        {hasPassport ? (
          <div className="flex flex-wrap gap-2">
            {(profile.documents ?? [])
              .filter((d) => d.type === 'PASSPORT')
              .map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 rounded-xl border border-neutral-200/70 bg-white px-4 py-2.5 text-sm shadow-sm"
                >
                  <FileText className="size-4 text-[#0F3D91]" aria-hidden="true" />
                  <span className="font-medium text-neutral-700">Passport</span>
                  <Badge variant={DOC_STATUS_VARIANT[d.status]}>{tStatus(d.status)}</Badge>
                </div>
              ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field
              id="ds-passport-expiry"
              label={t('passportExpiryLabel')}
              required
              error={passportExpiryIsPast ? t('passportExpiryPast') : undefined}
            >
              <Input
                type="date"
                value={passportExpiry}
                min={todayIso}
                onChange={(e) => setPassportExpiry(e.target.value)}
                className="h-12 rounded-xl"
              />
            </Field>
            <FileUpload
              docType="PASSPORT"
              accept=".pdf,image/jpeg,image/png"
              maxMb={10}
              label={t('passportLabel')}
              hint={passportExpiry ? t('passportHint') : t('passportExpiryRequired')}
              expiryDate={passportExpiry || undefined}
              onDone={() => {
                onProfileUpdate({
                  ...profile,
                  documents: [...(profile.documents ?? [])],
                });
              }}
            />
          </div>
        )}

        {!hasPassport && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-info-fg/20 bg-info-bg p-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
              <Info className="size-4 text-info-fg" aria-hidden="true" />
            </span>
            <p className="text-xs leading-relaxed text-info-fg">{t('softBlockDocs')}</p>
          </div>
        )}

        {/* Additional docs */}
        <FileUpload
          docType="EXPERIENCE_CERT"
          accept=".pdf,image/jpeg,image/png"
          maxMb={5}
          label={t('experienceCertLabel')}
          hint={t('experienceCertHint')}
        />
        <FileUpload
          docType="EDUCATIONAL_CERT"
          accept=".pdf,image/jpeg,image/png"
          maxMb={5}
          label={t('educationalCertLabel')}
          hint={t('educationalCertHint')}
        />
      </div>

      {/* Skills section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-600">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <h3 className="text-sm font-bold text-neutral-800">{t('skillsLabel')}</h3>
        </div>
        <SkillChips
          skills={profile.skills ?? []}
          onSkillsChange={handleSkillsChange}
          placeholder={t('skillsPlaceholder')}
        />
        {!hasSkills && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-info-fg/20 bg-info-bg p-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
              <Info className="size-4 text-info-fg" aria-hidden="true" />
            </span>
            <p className="text-xs leading-relaxed text-info-fg">{t('softBlockSkills')}</p>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-error-fg">
          {error}
        </p>
      )}

      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onBack}
          className="rounded-xl px-6"
        >
          {tNav('back')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          loading={saving}
          disabled={!canAdvance}
          onClick={handleNext}
          className="rounded-xl bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] px-8 shadow-md transition-all hover:shadow-lg"
        >
          {tNav('next')}
        </Button>
      </div>
    </div>
  );
}
