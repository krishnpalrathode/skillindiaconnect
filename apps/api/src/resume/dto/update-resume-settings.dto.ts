import { ResumeTemplate } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { TEMPLATE_REGISTRY } from '../templates/registry';

/**
 * The templates the API ACCEPTS.
 *
 * B1 deliberately accepted only CLASSIC because it was the only template with a
 * renderer. B2 shipped MODERN, COMPACT and MINIMAL, and ELEGANT, EXECUTIVE and
 * TIMELINE followed — each with its renderer registered in the same change.
 *
 * THE RULE THIS LIST ENCODES: a value is accepted only once a renderer exists
 * for it. Accepting one earlier would store a choice that silently renders as
 * something else — exactly what `language` below refuses to do with hi/ar. A
 * template declared in the Prisma enum AHEAD of its renderer does NOT belong
 * here until that renderer lands.
 *
 * Derived from TEMPLATE_REGISTRY rather than retyped, because "has a renderer"
 * IS the admission rule and the registry is where that fact lives. Hand-copying
 * the list had already gone stale once: the Prisma enum, the contract and the
 * gallery all gained three templates while this array still held four, so the
 * picker offered choices the API answered with "not available yet". The
 * registry's `Record<ResumeTemplate, …>` type still makes a missing renderer a
 * compile error, so nothing can reach this list without one.
 */
export const ACCEPTED_RESUME_TEMPLATES: ResumeTemplate[] = Object.keys(
  TEMPLATE_REGISTRY,
) as ResumeTemplate[];

/**
 * PARTIAL ResumeSettings (S7-0). Every field optional — omitted toggles keep
 * their stored value.
 *
 * `language` is restricted to 'en' because English is the ONLY language the
 * renderer has (S7-B1). Rejecting hi/ar here — rather than accepting them and
 * quietly rendering English — is the honest contract: a client cannot ask for
 * something that will not happen. When a translated template ships, this list
 * and the OpenAPI enum widen together.
 */
export class UpdateResumeSettingsDto {
  @IsOptional()
  @IsIn(['en'], { message: 'Only English resumes are available right now.' })
  language?: string;

  @IsOptional()
  @IsBoolean()
  showPhone?: boolean;

  @IsOptional()
  @IsBoolean()
  showReligion?: boolean;

  @IsOptional()
  @IsBoolean()
  showFatherName?: boolean;

  @IsOptional()
  @IsBoolean()
  showPassportNumber?: boolean;

  @IsOptional()
  @IsIn(ACCEPTED_RESUME_TEMPLATES, {
    message: 'That resume template is not available yet.',
  })
  template?: ResumeTemplate;
}
