import { NotificationType } from '@prisma/client';
import { BRAND, EmailBody, EmailFact } from './email-layout';

/**
 * Per-type email copy — what turns one branded shell into twenty distinct,
 * useful emails.
 *
 * ── WHERE THE WORDS COME FROM ───────────────────────────────────────────────
 * The `title` and `body` each caller already passes to `notify()` are good
 * human copy, written next to the code that knows the facts ("\"Welder — Doha\"
 * (JOB-1043) was approved and is now visible to candidates."). They were simply
 * never reaching the email: the processor forwarded only `payload.data`.
 *
 * So this module REUSES them as the heading and lead paragraph rather than
 * restating them here. Twenty duplicated strings in a second file is how the
 * in-app feed and the email start telling a candidate two different things
 * about the same event.
 *
 * What is added per type is what a caller has no business knowing: the SUBJECT
 * LINE (an inbox artefact, not an in-app one), the PREHEADER, the destination
 * the reader should land on, and any extra guidance the email medium calls for
 * — an attachment note, a security warning, an expiry.
 *
 * ── SUBJECT LINES ───────────────────────────────────────────────────────────
 * Front-loaded and specific, because mobile inboxes truncate near 35 characters
 * and a subject that begins with the brand name wastes all of them saying what
 * the sender column already says. "You've been selected" beats "Skill India
 * Connect — application status update".
 *
 * ── ONE ACTION PER EMAIL ────────────────────────────────────────────────────
 * Every type resolves to at most ONE call to action. A transactional email with
 * three competing buttons converts worse than one with a single obvious next
 * step, and on a 360px Android screen it simply looks cluttered.
 */

/** The locale segment app links are built under. */
const LOCALE = 'en';

export interface EmailContentInput {
  type: NotificationType;
  /** The caller's `notify()` title — becomes the heading. */
  title: string;
  /** The caller's `notify()` body — becomes the lead paragraph. */
  body: string;
  /** The caller's `notify()` data bag. */
  data: Record<string, unknown>;
  /** Configured WEB_APP_URL, or '' when unset. */
  webAppUrl: string;
  /** True when the send carries an attachment (the resume PDF). */
  hasAttachment?: boolean;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function link(webAppUrl: string, path: string): string | undefined {
  const base = webAppUrl.replace(/\/+$/, '');
  if (!base) return undefined;
  return `${base}/${LOCALE}${path}`;
}

/** Subject line per type. Falls back to the caller's title, which is never empty. */
function subjectFor(input: EmailContentInput): string {
  const d = input.data;
  const jobTitle = str(d['jobTitle']);
  const company = str(d['companyName']);

  switch (input.type) {
    case NotificationType.APPLICATION_SELECTED:
      return jobTitle ? `You've been selected — ${jobTitle}` : "You've been selected";
    case NotificationType.APPLICATION_SHORTLISTED:
      return jobTitle ? `Shortlisted for ${jobTitle}` : 'You have been shortlisted';
    case NotificationType.APPLICATION_REJECTED:
      return jobTitle ? `Update on your ${jobTitle} application` : 'An update on your application';
    case NotificationType.NEW_JOB_MATCH:
      return input.title;
    case NotificationType.PROFILE_REMINDER:
      return 'Finish your profile to start applying';
    case NotificationType.JOB_CLOSING_SOON:
      return jobTitle ? `Closing soon: ${jobTitle}` : 'A job you saved is closing soon';
    case NotificationType.PASSPORT_EXPIRY:
      return 'Your passport is expiring — action needed';
    case NotificationType.PROFILE_VIEWED:
      return company ? `${company} viewed your profile` : 'An employer viewed your profile';
    case NotificationType.EMPLOYER_APPROVED:
      return 'Your company is approved — you can post jobs';
    case NotificationType.EMPLOYER_REJECTED:
      return 'Your company registration needs changes';
    case NotificationType.EMPLOYER_SUSPENDED:
      return 'Your company account has been suspended';
    case NotificationType.SUBSCRIPTION_PURCHASED:
      return 'Your subscription is active';
    case NotificationType.SUBSCRIPTION_EXPIRING:
      return 'Your subscription expires soon';
    case NotificationType.SUBSCRIPTION_EXPIRED:
      return 'Your subscription has ended';
    case NotificationType.CANDIDATE_MATCHES:
      return input.title;
    case NotificationType.JOB_APPROVED:
      return jobTitle ? `Approved and live: ${jobTitle}` : 'Your job is now live';
    case NotificationType.JOB_REJECTED:
      return jobTitle ? `Changes needed: ${jobTitle}` : 'Your job needs changes';
    case NotificationType.JOB_POSTED_ONBEHALF:
      return 'A job was posted for your company';
    case NotificationType.RESUME_SENT:
      return 'Your resume from Skill India Connect';
    case NotificationType.RESUME_READY:
      return 'Your resume PDF is ready';
    case NotificationType.PASSWORD_RESET:
      return 'Reset your Skill India Connect password';
    case NotificationType.CANDIDATE_PROFILE_COMPLETE:
      // Says what CHANGED for them, not what they did. "Profile complete" is a
      // status; "you can now apply" is the reason the status matters.
      return 'Your profile is ready — you can now apply';
    case NotificationType.EMPLOYER_REGISTERED:
      return company ? `${company} is registered — under review` : 'Your company is under review';
    case NotificationType.CANDIDATE_INACTIVE_CHECK_IN:
      return 'Are you still looking for work?';
    case NotificationType.VERIFICATION_CALL_REQUESTED:
      return company
        ? `Verification call requested — ${company}`
        : 'Verification call requested';
    default:
      return input.title;
  }
}

/**
 * The destination. Returns undefined when WEB_APP_URL is unset (local scripts,
 * some test runs) — the layout then simply renders no button rather than a
 * dead one.
 */
function ctaFor(input: EmailContentInput): { label: string; url: string } | undefined {
  const d = input.data;
  const url = (path: string) => link(input.webAppUrl, path);

  const make = (label: string, path: string) => {
    const href = url(path);
    return href ? { label, url: href } : undefined;
  };

  switch (input.type) {
    case NotificationType.APPLICATION_SELECTED:
    case NotificationType.APPLICATION_SHORTLISTED:
    case NotificationType.APPLICATION_REJECTED:
      return make('View my applications', '/applications');
    case NotificationType.NEW_JOB_MATCH:
    case NotificationType.JOB_CLOSING_SOON:
      return make('See matching jobs', '/jobs');
    case NotificationType.PROFILE_REMINDER:
    case NotificationType.PASSPORT_EXPIRY:
      return make('Update my profile', '/profile');
    case NotificationType.PROFILE_VIEWED:
      return make('View my profile', '/profile');
    case NotificationType.EMPLOYER_APPROVED:
      return make('Post a job', '/employer/jobs/new');
    case NotificationType.EMPLOYER_REJECTED:
    case NotificationType.EMPLOYER_SUSPENDED:
      return make('Open company profile', '/employer/profile');
    case NotificationType.SUBSCRIPTION_PURCHASED:
    case NotificationType.SUBSCRIPTION_EXPIRING:
    case NotificationType.SUBSCRIPTION_EXPIRED:
      return make('Manage subscription', '/employer/subscription');
    case NotificationType.CANDIDATE_MATCHES:
      return make('Review candidates', '/employer/candidates');
    case NotificationType.JOB_APPROVED:
    case NotificationType.JOB_REJECTED:
    case NotificationType.JOB_POSTED_ONBEHALF:
      return make('Open my jobs', '/employer/jobs');
    case NotificationType.RESUME_SENT:
    case NotificationType.RESUME_READY:
      return make('Open resume builder', '/resume');
    case NotificationType.CANDIDATE_PROFILE_COMPLETE:
      // Straight to the jobs they just became eligible for — the point of the
      // email is the capability, so the button is the capability.
      return make('Browse jobs', '/jobs');
    case NotificationType.EMPLOYER_REGISTERED:
      return make('Go to dashboard', '/employer/dashboard');
    case NotificationType.CANDIDATE_INACTIVE_CHECK_IN:
      return make('Yes — show me jobs', '/jobs');
    case NotificationType.VERIFICATION_CALL_REQUESTED:
      // The admin console's employer list, not the employer's own dashboard —
      // this is the one notification type whose audience is staff.
      return make('Review employers', '/admin/employers');
    case NotificationType.PASSWORD_RESET: {
      // The one type whose destination is single-use and caller-supplied.
      const reset = str(d['resetUrl']);
      return reset ? { label: 'Choose a new password', url: reset } : undefined;
    }
    default:
      return undefined;
  }
}

/** Labelled details, pulled from whatever the caller happened to include. */
function factsFor(input: EmailContentInput): EmailFact[] {
  const d = input.data;
  const facts: EmailFact[] = [];
  const push = (label: string, value: string | undefined) => {
    if (value) facts.push([label, value]);
  };

  push('Job', str(d['jobTitle']));
  push('Reference', str(d['humanId']));
  push('Company', str(d['companyName']));
  push('Plan', str(d['planName']));
  push('Reason', str(d['reason']));

  const expires = str(d['expiresAt']) ?? str(d['graceEndsAt']);
  if (expires) {
    const asDate = new Date(expires);
    if (!Number.isNaN(asDate.getTime())) push('Date', asDate.toISOString().slice(0, 10));
  }
  return facts;
}

/**
 * Extra guidance the EMAIL medium calls for and the in-app feed does not.
 *
 * The resume case is the one that matters most: this mail carries the PDF the
 * candidate is about to forward to a Gulf employer, so it says so explicitly.
 * A recipient who does not notice the attachment concludes the email is empty.
 */
function paragraphsFor(input: EmailContentInput): string[] {
  const extra: string[] = [];

  switch (input.type) {
    case NotificationType.RESUME_SENT:
      if (input.hasAttachment) {
        extra.push(
          'Your resume is attached to this email as a PDF. Save it to your phone so you can send it to employers even when you are offline.',
        );
      }
      extra.push(
        'Keep your profile up to date — every resume you generate is built from it, so your next download reflects any changes you make.',
      );
      break;
    case NotificationType.RESUME_READY:
      extra.push(
        'You can download it any time from the resume builder, or send it to yourself on WhatsApp.',
      );
      break;
    case NotificationType.APPLICATION_SELECTED:
      extra.push(
        'The employer will contact you with the next steps. Make sure your phone number and passport details are current so nothing delays your offer.',
      );
      break;
    case NotificationType.PASSPORT_EXPIRY:
      extra.push(
        'Employers cannot process an overseas placement on an expired passport, and you will not be able to apply for Gulf roles until it is renewed.',
      );
      break;
    case NotificationType.PROFILE_REMINDER:
      extra.push(
        'A complete profile ranks higher with employers and unlocks your downloadable resume.',
      );
      break;
    case NotificationType.CANDIDATE_PROFILE_COMPLETE:
      extra.push(
        'Employers can now find you in search, and you can apply to any job that matches your trade.',
      );
      extra.push(
        'Keep your documents current — an expired passport stops an application at the visa stage, and we will remind you well before that happens.',
      );
      break;
    case NotificationType.CANDIDATE_INACTIVE_CHECK_IN:
      extra.push(
        'We have not seen you in a while, so employers browsing for workers are now seeing your profile as inactive.',
      );
      extra.push(
        'Signing in is all it takes to mark yourself active again — you do not need to change anything on your profile.',
      );
      extra.push(
        'If you have already found work, you can turn off "Available for work" in your settings and we will stop showing you to employers.',
      );
      break;
    case NotificationType.VERIFICATION_CALL_REQUESTED: {
      // `paragraphsFor` reads from `input.data`; the short `d` alias only
      // exists in ctaFor, which is where this shape was copied from.
      const callData = input.data ?? {};
      const slot = str(callData['slotAt']);
      extra.push(
        slot
          ? `They proposed ${new Date(slot).toUTCString()} (UTC). Confirm or reschedule with them directly.`
          : 'Confirm a time with them directly.',
      );
      const callNote = str(callData['note']);
      if (callNote) extra.push(`Their note: "${callNote}"`);
      extra.push(
        'Approving after the call is still a manual decision — this request only books the conversation.',
      );
      break;
    }
    case NotificationType.EMPLOYER_REGISTERED:
      extra.push(
        'Our team is verifying your company details. Verification usually takes up to 24 hours, and we will email you the moment it is done.',
      );
      extra.push(
        'You can finish setting up your profile in the meantime — posting a job unlocks as soon as you are approved.',
      );
      break;
    default:
      break;
  }
  return extra;
}

/** Fine print under the action. */
function noteFor(input: EmailContentInput): string | undefined {
  switch (input.type) {
    case NotificationType.PASSWORD_RESET:
      return 'This link is valid for one hour and can be used once. If you did not ask to reset your password, ignore this email — your password will not change.';
    case NotificationType.RESUME_SENT:
      return `${BRAND.name} never asks you to pay an employer, an agent, or us to receive a job offer. If anyone asks you for money, do not pay — report it to us.`;
    case NotificationType.APPLICATION_SELECTED:
      return `${BRAND.name} never asks you to pay for a job offer, a visa, or a ticket. If anyone asks you for money, do not pay — report it to us.`;
    case NotificationType.EMPLOYER_SUSPENDED:
      return 'Your job posts are hidden from candidates while the account is suspended. Contact support if you believe this is a mistake.';
    case NotificationType.CANDIDATE_PROFILE_COMPLETE:
      // The same anti-fraud line the offer and resume mails carry. This is the
      // first email many candidates receive, so it is the first chance to set
      // the expectation that nobody on this platform ever asks them for money.
      return `${BRAND.name} is free for workers. We never ask you to pay for a profile, an application, or a job offer — if anyone asks you for money, do not pay.`;
    default:
      return undefined;
  }
}

/**
 * Build the full email body for a notification.
 *
 * Deliberately total — every `NotificationType` produces a real, branded email
 * rather than falling through to a bare paragraph. Types without bespoke
 * additions still get the shell, the caller's own copy, and a sensible action.
 */
export function buildEmailBody(input: EmailContentInput): EmailBody {
  const facts = factsFor(input);
  const cta = ctaFor(input);
  const paragraphs = paragraphsFor(input);
  const note = noteFor(input);

  return {
    /*
      The preheader is paired with the SUBJECT in the inbox, not with the body,
      so using the caller's body here adds detail rather than repeating: the
      reader sees "You've been selected" followed by the specific sentence.
      Leaving it unset is what produces the "View in browser…" preview that
      makes an email look untended.
    */
    preheader: input.body,
    heading: input.title,
    intro: input.body,
    ...(paragraphs.length > 0 && { paragraphs }),
    ...(facts.length > 0 && { facts }),
    ...(cta && { cta }),
    ...(note && { note }),
  };
}

export { subjectFor };
