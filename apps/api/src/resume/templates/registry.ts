import { Logger } from '@nestjs/common';
import { ResumeTemplate } from '@prisma/client';
import { ResumeViewDto } from '../resume-view.mapper';
import { renderResumeHtml } from './resume.template';

/**
 * A template is a PURE function of the ResumeView and nothing else.
 *
 * This signature is the privacy design expressed as a type. `resume-view.mapper`
 * omits a hidden field by DELETING IT FROM THE OBJECT, so a renderer that can
 * only see a `ResumeViewDto` cannot reach the data the mapper withheld — there
 * is no profile, no Prisma client and no settings object in scope to reach it
 * through. Every template renders the same view; the template decides how it
 * LOOKS, never what it CONTAINS.
 */
export type TemplateRenderer = (view: ResumeViewDto) => string;

/** The template that has always rendered, and the fallback for anything unknown. */
export const DEFAULT_TEMPLATE = ResumeTemplate.CLASSIC;

/**
 * Enum value → renderer.
 *
 * Typed `Record<ResumeTemplate, …>` and NOT `Partial<…>` on purpose: that makes
 * a missing entry a COMPILE ERROR. B2 adds three real renderers, and this type
 * is what stops someone adding an enum value while forgetting to register
 * anything for it — a gap that would otherwise surface at runtime as a resume
 * silently rendered in the wrong template.
 *
 * MODERN / COMPACT / MINIMAL currently point at the CLASSIC renderer. That is
 * safe ONLY because the DTO and the OpenAPI enum refuse those values today, so
 * no candidate can select one; the moment B2 accepts them it also replaces
 * these three entries. Do not widen the API enum without replacing them.
 */
export const TEMPLATE_REGISTRY: Record<ResumeTemplate, TemplateRenderer> = {
  [ResumeTemplate.CLASSIC]: renderResumeHtml,
  [ResumeTemplate.MODERN]: renderResumeHtml, // B2: replace with renderModern
  [ResumeTemplate.COMPACT]: renderResumeHtml, // B2: replace with renderCompact
  [ResumeTemplate.MINIMAL]: renderResumeHtml, // B2: replace with renderMinimal
};

const logger = new Logger('TemplateRegistry');

/**
 * Resolve a stored value to a renderer, falling back to CLASSIC.
 *
 * NEVER THROWS. The input is a value read back from the database or from a
 * generation's settings snapshot, so it can legitimately be something this
 * build does not know: a row written by a newer release that was then rolled
 * back, or a legacy snapshot from before this column existed. A resume must
 * still render in all of those cases — failing a render over a settings value
 * would turn a cosmetic unknown into a candidate who cannot produce a CV.
 *
 * The fallback is logged because a value arriving here that is NOT simply
 * undefined means something upstream let through a template this build cannot
 * render, and that is worth seeing.
 */
export function selectTemplate(value: unknown): TemplateRenderer {
  if (typeof value === 'string' && value in TEMPLATE_REGISTRY) {
    return TEMPLATE_REGISTRY[value as ResumeTemplate];
  }
  if (value !== undefined && value !== null) {
    logger.warn(`unknown resume template ${JSON.stringify(value)} — rendering ${DEFAULT_TEMPLATE}`);
  }
  return TEMPLATE_REGISTRY[DEFAULT_TEMPLATE];
}
