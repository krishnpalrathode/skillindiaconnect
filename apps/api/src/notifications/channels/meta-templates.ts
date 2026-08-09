import { NotificationType } from '@prisma/client';
import { NOTIFICATION_MATRIX } from '../notification.matrix';

/**
 * Logical template key → the APPROVED Meta template name (CR-WA W1).
 *
 * THIS FILE IS THE CRUX OF THE INTEGRATION. A wrong name here is not a crash —
 * Meta returns a generic failure for an unknown template, the row is marked
 * FAILED, the candidate is quietly emailed instead, and nobody learns the name
 * was wrong. So the names are asserted as literal strings in the spec, and the
 * mapping is validated at STARTUP against the notification matrix.
 *
 * `params` is the count the APPROVED template declares. It is checked before the
 * call because Meta's mismatch error (132000) is opaque, whereas failing here
 * can name the template and both counts.
 */
export interface MetaTemplate {
  /** The exact name registered and approved in WhatsApp Manager. */
  name: string;
  /** How many {{n}} body parameters the approved template takes. */
  params: number;
  /** True when the template carries a document HEADER (the resume). */
  document?: boolean;
  /**
   * Locale override, for a template approved in a DIFFERENT language from the
   * others. Leave unset to use WHATSAPP_TEMPLATE_LANGUAGE.
   */
  language?: string;
}

/**
 * The locale a template is requested in — and it is part of a template's
 * IDENTITY to Meta, not a formatting preference.
 *
 * ⚠️ `en` AND `en_US` ARE DIFFERENT TEMPLATES. Asking for a name in a locale it
 * was not approved in fails with 404 / code 132001:
 *
 *   "template name (login_otp) does not exist in en"
 *
 * which reads like the template is missing entirely. It is not — it exists, in
 * another locale. This was hardcoded to 'en' and cost a live bring-up: the
 * WhatsApp Manager UI offers both "English" (en) and "English (US)" (en_US),
 * and a template created with the default lands on en_US.
 *
 * `en_US` is the default because it is what WhatsApp Manager produces unless
 * you deliberately pick plain English. Read the actual value off the template
 * in WhatsApp Manager and set WHATSAPP_TEMPLATE_LANGUAGE if yours differs —
 * it is an env var precisely so this is a restart, not a redeploy, on the day
 * you are trying to go live.
 */
export const DEFAULT_TEMPLATE_LANGUAGE = 'en_US';

/**
 * The approved templates, keyed by the logical key the notification matrix uses.
 *
 * Adding a template here is only half the job — the matrix entry must carry the
 * matching `whatsappTemplate`, and `assertTemplateMappingComplete` below is what
 * makes the two halves impossible to separate.
 */
export const META_TEMPLATES = {
  'wa.selected': { name: 'job_selected', params: 3 },
  // ⚠️ THREE SIMILAR NAMES, ONE OF WHICH IS THE ONLY ONE META SEES:
  //   resume_document   the APPROVED Meta template name — this value
  //   wa.resume_doc     our logical key (matrix ↔ this map)
  //   RESUME_DOCUMENT   the WaMessageKind on the delivery row
  // This was `resume_generated`, which exists nowhere in WhatsApp Manager. It
  // failed with 132001 "template does not exist" — the same error a wrong
  // LOCALE produces, which is how it hid behind the en/en_US hunt.
  'wa.resume_doc': { name: 'resume_document', params: 1, document: true },
  /**
   * ⚠️ NOT YET APPROVED IN WHATSAPP MANAGER — see docs/whatsapp-integration.md.
   *
   * Mapped ahead of approval so that enabling the alert is a ONE-LINE matrix
   * change (`whatsapp: false` → `true` on NEW_JOB_MATCH) rather than a hunt
   * across three files. Being listed here sends nothing on its own: only a
   * matrix entry with `whatsapp: true` reaches the Graph API.
   *
   * Until Meta approves `job_match_alert`, flipping that switch will fail every
   * send with 132001 and fall back to email. Confirm approval first with
   * `pnpm whatsapp:templates`.
   *
   * Params: {{1}} first name · {{2}} top-3 job summary · {{3}} link.
   */
  'wa.job_match': { name: 'job_match_alert', params: 3 },
  /**
   * ⚠️ NOT YET APPROVED IN WHATSAPP MANAGER — see docs/whatsapp-integration.md.
   *
   * Employer outreach to a candidate they marked as interesting. Mapped ahead of
   * approval for the same reason as `wa.job_match`: enabling it is then a
   * one-line matrix change.
   *
   * Params: {{1}} first name · {{2}} company name.
   */
  'wa.employer_interest': { name: 'employer_interest_notice', params: 2 },
} as const satisfies Record<string, MetaTemplate>;

export type MetaTemplateKey = keyof typeof META_TEMPLATES;

/**
 * The Authentication template, used by BOTH OTP purposes.
 *
 * `sendOtp` is a separate interface method with its own purpose enum, not a
 * templateKey — there is no third logical key. PHONE_VERIFY (signup) and LOGIN
 * both map here because one approved auth template serves both flows; its copy
 * must therefore read correctly for both (say "verification code", not
 * "log in").
 */
export const META_OTP_TEMPLATE: MetaTemplate = { name: 'login_otp', params: 1 };

/**
 * Resolve a logical key, or throw naming it.
 *
 * NEVER falls back. notification.processor.ts:55 does
 * `matrixEntry.whatsappTemplate ?? type`, so an unmapped whatsapp-tier entry
 * would hand this a NotificationType enum name — which must fail loudly rather
 * than be sent to Meta as if it were a template.
 */
export function resolveMetaTemplate(templateKey: string): MetaTemplate {
  const template = (META_TEMPLATES as Record<string, MetaTemplate>)[templateKey];
  if (!template) {
    throw new Error(
      `No approved Meta template is mapped for '${templateKey}'. Add it to ` +
        'META_TEMPLATES (meta-templates.ts) — a template key must never reach ' +
        'the Graph API unmapped.',
    );
  }
  return template;
}

/**
 * STARTUP VALIDATION — the guard against forgetting.
 *
 * Walks the notification matrix and throws if any `whatsapp: true` type lacks a
 * mapping. Called from the Meta adapter's constructor, so a misconfigured deploy
 * CRASHES AT BOOT rather than discovering the gap months later as a stream of
 * quietly-failed sends.
 *
 * A boot crash is the correct failure here: the alternative is a platform that
 * looks healthy while its most important messages ("you have been selected")
 * silently never arrive.
 */
export function assertTemplateMappingComplete(): void {
  const missing: string[] = [];

  for (const [type, entry] of Object.entries(NOTIFICATION_MATRIX)) {
    if (!entry.whatsapp) continue;
    // The same fallback the processor applies, so this validates what the
    // adapter will ACTUALLY be handed rather than what the matrix intended.
    const key = entry.whatsappTemplate ?? (type as NotificationType);
    if (!(key in META_TEMPLATES)) missing.push(`${type} → '${key}'`);
  }

  if (missing.length > 0) {
    throw new Error(
      'WhatsApp template mapping is incomplete. These notification types have ' +
        `whatsapp: true but no approved Meta template: ${missing.join(', ')}. ` +
        'Add them to META_TEMPLATES (meta-templates.ts), or set whatsapp: false ' +
        'in the matrix. Refusing to start: an unmapped type would fail every ' +
        'send silently.',
    );
  }
}
