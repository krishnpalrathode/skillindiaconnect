import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { AuditStatus } from '@prisma/client';
import { AuditService } from './audit.service';
import { AuditSubscriber } from './audit.subscriber';
import { AUDIT_ACTIONS, AUDIT_MODULES } from './audit.types';
import { CANDIDATE_EVENTS } from '../candidate/events/candidate.events';

describe('AuditSubscriber', () => {
  let app: TestingModule;
  let emitter: EventEmitter2;
  let logSpy: jest.MockedFn<AuditService['log']>;

  beforeEach(async () => {
    logSpy = jest.fn().mockResolvedValue(undefined);

    app = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        AuditSubscriber,
        { provide: AuditService, useValue: { log: logSpy } },
      ],
    }).compile();

    await app.init();
    emitter = app.get(EventEmitter2);
  });

  afterEach(() => app.close());

  // ── settings.changed ────────────────────────────────────────────────────────

  describe('settings.changed → settings.update audit row', () => {
    it('emits action=settings.update with module=Settings', async () => {
      await emitter.emitAsync('settings.changed', {
        key: 'worker_protection.accommodation_required',
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.SETTINGS_UPDATE,
          module: AUDIT_MODULES.SETTINGS,
          status: AuditStatus.SUCCESS,
        }),
      );
    });

    it('includes the settings key in targetId and meta', async () => {
      const settingsKey = 'candidates.min_completion_pct';
      await emitter.emitAsync('settings.changed', { key: settingsKey });

      const call = logSpy.mock.calls[0]![0]!;
      expect(call.targetId).toBe(settingsKey);
      expect((call.meta as Record<string, unknown>).key).toBe(settingsKey);
    });

    it('does NOT include password, token, or r2Key in the audit entry', async () => {
      await emitter.emitAsync('settings.changed', {
        key: 'jobs.auto_archive_days',
      });

      const call = logSpy.mock.calls[0]![0]!;
      const serialised = JSON.stringify(call);
      expect(serialised).not.toContain('password');
      expect(serialised).not.toContain('token');
      expect(serialised).not.toContain('r2Key');
    });
  });

  // ── candidate.document.changed ───────────────────────────────────────────────

  describe('candidate.document.changed → document.changed audit row', () => {
    it('emits action=document.changed with module=Candidate', async () => {
      await emitter.emitAsync(CANDIDATE_EVENTS.DOCUMENT_CHANGED, {
        candidateId: 'candidate-uuid-abc123',
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.DOCUMENT_CHANGED,
          module: AUDIT_MODULES.CANDIDATE,
          status: AuditStatus.SUCCESS,
        }),
      );
    });

    it('r2Key is ABSENT from the audit entry meta — document storage keys are PII', async () => {
      // The event payload carries only candidateId (no r2Key), and the subscriber
      // must not fetch or include the r2Key.
      const r2Key = 'candidates/candidate-uuid-abc123/PASSPORT/abc123-passport.pdf';

      await emitter.emitAsync(CANDIDATE_EVENTS.DOCUMENT_CHANGED, {
        candidateId: 'candidate-uuid-abc123',
      });

      const call = logSpy.mock.calls[0]![0]!;
      const serialised = JSON.stringify(call);

      // The raw r2Key must not appear anywhere in the logged entry
      expect(serialised).not.toContain('r2Key');
      expect(serialised).not.toContain(r2Key);
      expect(serialised).not.toContain('PASSPORT/');
    });

    it('includes candidateId in targetId', async () => {
      const candidateId = 'candidate-uuid-abc123';
      await emitter.emitAsync(CANDIDATE_EVENTS.DOCUMENT_CHANGED, { candidateId });

      const call = logSpy.mock.calls[0]![0]!;
      expect(call.targetId).toBe(candidateId);
    });
  });

  // ── Independence — one event fires only one audit log call ───────────────────

  it('each event fires exactly one log() call', async () => {
    await emitter.emitAsync('settings.changed', { key: 'key.one' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    logSpy.mockClear();

    await emitter.emitAsync(CANDIDATE_EVENTS.DOCUMENT_CHANGED, { candidateId: 'c-uuid' });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});
