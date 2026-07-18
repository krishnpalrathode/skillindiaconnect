'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@skillindiaconnect/shared-types';

type CandidateSkill = components['schemas']['CandidateSkill'];

interface SkillsListProps {
  skills: CandidateSkill[];
}

/** Candidate skills as chips. Renders nothing when the list is empty. */
export function SkillsList({ skills }: SkillsListProps) {
  const t = useTranslations('employer.candidates.view');

  if (skills.length === 0) return null;

  return (
    <section
      aria-labelledby="candidate-skills-heading"
      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <h2 id="candidate-skills-heading" className="mb-3 text-base font-semibold text-neutral-900">
        {t('skillsTitle')}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {skills.map((skill) => (
          <li
            key={skill.id}
            className="rounded-md bg-primary-50 px-2.5 py-1 text-sm font-medium text-primary-700"
          >
            {skill.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
