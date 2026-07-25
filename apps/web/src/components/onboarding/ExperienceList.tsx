'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2, Briefcase, Globe, FolderOpen } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Button } from '@/components/ui/button';
import { ExperienceForm } from './ExperienceForm';
import { deleteExperience } from '@/lib/api/candidate';

type WorkExperience = components['schemas']['WorkExperience'];

interface ExperienceListProps {
  experiences: WorkExperience[];
  onExperiencesChange: (exps: WorkExperience[]) => void;
}

/**
 * CRUD list of work experience entries.
 * Add → ExperienceForm (inline below list).
 * Edit → ExperienceForm replaces the row.
 * Delete → DELETE /candidates/me/experiences/:id, then removes from local state.
 */
export function ExperienceList({ experiences, onExperiencesChange }: ExperienceListProps) {
  const t = useTranslations('onboarding.experience');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleSaved = (exp: WorkExperience) => {
    if (editing) {
      onExperiencesChange(experiences.map((e) => (e.id === exp.id ? exp : e)));
      setEditing(null);
    } else {
      onExperiencesChange([...experiences, exp]);
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteExperience(id);
      onExperiencesChange(experiences.filter((e) => e.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {experiences.length === 0 && !adding && (
        <div className="flex flex-col items-center gap-3 rounded-[22px] border-2 border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-10 text-center">
          <span
            className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-[#EEF3FB] to-[#E8F0FE] text-[#0F3D91] ring-8 ring-[#F5F8FC]"
            aria-hidden="true"
          >
            <FolderOpen className="size-7" />
          </span>
          <p className="max-w-xs text-sm text-neutral-600">{t('noExperience')}</p>
        </div>
      )}

      {experiences.map((exp) =>
        editing === exp.id ? (
          <ExperienceForm
            key={exp.id}
            existing={exp}
            onSaved={handleSaved}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div
            key={exp.id}
            className="flex items-start gap-3 rounded-2xl border border-neutral-200/70 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0F3D91]/20 hover:shadow-md"
          >
            <div className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE]">
              {exp.type === 'FOREIGN' ? (
                <Globe className="size-5 text-[#0F3D91]" aria-hidden="true" />
              ) : (
                <Briefcase className="size-5 text-[#0F3D91]" aria-hidden="true" />
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

            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg text-neutral-600 hover:bg-[#E8F0FE] hover:text-[#0F3D91]"
                onClick={() => setEditing(exp.id)}
                aria-label={`${t('editExperience')} ${exp.role ?? ''}`}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg text-error-fg hover:bg-error-bg"
                loading={deletingId === exp.id}
                onClick={() => handleDelete(exp.id)}
                aria-label={`${t('deleteExperience')} ${exp.role ?? ''}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ),
      )}

      {adding && <ExperienceForm onSaved={handleSaved} onCancel={() => setAdding(false)} />}

      {!adding && !editing && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
          className="min-h-11 self-center rounded-xl border-[#0F3D91]/25 px-5 font-semibold text-[#0F3D91] transition-all hover:bg-[#E8F0FE] hover:shadow-sm sm:self-start"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('addExperience')}
        </Button>
      )}
    </div>
  );
}
