'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Check, LayoutTemplate } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { patchResumeSettings } from '@/lib/api/resume';
import { cn } from '@/lib/utils';

type ResumeSettings = components['schemas']['ResumeSettings'];
type ResumeTemplate = ResumeSettings['template'];

/**
 * The order the gallery presents.
 *
 * The first SIX are one supplied photo-led design in six colourways (COMPACT
 * being the structural variant — a banner across the top instead of a
 * sidebar). They lead because that is the design the product chose, and MODERN
 * heads them as the recommended one. EXECUTIVE and TIMELINE follow: they are
 * the two genuinely different layouts left, so they belong after the family
 * rather than interleaved with it.
 *
 * Note the six are no longer ordered by how CONSERVATIVE they are — that was
 * the old rationale and it stopped being true when they became colour choices
 * rather than different documents. A candidate picking among them is picking a
 * colour, which is why the copy in `resume.templates.descriptions` names the
 * colour instead of claiming a different structure.
 *
 * EIGHT, deliberately: the grid is four columns, so eight tiles fill two rows
 * exactly and a ninth would sit alone in a half-empty third row.
 *
 * ELEGANT is the one left out. It is not deleted — its enum value and renderer
 * both remain, so a candidate who already chose it still gets that resume — it
 * is simply no longer OFFERED. It is the tile the eight-slot grid costs us, and
 * of the three older layouts it is the most decorative and the least suited to
 * this audience.
 */
const TEMPLATES: ResumeTemplate[] = [
  'MODERN',
  'CLASSIC',
  'SLATE',
  'HERITAGE',
  'COMPACT',
  'MINIMAL',
  'EXECUTIVE',
  'TIMELINE',
];
const RECOMMENDED: ResumeTemplate = 'MODERN';

/** Committed, generated from the REAL templates. See the folder's README. */
const PREVIEW: Record<ResumeTemplate, string> = {
  CLASSIC: '/resume-templates/classic.jpg',
  MODERN: '/resume-templates/modern.jpg',
  COMPACT: '/resume-templates/compact.jpg',
  MINIMAL: '/resume-templates/minimal.jpg',
  ELEGANT: '/resume-templates/elegant.jpg',
  EXECUTIVE: '/resume-templates/executive.jpg',
  TIMELINE: '/resume-templates/timeline.jpg',
  SLATE: '/resume-templates/slate.jpg',
  HERITAGE: '/resume-templates/heritage.jpg',
};

interface TemplateGalleryProps {
  settings: ResumeSettings;
  /** Optimistically apply, and roll back on a failed PATCH. */
  onSettingsChange: (next: ResumeSettings) => void;
  /** Fired after the PATCH commits — the hub surfaces "regenerate to apply". */
  onCommitted?: () => void;
}

/**
 * The template gallery (CR-001 F2) — mounts into the export hub beside the
 * settings panel, so it serves BOTH the onboarding step and the standalone page.
 *
 * A GALLERY, NOT A <select>. The candidate is choosing a document layout; a
 * dropdown of four words tells them nothing about what they are choosing.
 *
 * SEMANTICALLY A RADIO GROUP, built from real <input type="radio"> inside
 * <label>. Native radios give arrow-key navigation, roving focus, selection
 * announcement and grouping for free — a div with role="radio" has to
 * reimplement all of that, and usually gets the tabindex handling wrong.
 *
 * THE PREVIEW IMAGES SHOW THE LOOK; the live ResumePreview below shows the
 * candidate's own DATA. Deliberately NOT re-skinned per template: that preview
 * is a client-side approximation (the app already says "download the PDF for
 * the final document"), and four client replicas of four server templates would
 * drift from the PDF they claim to represent. One renderer of record — the PDF.
 *
 * Selecting NEVER triggers a generation. It is a settings change like any other:
 * PATCH, then the hub's existing RegeneratePrompt asks the candidate to
 * regenerate, because an already-generated PDF is stale until they do.
 */
export function TemplateGallery({ settings, onSettingsChange, onCommitted }: TemplateGalleryProps) {
  const t = useTranslations('resume.templates');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function select(template: ResumeTemplate) {
    if (template === settings.template || saving) return;
    const prev = settings;
    onSettingsChange({ ...settings, template }); // optimistic
    setSaving(true);
    setError(null);
    try {
      const updated = await patchResumeSettings({ template });
      onSettingsChange(updated);
      onCommitted?.();
    } catch {
      // Roll the selection back. A card left visually checked after a rejected
      // save would have the candidate regenerate believing they chose Compact
      // and receive Classic, with no error anywhere.
      onSettingsChange(prev);
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  /*
    The offered list, plus the candidate's current choice if it is not on it.

    Without this, anyone still on a retired template (ELEGANT) would open the
    gallery, see no tile selected, and have no way to tell what their resume
    currently looks like.
  */
  const visibleTemplates = TEMPLATES.includes(settings.template)
    ? TEMPLATES
    : [...TEMPLATES, settings.template];

  return (
    <section className="flex flex-col gap-2.5">
      <h4 className="flex items-center gap-2.5 text-sm font-bold text-neutral-800">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#E8F0FE] text-[#0F3D91]">
          <LayoutTemplate className="size-4" aria-hidden="true" />
        </span>
        {t('title')}
      </h4>
      <p className="text-xs text-neutral-600">{t('subtitle')}</p>

      <fieldset
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        disabled={saving}
        aria-describedby="template-gallery-hint"
      >
        <legend className="sr-only">{t('title')}</legend>

        {visibleTemplates.map((template) => {
          const checked = settings.template === template;
          const name = t(`names.${template}`);
          const description = t(`descriptions.${template}`);
          const isRecommended = template === RECOMMENDED;

          return (
            <label
              key={template}
              className={cn(
                'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border-2 bg-white transition-all',
                // Selection is NOT signalled by colour alone (WCAG 1.4.1) —
                // the border weight changes and a check mark appears.
                checked
                  ? 'border-[#0F3D91] shadow-md'
                  : 'border-neutral-200 hover:border-neutral-300',
                saving && 'cursor-wait opacity-70',
                'focus-within:outline-none focus-within:ring-[3px] focus-within:ring-ring/70',
              )}
            >
              <input
                type="radio"
                name="resume-template"
                value={template}
                checked={checked}
                onChange={() => void select(template)}
                // Visually hidden, NOT display:none — a hidden-by-display radio
                // is removed from the tab order and arrow keys stop working.
                className="sr-only"
                // The accessible name carries the description too, so a screen
                // reader user gets what sighted users get from the card.
                aria-label={`${name} — ${description}`}
              />

              <span className="relative block aspect-[794/1123] w-full bg-neutral-50">
                <Image
                  src={PREVIEW[template]}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 45vw, 22vw"
                  className="object-cover object-top"
                />
                {checked && (
                  <span className="absolute end-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-[#0F3D91] text-white shadow">
                    <Check className="size-4" aria-hidden="true" />
                  </span>
                )}
              </span>

              <span className="flex flex-col gap-0.5 px-2.5 py-2">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-neutral-800">{name}</span>
                  {isRecommended && (
                    <span className="rounded-full bg-[#E8F0FE] px-1.5 py-0.5 text-[10px] font-bold text-[#0F3D91]">
                      {t('recommended')}
                    </span>
                  )}
                </span>
                <span className="text-[11px] leading-snug text-neutral-600">{description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {/* neutral-600, not 500: this is body text and 500 fails WCAG 1.4.3. */}
      <p id="template-gallery-hint" className="text-xs text-neutral-600">
        {t('applyHint')}
      </p>

      {error && (
        <p role="alert" className="text-xs text-error-fg">
          {error}
        </p>
      )}
    </section>
  );
}
