'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Eye, Briefcase, Sparkles, FileText } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { buildResumePreview } from '@/lib/resume/resumeViewModel';

type CandidateProfile = components['schemas']['CandidateProfile'];
type ResumeSettings = components['schemas']['ResumeSettings'];

interface ResumePreviewProps {
  profile: CandidateProfile;
  settings: ResumeSettings;
}

/** A labelled field row — omitted entirely when the value is absent (honest
 *  partial state: a sparse profile shows a sparse preview). */
function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-32 shrink-0 text-neutral-600">{label}</dt>
      <dd className="flex-1 font-medium text-neutral-900">{value}</dd>
    </div>
  );
}

/** Section heading with a small icon tile — presentation only. */
function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h4 className="flex items-center gap-2 text-sm font-bold text-neutral-800">
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#E8F0FE] text-[#0F3D91]"
        aria-hidden="true"
      >
        {icon}
      </span>
      {children}
    </h4>
  );
}

/**
 * The live resume PREVIEW (S7-F1). Renders from profile data in the browser
 * (fast, interactive), reflecting the CURRENT Resume Settings via
 * `buildResumePreview` — the same omission rules the server applies to the PDF
 * bytes, so the preview shows what the PDF WILL contain.
 *
 * It is explicitly a PREVIEW, not the artifact: a subtle banner says so, and a
 * settings change updates it live (but does not retroactively change an
 * already-generated PDF — "regenerate to apply", surfaced by the hub).
 *
 * The structure is real text (a `<dl>` + sections), not an image — screen
 * readers and the constrained profile read it directly.
 */
export function ResumePreview({ profile, settings }: ResumePreviewProps) {
  const t = useTranslations('resume.preview');
  const v = buildResumePreview(profile, settings);

  const hasIdentity =
    v.dob || v.maritalStatus || v.nationality || v.currentLocation || v.languages.length > 0;

  return (
    <section aria-label={t('ariaLabel')} className="flex flex-col gap-4">
      {/* PREVIEW banner — never mistake this for the downloadable PDF. */}
      <p className="flex items-center gap-2 rounded-xl border border-accent-200 bg-accent-50 px-4 py-2.5 text-xs font-medium text-accent-700">
        <Eye className="size-4 shrink-0" aria-hidden="true" />
        {t('previewLabel')}
      </p>

      <article className="overflow-hidden rounded-[22px] border border-neutral-200/70 bg-white shadow-md">
        {/* Header — name + always-on contact (email) + toggle-governed phone. */}
        <header className="border-b border-neutral-100 bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] px-6 py-5">
          <h3 className="text-xl font-bold text-white">{v.fullName || t('unnamed')}</h3>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-white/85">
            <span>{v.email}</span>
            {v.phone && <span>{v.phone}</span>}
          </div>
        </header>

        <div className="flex flex-col gap-5 p-6">
          {/* The intro, above everything — the one place the candidate speaks in
              their own words, so it leads the document exactly as it does in
              each PDF template. Absent, not empty, when unwritten. */}
          {v.summary && (
            <p className="border-s-[3px] border-[#0F3D91] ps-3 text-sm leading-relaxed text-neutral-700">
              {v.summary}
            </p>
          )}

          {/* Personal details — each row self-omits when absent. */}
          {(hasIdentity || v.fatherName || v.religion || v.passportNumber) && (
            <dl className="flex flex-col gap-1.5">
              <Row label={t('fatherName')} value={v.fatherName} />
              <Row label={t('dob')} value={v.dob ?? undefined} />
              <Row label={t('maritalStatus')} value={v.maritalStatus} />
              <Row label={t('nationality')} value={v.nationality} />
              <Row label={t('currentLocation')} value={v.currentLocation} />
              <Row label={t('religion')} value={v.religion} />
              <Row label={t('passportNumber')} value={v.passportNumber} />
              {v.languages.length > 0 && (
                <Row label={t('languages')} value={v.languages.join(', ')} />
              )}
            </dl>
          )}

          {/* Experience */}
          <section className="border-t border-neutral-100 pt-4">
            <SectionHeading icon={<Briefcase className="size-3.5" />}>
              {t('experience')}
            </SectionHeading>
            {v.experiences.length === 0 ? (
              <p className="mt-1.5 text-sm text-neutral-600">{t('noExperience')}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {v.experiences.map((exp) => (
                  <li key={exp.id} className="text-sm">
                    <span className="font-semibold text-neutral-900">{exp.role}</span>
                    {exp.companyName && (
                      <span className="text-neutral-600"> · {exp.companyName}</span>
                    )}
                    {exp.country && <span className="text-neutral-600"> · {exp.country}</span>}
                    <span className="text-neutral-600">
                      {' '}
                      · {t('years', { years: exp.years ?? 0, months: exp.months ?? 0 })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Skills */}
          <section className="border-t border-neutral-100 pt-4">
            <SectionHeading icon={<Sparkles className="size-3.5" />}>{t('skills')}</SectionHeading>
            {v.skills.length === 0 ? (
              <p className="mt-1.5 text-sm text-neutral-600">{t('noSkills')}</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {v.skills.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-full bg-[#E8F0FE] px-3 py-1 text-xs font-medium text-[#0F3D91]"
                  >
                    {s.name}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Documents — status-only summary (type + validity), never keys/urls. */}
          {v.documents.length > 0 && (
            <section className="border-t border-neutral-100 pt-4">
              <SectionHeading icon={<FileText className="size-3.5" />}>
                {t('documents')}
              </SectionHeading>
              <ul className="mt-2 flex flex-col gap-1">
                {v.documents.map((d) => (
                  <li key={d.type} className="flex items-center gap-2 text-sm text-neutral-700">
                    <span>{t(`docType.${d.type}` as never)}</span>
                    {d.type === 'PASSPORT' && (
                      <span
                        className={
                          d.passportValid ? 'text-xs text-success-fg' : 'text-xs text-error-fg'
                        }
                      >
                        {d.passportValid ? t('passportValid') : t('passportExpired')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </article>
    </section>
  );
}
