'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EditableSectionProps {
  title: string;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => Promise<void>;
  saving?: boolean;
  children: React.ReactNode;
  form: React.ReactNode;
  className?: string;
  editLabel?: string;
}

/**
 * Wrapper that gives every profile section a view↔edit toggle.
 * Parent component owns isEditing state and draft values.
 * Save calls the async onSave; Cancel reverts via parent's onCancel.
 */
export function EditableSection({
  title,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  saving = false,
  children,
  form,
  className,
  editLabel,
}: EditableSectionProps) {
  const t = useTranslations('common');

  const handleSave = async () => {
    await onSave();
  };

  return (
    <section
      aria-label={title}
      className={cn('bg-white rounded-xl border border-neutral-200 shadow-sm', className)}
    >
      {/* Section header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
        {!isEditing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={`${editLabel ?? t('edit')} ${title}`}
            className="gap-1.5 text-neutral-600"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {editLabel ?? t('edit')}
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="px-5 py-4">
        {isEditing ? (
          <div className="flex flex-col gap-4">
            {form}
            <div className="flex gap-2 justify-end pt-2 border-t border-neutral-100">
              <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={saving}
                onClick={handleSave}
              >
                {t('save')}
              </Button>
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
