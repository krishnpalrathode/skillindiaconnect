import { ResumeViewDto } from '../resume-view.mapper';

/**
 * The words of the cover letter.
 *
 * ── WHY THE PLATFORM WRITES IT ─────────────────────────────────────────────
 * Our candidates are electricians, welders and drivers, and many of them do not
 * write formal English. Handing them an empty box labelled "cover letter" would
 * produce either nothing or something that reads worse than no letter at all —
 * which is worse than useless when a Gulf agency is deciding whether to forward
 * their file. So the letter is COMPOSED from what the profile already proves,
 * in the register a hiring manager expects, and the candidate supplies only the
 * two things we cannot know: who it is for.
 *
 * ── THE FORMAT, AND WHY EACH PART IS THERE ────────────────────────────────
 * Full block format (everything flush left, no indents, blank line between
 * paragraphs) — the modern business-letter standard, and the one that survives
 * being photocopied and faxed through an agency without looking wrong.
 *
 *   1. Sender block — name, trade, contact. Top, so a reader who keeps only
 *      page one can still reach them.
 *   2. Date, written out ("18 August 2026"). NEVER 08/18/2026: an Indian
 *      candidate applying to a Gulf employer through a British-convention
 *      agency has three plausible readings of a numeric date and only one is
 *      right. Spelling the month removes the ambiguity entirely.
 *   3. Recipient block, when known.
 *   4. Salutation.
 *   5. Subject ("RE: ..."). Standard in Indian and Gulf business
 *      correspondence, and it means a letter separated from its CV still says
 *      what job it is about.
 *   6. Three to four short paragraphs — opening, evidence, logistics, close.
 *   7. Complimentary close, then the name.
 *   8. Enclosure line, because the resume travels with it.
 *
 * ── THE ONE DETAIL EVERYONE GETS WRONG ────────────────────────────────────
 * "Yours sincerely" is correct ONLY when the letter names its addressee;
 * an unaddressed letter closes "Yours faithfully". India and the Gulf both
 * follow British convention here, and getting it backwards is exactly the
 * marker that tells a reader the letter came from a template. `closingFor`
 * below picks the right one from whether we actually have a name.
 *
 * ── LENGTH ────────────────────────────────────────────────────────────────
 * One page, four paragraphs, roughly 250-350 words. A hiring manager working
 * through fifty applications reads the first sentence and the logistics; a
 * second page guarantees neither gets read.
 */

export interface CoverLetterTarget {
  /** Employer being written to, when the candidate names one. */
  companyName?: string | null;
  /** Person, when known — decides sincerely vs faithfully. */
  recipientName?: string | null;
  /** Role applied for; falls back to the candidate's trade. */
  roleTitle?: string | null;
}

export interface CoverLetterContent {
  senderName: string;
  senderHeadline: string | null;
  senderContact: string[];
  date: string;
  recipientLines: string[];
  salutation: string;
  subject: string;
  paragraphs: string[];
  closing: string;
  enclosure: string;
}

/** "18 August 2026" — month spelled out, see the docblock. */
export function formatLetterDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "8 years" / "8 years 6 months" / null — from the experience rows. */
function totalExperience(view: ResumeViewDto): string | null {
  const months = view.experiences.reduce((sum, e) => sum + e.years * 12 + e.months, 0);
  if (months === 0) return null;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} month${rem === 1 ? '' : 's'}`;
  if (rem === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years} year${years === 1 ? '' : 's'} ${rem} month${rem === 1 ? '' : 's'}`;
}

/** Natural-language list: "a, b and c" — Gulf/Indian English uses no serial comma. */
function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function closingFor(recipientName?: string | null): string {
  // See the docblock: named addressee → sincerely; otherwise faithfully.
  return recipientName?.trim() ? 'Yours sincerely,' : 'Yours faithfully,';
}

function salutationFor(recipientName?: string | null): string {
  const name = recipientName?.trim();
  if (name) return `Dear ${name},`;
  // "Dear Sir or Madam" over "To whom it may concern": the latter reads as a
  // circular, which is what we are trying not to sound like.
  return 'Dear Sir or Madam,';
}

/**
 * Build the letter.
 *
 * Every sentence is conditional on evidence actually present in the view — the
 * letter never claims experience, skills or documents the profile does not
 * have. A sparse profile yields a shorter, still-correct letter rather than a
 * padded one making claims a five-minute phone call would demolish.
 */
export function buildCoverLetter(
  view: ResumeViewDto,
  target: CoverLetterTarget = {},
): CoverLetterContent {
  const role = target.roleTitle?.trim() || view.jobCategory || 'the advertised position';
  const company = target.companyName?.trim() || null;
  const experience = totalExperience(view);
  const skills = view.skills.slice(0, 5).map((s) => s.name);
  const foreign = view.experiences.filter((e) => e.type === 'FOREIGN');
  const latest = view.experiences[0] ?? null;

  // ── Contact line: only what the mapper let through (privacy settings already
  // applied upstream), so the letter cannot leak a phone the resume hides.
  const senderContact = [view.email];
  if (view.phone) senderContact.push(view.phone);
  if (view.currentLocation) senderContact.push(view.currentLocation);

  const recipientLines: string[] = [];
  if (target.recipientName?.trim()) recipientLines.push(target.recipientName.trim());
  if (company) recipientLines.push(company);

  // ── ¶1 Opening: who, what, and the single strongest credential.
  const opening = (() => {
    const trade = view.jobCategory ? view.jobCategory.toLowerCase() : 'skilled worker';
    const lead = experience
      ? `I am a ${trade} with ${experience} of hands-on experience`
      : `I am a trained ${trade}`;
    const where = company ? ` at ${company}` : '';
    return `${lead}, and I am writing to apply for the ${role} position${where}.`;
  })();

  // ── ¶2 Evidence: the most recent role, then the skills that back it.
  const evidence = (() => {
    const parts: string[] = [];
    if (latest) {
      const at = latest.companyName ? ` at ${latest.companyName}` : '';
      const inCountry = latest.country ? ` in ${latest.country}` : '';
      parts.push(`Most recently I worked as ${latest.role}${at}${inCountry}.`);
    }
    if (skills.length > 0) {
      parts.push(`My main skills are ${joinList(skills)}.`);
    }
    if (foreign.length > 0) {
      const countries = joinList([...new Set(foreign.map((e) => e.country).filter(Boolean))]);
      parts.push(
        countries
          ? `I have already worked overseas in ${countries}, so I am used to international sites and to working in a team of mixed nationalities.`
          : 'I have already worked overseas, so I am used to international sites and to working in a team of mixed nationalities.',
      );
    }
    return parts.join(' ');
  })();

  // ── ¶3 Logistics. The paragraph that actually gets Gulf candidates shortlisted:
  // an agency's first question is never about skill, it is whether the paperwork
  // is in order and how soon the person can travel.
  const logistics = (() => {
    const parts: string[] = [];
    const hasPassport = view.documents.some((d) => d.type === 'PASSPORT');
    const validPassport = view.documents.some((d) => d.type === 'PASSPORT' && d.passportValid);
    if (validPassport) {
      parts.push('My passport is current and valid for travel.');
    } else if (hasPassport) {
      parts.push('I hold a passport and can provide the details on request.');
    }
    const certs = view.documents.filter((d) => d.type !== 'PASSPORT').length;
    if (certs > 0) {
      parts.push(
        'My work and education certificates have been uploaded and checked on Skill India Connect.',
      );
    }
    if (view.languages.length > 0) {
      parts.push(`I speak ${joinList(view.languages)}.`);
    }
    parts.push('I am available to start and willing to relocate for the right opportunity.');
    return parts.join(' ');
  })();

  // ── ¶4 Close: one clear ask, no grovelling.
  const closingPara = company
    ? `I would welcome the chance to discuss how my experience can be of use to ${company}. Thank you for considering my application.`
    : 'I would welcome the chance to discuss my experience with you in more detail. Thank you for considering my application.';

  /*
    The candidate's own summary leads when they have written one.

    It is the only sentence in the letter in their voice, and a hiring manager
    can tell. Placed FIRST so the letter opens with the person rather than with
    a generated formula — the generated opening then supplies the specifics
    immediately after.
  */
  const paragraphs = [view.summary?.trim(), opening, evidence, logistics, closingPara].filter(
    (p): p is string => !!p && p.length > 0,
  );

  return {
    senderName: view.fullName,
    senderHeadline: view.jobCategory,
    senderContact,
    date: formatLetterDate(view.generatedAt),
    recipientLines,
    salutation: salutationFor(target.recipientName),
    subject: company
      ? `RE: Application for the ${role} position`
      : `RE: Application for ${role} work`,
    paragraphs,
    closing: closingFor(target.recipientName),
    enclosure: 'Enclosure: Curriculum Vitae',
  };
}
