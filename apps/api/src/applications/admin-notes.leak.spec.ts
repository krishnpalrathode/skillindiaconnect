/**
 * S6b-B2 — the notes LEAK-PROOF test.
 *
 * Internal notes must be structurally unreachable from candidate- and
 * employer-facing responses. The mappers pick fields EXPLICITLY, so even a
 * naive read that accidentally includes the `notes` relation cannot leak: we
 * feed both mappers an application object that CARRIES loaded notes and assert
 * the raw serialized output contains neither the relation nor its content.
 */
import { Application, ApplicationStatus, UserRole } from '@prisma/client';
import { toApplicationResponse } from './application.mapper';
import { toApplicantCard } from './mappers/applicant-card.mapper';

const SECRET_NOTE = 'INTERNAL: candidate seemed evasive about the certificate';

const appWithNotes = {
  id: 'app-1',
  humanId: 'AP-2026-1',
  jobId: 'job-1',
  candidateId: 'cand-1',
  candidateTombstone: null,
  status: ApplicationStatus.SHORTLISTED,
  coverLetter: 'hello',
  matchScore: 80,
  matchBreakdown: { category: 40 },
  docsCompleteCount: 1,
  docsRequiredCount: 1,
  passportValidAtApply: true,
  selectedNotifiedAt: null,
  rejectionFeedback: null,
  archivedAt: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-02T00:00:00Z'),
  // The naive-include scenario: the relation is LOADED on the object.
  notes: [
    {
      id: 'note-1',
      applicationId: 'app-1',
      authorId: 'admin-1',
      authorRole: UserRole.ADMIN,
      body: SECRET_NOTE,
      createdAt: new Date(),
    },
  ],
} as unknown as Application;

describe('internal notes never leak into non-admin responses (raw JSON proven)', () => {
  it('the candidate-context ApplicationResponse carries no notes', () => {
    const raw = JSON.stringify(toApplicationResponse(appWithNotes));
    expect(raw).not.toContain(SECRET_NOTE);
    expect(raw).not.toContain('"notes"');
    expect(raw).not.toContain('authorId');
  });

  it('the employer-context ApplicantCard carries no notes', () => {
    const raw = JSON.stringify(toApplicantCard(appWithNotes, undefined));
    expect(raw).not.toContain(SECRET_NOTE);
    expect(raw).not.toContain('"notes"');
    expect(raw).not.toContain('authorId');
  });
});
