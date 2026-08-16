'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface EditableSectionProps {
  title: string;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  /**
   * Persists the section.
   *
   * Resolving is what triggers the "Changes saved" toast, so a handler that
   * CATCHES its own failure and renders an inline message must return `false`
   * — otherwise a failed save would announce success. Handlers that let the
   * error propagate need no return value; the throw is the failure signal.
   */
  onSave: () => Promise<void | boolean>;
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
  const tToast = useTranslations('toast');
  const { showToast } = useToast();

  const handleSave = async () => {
    let result: void | boolean;
    try {
      result = await onSave();
    } catch {
      // The save threw. Sections that own an inline error surface already
      // returned `false` instead of throwing, so reaching here means nothing
      // else is going to tell the user — which is exactly the silent failure
      // this toast exists to close.
      showToast({ message: tToast('saveFailed'), variant: 'error' });
      return;
    }
    // `false` = the handler failed and is showing its own message.
    if (result === false) return;
    showToast({ message: tToast('saved') });
  };

  return (
    <section
      aria-label={title}
      className={cn(
        'rounded-[18px] border border-neutral-200/70 bg-white shadow-sm',
        'transition-shadow duration-200 hover:shadow-md',
        className,
      )}
    >
      {/* Section header */}
      <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4 sm:px-6">
        <h2 className="text-lg font-bold tracking-tight text-neutral-900">{title}</h2>
        {!isEditing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={`${editLabel ?? t('edit')} ${title}`}
            className="min-h-10 gap-1.5 rounded-xl px-3.5 text-neutral-600 transition-colors hover:bg-[#E8F0FE] hover:text-[#0F3D91]"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {editLabel ?? t('edit')}
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="px-5 py-5 sm:px-6">
        {isEditing ? (
          <div className="flex flex-col gap-4">
            {form}
            <div className="flex justify-end gap-2 border-t border-neutral-100 pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={saving}
                className="min-h-10 rounded-xl px-4"
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="brand"
                size="sm"
                loading={saving}
                onClick={handleSave}
                className="min-h-10 rounded-xl px-5 shadow-sm transition-all hover:shadow-md"
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
