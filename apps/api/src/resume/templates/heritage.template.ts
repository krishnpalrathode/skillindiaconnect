import { ResumeViewDto } from '../resume-view.mapper';
import { renderSidebarResume } from './sidebar-family';

/**
 * HERITAGE — SURESH KUMAR — violet sidebar with a circular photo. The most distinctive colourway; it stands out in a stack of navy CVs, which is the whole reason to pick it.
 *
 * The LAYOUT lives in `sidebar-family.ts`; this file supplies only the theme.
 * The six templates in this family are one supplied design in six colourways,
 * so the structure is shared deliberately — see that file for why, and for the
 * list of sections the supplied artwork shows that the candidate profile has no
 * field for (education, certifications, skill meters, per-job bullet points).
 */
export function renderHeritage(view: ResumeViewDto): string {
  return renderSidebarResume(view, {
    sidebar: '#4c2a86',
    accent: '#7c4dcc',
    ink: '#221434',
    photo: 'circle',
    layout: 'sidebar',
  });
}
