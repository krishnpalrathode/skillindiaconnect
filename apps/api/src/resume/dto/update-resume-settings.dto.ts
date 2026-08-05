import { ResumeTemplate } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/**
 * The templates the API ACCEPTS.
 *
 * B1 deliberately accepted only CLASSIC because it was the only template with a
 * renderer. B2 ships MODERN, COMPACT and MINIMAL, so the list widens with them.
 *
 * THE RULE THIS LIST ENCODES: a value is accepted only once a renderer exists
 * for it. Accepting one earlier would store a choice that silently renders as
 * something else — exactly what `language` below refuses to do with hi/ar. If a
 * fifth template is ever declared in the Prisma enum ahead of its renderer, it
 * does NOT belong here until that renderer lands.
 */
export const ACCEPTED_RESUME_TEMPLATES: ResumeTemplate[] = [
  ResumeTemplate.CLASSIC,
  ResumeTemplate.MODERN,
  ResumeTemplate.COMPACT,
  ResumeTemplate.MINIMAL,
];

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
