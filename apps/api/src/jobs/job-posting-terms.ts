/**
 * The job-posting terms an employer accepts each time they post a job.
 *
 * ── Why a VERSION and not a boolean ──────────────────────────────────────────
 * A tick-box that stores `true` records that somebody agreed to something. The
 * question in a dispute is what they agreed TO. So the terms carry a version,
 * every job stamps the version it was posted under, and changing the wording
 * means minting a new version rather than silently editing the old one — jobs
 * posted last month keep pointing at the text that was actually on screen.
 *
 * ── Status of this text ──────────────────────────────────────────────────────
 * DRAFT, pending review by the platform's lawyer. The clauses below were
 * assembled from the obligations this codebase already enforces plus the
 * frameworks that govern India→Gulf recruitment (Emigration Act 1983, the ILO
 * fair-recruitment principles, GCC wage-protection and passport rules). They
 * are a starting point for that review, NOT legal advice — I am not a lawyer.
 *
 * When legal signs off: replace the clause text, bump JOB_POSTING_TERMS_VERSION,
 * and leave the old version string in the history below. Do not edit a published
 * version in place.
 */

/**
 * The version an employer must accept to post a job today.
 *
 * Date-based rather than a running integer so the value is legible in an audit
 * row without a lookup table — an admin reading `2026-08-draft-1` on a job knows
 * roughly when it was agreed without leaving the screen.
 */
export const JOB_POSTING_TERMS_VERSION = '2026-08-draft-1';

/**
 * Every version ever published, oldest first.
 *
 * Kept so an old job's `termsVersion` can still be resolved to readable text.
 * Append; never remove an entry, and never edit one that has shipped.
 */
export const JOB_POSTING_TERMS_HISTORY = [JOB_POSTING_TERMS_VERSION] as const;

export interface JobPostingTermsClause {
  /** Stable id — referenced by admin tooling and by the employer-facing page. */
  id: string;
  title: string;
  /** The operative sentence the employer is agreeing to. */
  text: string;
}

/**
 * The clauses, in the order they are shown.
 *
 * Grouped by what they protect: the vacancy is real, the worker pays nothing,
 * the stated terms are the honoured terms, the worker's documents and wages are
 * theirs, and the platform may verify and remove.
 */
export const JOB_POSTING_TERMS: readonly JobPostingTermsClause[] = [
  {
    id: 'genuine-vacancy',
    title: 'The vacancy is real and currently open',
    text: 'I confirm this posting is for a genuine, currently open position with the named company, that I am authorised to recruit for it, and that it is not an advertisement to collect candidate data, build a database, or promote another service.',
  },
  {
    id: 'no-worker-fees',
    title: 'No fees are charged to the worker',
    text: 'I confirm that no recruitment fee or related cost will be charged to the candidate at any stage — by me, by the employer, or by any agent, sub-agent or third party acting for us — whether described as a fee, deposit, commission, security, or reimbursement for visa, medical, travel, training or documentation costs.',
  },
  {
    id: 'accurate-terms',
    title: 'The posted terms are accurate',
    text: 'I confirm that the job title, duties, location, employer, salary and currency, working hours, benefits and contract length stated in this posting are accurate and complete, and that I will update or archive the posting promptly if any of them change.',
  },
  {
    id: 'no-contract-substitution',
    title: 'No contract substitution',
    text: 'I confirm that the terms in this posting are the terms of the employment contract the candidate will be asked to sign, and that the contract signed before departure will be the contract honoured on arrival, without substitution or amendment to the worker’s disadvantage.',
  },
  {
    id: 'lawful-employment',
    title: 'Lawful employment and valid authorisation',
    text: 'I confirm the employment complies with the labour law of the country of work and with Indian emigration law, including — where the role and the candidate require it — recruitment through a licensed recruiting agent and clearance through the eMigrate system.',
  },
  {
    id: 'documents-and-wages',
    title: 'The worker keeps their documents and is paid through lawful channels',
    text: 'I confirm that no passport, identity document, certificate or personal property will be retained from the worker, and that wages will be paid in full, on time, and through the lawful wage-payment channel of the country of work.',
  },
  {
    id: 'worker-protection',
    title: 'Worker protection guarantees',
    text: 'For overseas roles, I confirm that accommodation, health insurance and transport to the workplace are provided as stated, at no cost to the worker. For roles within India, I confirm that any such benefit shown on this posting is one the employer actually provides.',
  },
  {
    id: 'non-discrimination',
    title: 'Lawful and non-discriminatory selection',
    text: 'I confirm that selection will be based on the requirements of the job, and that this posting does not exclude or disadvantage candidates on any ground prohibited by applicable law.',
  },
  {
    id: 'candidate-data',
    title: 'Candidate data is used only for this vacancy',
    text: 'I confirm that candidate personal data and documents accessed through this platform will be used solely to assess and process applications for this vacancy, will not be sold, published or passed to any third party without the candidate’s consent, and will be handled in accordance with applicable data-protection law.',
  },
  {
    id: 'no-minors',
    title: 'No underage or forced labour',
    text: 'I confirm that no person below the lawful minimum working age will be engaged for this role, and that the work is freely chosen, with the worker free to end the employment in accordance with their contract and applicable law.',
  },
  {
    id: 'platform-verification',
    title: 'Verification, correction and removal',
    text: 'I accept that Skill India Connect may request evidence supporting this posting, and may reject, edit, unpublish or remove it, and may suspend the company account, where a posting is inaccurate, unlawful, or breaches these terms.',
  },
  {
    id: 'responsibility',
    title: 'Responsibility for the posting',
    text: 'I confirm I am authorised to accept these terms on behalf of the company named on this posting, that the company is responsible for the accuracy of the posting and for the conduct of anyone recruiting on its behalf, and that Skill India Connect is a platform connecting candidates and employers and is not the employer.',
  },
];
