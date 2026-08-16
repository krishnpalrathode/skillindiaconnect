/**
 * The employer-facing copy of the job-posting terms.
 *
 * MIRRORS apps/api/src/jobs/job-posting-terms.ts, which is the source of truth —
 * the API validates the submitted version against its own list, so a version
 * string invented here would be rejected on save.
 *
 * DRAFT, pending review by the platform's lawyer. When legal signs off: update
 * both files together, bump the version, and never edit a shipped version in
 * place — jobs already posted point at the text that was on screen at the time.
 */
export const JOB_POSTING_TERMS_VERSION = '2026-08-draft-1';

export interface JobPostingTermsClause {
  id: string;
  title: string;
  text: string;
}

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
    text: 'I confirm that the terms in this posting are the terms of the employment contract the candidate will be asked to sign, and that the contract signed before departure will be the contract honoured on arrival, without substitution or amendment to the worker\u2019s disadvantage.',
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
    text: 'I confirm that candidate personal data and documents accessed through this platform will be used solely to assess and process applications for this vacancy, will not be sold, published or passed to any third party without the candidate\u2019s consent, and will be handled in accordance with applicable data-protection law.',
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
