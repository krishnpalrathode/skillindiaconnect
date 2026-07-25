'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Globe, Briefcase } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { EditableSection } from '@/components/profile/EditableSection';
import { ExperienceList } from '@/components/onboarding/ExperienceList';

type CandidateProfile = components['schemas']['CandidateProfile'];
type WorkExperience = components['schemas']['WorkExperience'];

interface ExperienceSectionProps {
  profile: CandidateProfile;
  onProfileUpdate: (p: CandidateProfile) => void;
  onCompletionRefetch: () => Promise<void>;
}

export function ExperienceSection({
  profile,
  onProfileUpdate,
  onCompletionRefetch,
}: ExperienceSectionProps) {
  const t = useTranslations('onboarding.experience');
  const tSec = useTranslations('profile.sections');

  const [isEditing, setIsEditing] = useState(false);
  const [editExperiences, setEditExperiences] = useState<WorkExperience[]>([]);

  function openEdit() {
    setEditExperiences(profile.experiences ?? []);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  async function handleSave() {
    onProfileUpdate({ ...profile, experiences: editExperiences });
    await onCompletionRefetch();
    setIsEditing(false);
  }

  const experiences = profile.experiences ?? [];

  const viewContent =
    experiences.length === 0 ? (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <span
          className="flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-[#EEF3FB] to-[#E8F0FE] text-[#0F3D91]"
          aria-hidden="true"
        >
          <Briefcase className="size-6" />
        </span>
        <p className="max-w-xs text-sm text-neutral-600">{t('noExperience')}</p>
      </div>
    ) : (
      <ul className="flex flex-col gap-3">
        {experiences.map((exp) => (
          <li
            key={exp.id}
            className="flex items-start gap-3 rounded-2xl border border-neutral-200/70 bg-neutral-50/60 p-4 transition-all duration-200 hover:border-[#0F3D91]/20 hover:bg-white hover:shadow-sm"
          >
            <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE]">
              {exp.type === 'FOREIGN' ? (
                <Globe className="size-4 text-[#0F3D91]" aria-hidden="true" />
              ) : (
                <Briefcase className="size-4 text-[#0F3D91]" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-neutral-900">{exp.role ?? '—'}</p>
              <p className="truncate text-xs text-neutral-600">
                {[exp.companyName, exp.country].filter(Boolean).join(', ')}
              </p>
              {(exp.years !== undefined || exp.months !== undefined) && (
                <p className="mt-1 inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                  {[exp.years && `${exp.years}y`, exp.months && `${exp.months}m`]
                    .filter(Boolean)
                    .join(' ')}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    );

  const editForm = (
    <ExperienceList experiences={editExperiences} onExperiencesChange={setEditExperiences} />
  );

  return (
    <EditableSection
      title={tSec('workExperience')}
      isEditing={isEditing}
      onEdit={openEdit}
      onCancel={cancelEdit}
      onSave={handleSave}
      form={editForm}
    >
      {viewContent}
    </EditableSection>
  );
}
