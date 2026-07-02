'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Plus } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { cn } from '@/lib/utils';
import { postSkill, deleteSkill } from '@/lib/api/candidate';

type CandidateSkill = components['schemas']['CandidateSkill'];

const MAX_SKILLS = 10;

interface SkillChipsProps {
  skills: CandidateSkill[];
  onSkillsChange: (skills: CandidateSkill[]) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Inline skill tag input.
 * Type a skill name and press Enter or comma to add.
 * Tap × on a chip to remove.
 * First 3 skills boost the match score; beyond that, shown in neutral.
 */
export function SkillChips({ skills, onSkillsChange, placeholder, className }: SkillChipsProps) {
  const t = useTranslations('onboarding.documentsSkills');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const addSkill = async (raw: string) => {
    const name = raw.trim();
    if (!name || skills.length >= MAX_SKILLS) return;
    if (skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;

    setBusy(true);
    try {
      const skill = await postSkill(name);
      onSkillsChange([...skills, skill]);
      setInput('');
    } finally {
      setBusy(false);
    }
  };

  const removeSkill = async (id: string) => {
    setBusy(true);
    try {
      await deleteSkill(id);
      onSkillsChange(skills.filter((s) => s.id !== id));
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addSkill(input);
    }
    if (e.key === 'Backspace' && !input && skills.length > 0) {
      const last = skills[skills.length - 1]!;
      removeSkill(last.id);
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Chips container */}
      <div
        className={cn(
          'flex flex-wrap gap-1.5 min-h-[44px] p-2 rounded-md border border-input bg-background',
          'focus-within:ring-[3px] focus-within:ring-ring/70 focus-within:border-primary-600',
          'transition-colors',
        )}
      >
        {skills.map((skill, idx) => (
          <span
            key={skill.id}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
              idx < 3 ? 'bg-primary-100 text-primary-700' : 'bg-neutral-100 text-neutral-600',
            )}
          >
            {skill.name}
            <button
              type="button"
              disabled={busy}
              onClick={() => removeSkill(skill.id)}
              aria-label={`Remove skill ${skill.name}`}
              className="rounded-full hover:bg-black/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}

        {skills.length < MAX_SKILLS && (
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => input.trim() && addSkill(input)}
            disabled={busy}
            placeholder={skills.length === 0 ? (placeholder ?? t('skillsPlaceholder')) : ''}
            className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-neutral-400 disabled:opacity-50"
            aria-label={t('skillsLabel')}
          />
        )}
      </div>

      {/* Add button for mobile */}
      {input.trim() && (
        <button
          type="button"
          disabled={busy}
          onClick={() => addSkill(input)}
          className="flex items-center gap-1 text-xs text-primary-600 hover:underline self-start"
        >
          <Plus className="size-3" aria-hidden="true" />
          Add &ldquo;{input.trim()}&rdquo;
        </button>
      )}

      <p className="text-xs text-neutral-500">{t('skillsHint')}</p>
    </div>
  );
}
