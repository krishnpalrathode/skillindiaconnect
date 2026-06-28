'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2, Briefcase, Globe } from 'lucide-react';
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
    <div className="flex flex-col gap-3">
      {experiences.length === 0 && !adding && (
        <p className="text-sm text-neutral-500 text-center py-4 rounded-lg border border-dashed border-neutral-200">
          {t('noExperience')}
        </p>
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
            className="flex items-start gap-3 p-3 rounded-lg border border-border bg-background"
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

            <div className="flex gap-1 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setEditing(exp.id)}
                aria-label={`${t('editExperience')} ${exp.role ?? ''}`}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-error-fg hover:bg-error-bg"
                loading={deletingId === exp.id}
                onClick={() => handleDelete(exp.id)}
                aria-label={`${t('deleteExperience')} ${exp.role ?? ''}`}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
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
          className="self-start"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('addExperience')}
        </Button>
      )}
    </div>
  );
}
