import { ResumeViewDto } from '../resume-view.mapper';
import { renderSidebarResume } from './sidebar-family';

/**
 * COMPACT — VIKAS YADAV — the one STRUCTURAL variant: identity moves into a full-width teal band across the top and the body runs single-column beneath it. More room per line, so it suits a candidate with several roles.
 *
 * The LAYOUT lives in `sidebar-family.ts`; this file supplies only the theme.
 * The six templates in this family are one supplied design in six colourways,
 * so the structure is shared deliberately — see that file for why, and for the
 * list of sections the supplied artwork shows that the candidate profile has no
 * field for (education, certifications, skill meters, per-job bullet points).
 */
export function renderCompact(view: ResumeViewDto): string {
  return renderSidebarResume(view, {
    sidebar: '#12414f',
    accent: '#17a2a2',
    ink: '#10242b',
    photo: 'rounded',
    layout: 'band',
  });
}
