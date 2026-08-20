import { ResumeViewDto } from '../resume-view.mapper';
import { renderSidebarResume } from './sidebar-family';

/**
 * MODERN — ARUN KUMAR — deep navy sidebar with an orange accent. The most conservative of the six and the default for that reason: navy reads as formal to Gulf employers and the orange is confined to rules and the surname.
 *
 * The LAYOUT lives in `sidebar-family.ts`; this file supplies only the theme.
 * The six templates in this family are one supplied design in six colourways,
 * so the structure is shared deliberately — see that file for why, and for the
 * list of sections the supplied artwork shows that the candidate profile has no
 * field for (education, certifications, skill meters, per-job bullet points).
 */
export function renderModern(view: ResumeViewDto): string {
  return renderSidebarResume(view, {
    sidebar: '#0d2b4e',
    accent: '#f07d1a',
    ink: '#16202e',
    photo: 'rounded',
    layout: 'sidebar',
  });
}
