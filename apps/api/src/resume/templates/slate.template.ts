import { ResumeViewDto } from '../resume-view.mapper';
import { renderSidebarResume } from './sidebar-family';

/**
 * SLATE — MOHAMMED IRFAN — forest green sidebar with a circular photo. Green is the one non-corporate colour in the set and photographs well in print; the circle softens it for trades where the employer meets the worker face to face.
 *
 * The LAYOUT lives in `sidebar-family.ts`; this file supplies only the theme.
 * The six templates in this family are one supplied design in six colourways,
 * so the structure is shared deliberately — see that file for why, and for the
 * list of sections the supplied artwork shows that the candidate profile has no
 * field for (education, certifications, skill meters, per-job bullet points).
 */
export function renderSlate(view: ResumeViewDto): string {
  return renderSidebarResume(view, {
    sidebar: '#14513c',
    accent: '#1f8a5f',
    ink: '#12211b',
    photo: 'circle',
    layout: 'sidebar',
  });
}
