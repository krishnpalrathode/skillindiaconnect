'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';
import { EditableSection } from '@/components/profile/EditableSection';
import { SkillChips } from '@/components/onboarding/SkillChips';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CandidateSkill = components['schemas']['CandidateSkill'];

interface SkillsSectionProps {
  profile: CandidateProfile;
  onProfileUpdate: (p: CandidateProfile) => void;
  onCompletionRefetch: () => Promise<void>;
}

export function SkillsSection({
  profile,
  onProfileUpdate,
  onCompletionRefetch,
}: SkillsSectionProps) {
  const t = useTranslations('onboarding.documentsSkills');
  const tSec = useTranslations('profile.sections');

  const [isEditing, setIsEditing] = useState(false);
  const [editSkills, setEditSkills] = useState<CandidateSkill[]>([]);

  function openEdit() {
    setEditSkills(profile.skills ?? []);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  async function handleSave() {
    onProfileUpdate({ ...profile, skills: editSkills });
    await onCompletionRefetch();
    setIsEditing(false);
  }

  const skills = profile.skills ?? [];

  const viewContent =
    skills.length === 0 ? (
      <p className="py-8 text-center text-sm text-neutral-600">{t('softBlockSkills')}</p>
    ) : (
      <div className="flex flex-wrap gap-2">
        {skills.map((skill, idx) => (
          <span
            key={skill.id}
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${
              idx < 3
                ? 'bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] text-white'
                : 'bg-neutral-100 text-neutral-700'
            }`}
          >
            {skill.name}
          </span>
        ))}
      </div>
    );

  const editForm = <SkillChips skills={editSkills} onSkillsChange={setEditSkills} />;

  return (
    <EditableSection
      title={tSec('skills')}
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
