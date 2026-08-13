import { NotificationType } from '@prisma/client';
import { buildEmailBody, subjectFor, EmailContentInput } from './email-content';
import { renderEmailLayout, renderEmailText } from './email-layout';

export { BRAND, renderEmailLayout, renderEmailText } from './email-layout';
export type { EmailBody, EmailFact, EmailCallToAction } from './email-layout';
export { buildEmailBody } from './email-content';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render a notification into a complete, branded email.
 *
 * THE ONE ENTRY POINT the send path uses. It produces all three reserved keys
 * the `EmailChannel` port already documents (`subject`, `html`, `text`), which
 * is exactly the caller-side enrichment that port was designed for — so no
 * channel, adapter, or provider code changes to get branded mail, and the
 * future SES swap stays a one-binding change.
 *
 * Returns a text part as well as HTML on purpose. An HTML-only message scores
 * worse with spam filters and renders as nothing in text-mode clients, and this
 * is transactional mail that must arrive.
 */
export function renderNotificationEmail(input: EmailContentInput): RenderedEmail {
  const body = buildEmailBody(input);
  return {
    subject: subjectFor(input),
    html: renderEmailLayout(body, { webAppUrl: input.webAppUrl }),
    text: renderEmailText(body),
  };
}

/**
 * Every type this module renders bespoke copy for — used by the test that keeps
 * the switch statements exhaustive as the enum grows.
 */
export const RENDERED_NOTIFICATION_TYPES: NotificationType[] = Object.values(NotificationType);
