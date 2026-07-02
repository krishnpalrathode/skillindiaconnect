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
      <p className="text-sm text-neutral-500 text-center py-4">{t('noExperience')}</p>
    ) : (
      <ul className="flex flex-col gap-3">
        {experiences.map((exp) => (
          <li
            key={exp.id}
            className="flex items-start gap-3 p-3 rounded-lg border border-border bg-neutral-50"
          >
            <div className="shrink-0 w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center mt-0.5">
              {exp.type === 'FOREIGN' ? (
                <Globe className="size-4 text-primary-600" aria-hidden="true" />
              ) : (
                <Briefcase className="size-4 text-primary-600" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-neutral-800 truncate">{exp.role ?? '—'}</p>
              <p className="text-xs text-neutral-500 truncate">
                {[exp.companyName, exp.country].filter(Boolean).join(', ')}
              </p>
              {(exp.years !== undefined || exp.months !== undefined) && (
                <p className="text-xs text-neutral-400 mt-0.5">
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
