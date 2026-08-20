import { ResumeViewDto } from '../resume-view.mapper';
import { renderSidebarResume } from './sidebar-family';

/**
 * CLASSIC — RAHUL SHARMA — near-black sidebar, orange accent, square photo frame. Darker and heavier than MODERN; the square frame and denser sidebar make it the most formal of the family.
 *
 * The LAYOUT lives in `sidebar-family.ts`; this file supplies only the theme.
 * The six templates in this family are one supplied design in six colourways,
 * so the structure is shared deliberately — see that file for why, and for the
 * list of sections the supplied artwork shows that the candidate profile has no
 * field for (education, certifications, skill meters, per-job bullet points).
 */
export function renderClassic(view: ResumeViewDto): string {
  return renderSidebarResume(view, {
    sidebar: '#111c2e',
    accent: '#ef7c1b',
    ink: '#111c2e',
    photo: 'rounded',
    layout: 'sidebar',
  });
}
