import { ResumeViewDto } from '../resume-view.mapper';
import { renderSidebarResume } from './sidebar-family';

/**
 * MINIMAL — AJAY SINGH — amber sidebar with a circular photo. The warmest of the set; the lightest sidebar tint of the six, so it uses the least toner of the sidebar layouts.
 *
 * The LAYOUT lives in `sidebar-family.ts`; this file supplies only the theme.
 * The six templates in this family are one supplied design in six colourways,
 * so the structure is shared deliberately — see that file for why, and for the
 * list of sections the supplied artwork shows that the candidate profile has no
 * field for (education, certifications, skill meters, per-job bullet points).
 */
export function renderMinimal(view: ResumeViewDto): string {
  return renderSidebarResume(view, {
    sidebar: '#c2560c',
    accent: '#ef7c1b',
    ink: '#2a1a10',
    photo: 'circle',
    layout: 'sidebar',
  });
}
