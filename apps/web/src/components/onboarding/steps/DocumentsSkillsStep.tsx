'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdvance =
    location.trim().length > 0 && nationality.trim().length > 0 && noticePeriod.trim().length > 0;

  const hasPassport = (profile.documents ?? []).some((d) => d.type === 'PASSPORT');
  const hasSkills = (profile.skills?.length ?? 0) > 0;

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
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-neutral-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-neutral-500">{t('subtitle')}</p>
      </div>

      {/* Required location fields */}
      <div className="flex flex-col gap-4">
        <Field id="ds-location" label={t('locationLabel')} required>
          <Input
            placeholder={t('locationPlaceholder')}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>

        <Field id="ds-nationality" label={t('nationalityLabel')} required>
          <Input
            placeholder={t('nationalityPlaceholder')}
            value={nationality}
            onChange={(e) => setNationality(e.target.value)}
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
          />
        </Field>
      </div>

      {/* Documents section */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-neutral-700">{t('passportLabel')}</h3>

        {/* Show existing passport if uploaded */}
        {hasPassport ? (
          <div className="flex flex-wrap gap-2">
            {(profile.documents ?? [])
              .filter((d) => d.type === 'PASSPORT')
              .map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-neutral-50 text-sm"
                >
                  <span className="text-neutral-700">Passport</span>
                  <Badge variant={DOC_STATUS_VARIANT[d.status]}>{tStatus(d.status)}</Badge>
                </div>
              ))}
          </div>
        ) : (
          <FileUpload
            docType="PASSPORT"
            accept=".pdf,image/jpeg,image/png"
            maxMb={10}
            label={t('passportLabel')}
            hint={t('passportHint')}
            onDone={() => {
              // Document confirmation updates profile.documents; re-fetch completion on page
              onProfileUpdate({
                ...profile,
                documents: [...(profile.documents ?? [])],
              });
            }}
          />
        )}

        {!hasPassport && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-info-bg border border-info-fg/20">
            <Info className="size-4 text-info-fg shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-info-fg">{t('softBlockDocs')}</p>
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
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-neutral-700">{t('skillsLabel')}</h3>
        <SkillChips
          skills={profile.skills ?? []}
          onSkillsChange={handleSkillsChange}
          placeholder={t('skillsPlaceholder')}
        />
        {!hasSkills && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-info-bg border border-info-fg/20">
            <Info className="size-4 text-info-fg shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-info-fg">{t('softBlockSkills')}</p>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-error-fg">
          {error}
        </p>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" size="md" onClick={onBack}>
          {tNav('back')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          loading={saving}
          disabled={!canAdvance}
          onClick={handleNext}
        >
          {tNav('next')}
        </Button>
      </div>
    </div>
  );
}
