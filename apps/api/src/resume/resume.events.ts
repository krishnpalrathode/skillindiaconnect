export const RESUME_EVENTS = {
  /** Emitted by the worker after a generation flips READY (S7-B2 notifies). */
  GENERATED: 'resume.generated',
} as const;

export interface ResumeGeneratedPayload {
  candidateId: string;
  resumeId: string;
  generationId: string;
}
