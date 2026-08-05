import { Logger } from '@nestjs/common';
import { ResumeTemplate } from '@prisma/client';
import { ResumeViewDto } from '../resume-view.mapper';
import { renderClassic } from './classic.template';
import { renderModern } from './modern.template';
import { renderCompact } from './compact.template';
import { renderMinimal } from './minimal.template';

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
 * All four now have real renderers (B2), and the API enum widened with them —
 * those two things must always move together. A value accepted by the DTO with
 * no renderer of its own would silently render as something else, which is the
 * failure the `language: enum [en]` precedent exists to prevent.
 */
export const TEMPLATE_REGISTRY: Record<ResumeTemplate, TemplateRenderer> = {
  [ResumeTemplate.CLASSIC]: renderClassic,
  [ResumeTemplate.MODERN]: renderModern,
  [ResumeTemplate.COMPACT]: renderCompact,
  [ResumeTemplate.MINIMAL]: renderMinimal,
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
