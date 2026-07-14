import { ApplicationStatus, NotificationType, UserRole } from '@prisma/client';
import { AdminResendService, RESEND_CAP, RESEND_WINDOW_S } from './admin-resend.service';
import type { PrismaService } from '../core/prisma/prisma.service';
import type { CandidateReadService } from '../candidate/candidate-read.service';
import type { NotificationService } from '../notifications/notification.service';
import type { AuditService } from '../audit/audit.service';
import type { Redis } from 'ioredis';

const ACTOR = { userId: 'admin-1', role: UserRole.ADMIN };

function build(overrides?: {
  app?: Record<string, unknown> | null;
  whatsappCapable?: boolean;
  redisCount?: number;
}) {
  const app =
    overrides?.app === undefined
      ? {
          id: 'app-1',
          status: ApplicationStatus.SELECTED,
          candidateId: 'cand-1',
        }
      : overrides.app;

  const prisma = {
    application: {
      findUnique: jest.fn().mockResolvedValue(app),
      update: jest.fn(), // must NEVER be called — selectedNotifiedAt is a guard
    },
  } as unknown as PrismaService;

  const candidateRead = {
    getNotificationTarget: jest.fn().mockResolvedValue({
      userId: 'user-cand-1',
      whatsappCapable: overrides?.whatsappCapable ?? true,
    }),
  } as unknown as jest.Mocked<CandidateReadService>;

  const notificationService = {
    notify: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<NotificationService>;

  const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const redis = {
    incr: jest.fn().mockResolvedValue(overrides?.redisCount ?? 1),
    expire: jest.fn().mockResolvedValue(1),
  } as unknown as Redis;

  const service = new AdminResendService(
    prisma,
    candidateRead,
    notificationService,
    auditService,
    redis,
  );
  return { service, prisma, candidateRead, notificationService, auditService, redis };
}

describe('AdminResendService — the bypassGuard seam going live', () => {
  it('SELECTED + reason → notify() fires WITHOUT suppressWhatsapp; the row is never written', async () => {
    const { service, prisma, notificationService } = build();

    const result = await service.resendSelectedWhatsapp('app-1', 'candidate never got it', ACTOR);

    expect(notificationService.notify).toHaveBeenCalledTimes(1);
    const [userId, type, , opts] = (notificationService.notify as jest.Mock).mock.calls[0];
    expect(userId).toBe('user-cand-1');
    expect(type).toBe(NotificationType.APPLICATION_SELECTED);
    // The seam's sendWhatsapp:true semantics — nothing suppressed.
    expect(opts?.suppressWhatsapp).toBeUndefined();

    // selectedNotifiedAt is a GUARD, not a "last notified" field: NO application
    // write of any kind happens on a resend.
    expect(prisma.application.update).not.toHaveBeenCalled();

    expect(result.channel).toBe('whatsapp');
    expect(result.resentAt).toBeTruthy();
  });

  it('audits with the reason and capability — and NEVER a phone number', async () => {
    const { service, auditService } = build();
    await service.resendSelectedWhatsapp('app-1', 'delivery failure ticket #9', ACTOR);

    const entry = (auditService.log as jest.Mock).mock.calls[0][0];
    expect(entry.action).toBe('application.whatsapp.resent');
    expect(entry.meta.reason).toBe('delivery failure ticket #9');
    const raw = JSON.stringify(entry);
    expect(raw).not.toMatch(/\+?\d{10,}/); // no phone-shaped string anywhere
    expect(raw).not.toContain('phone');
  });

  it('whatsappCapable=false → the honest email_fallback answer (S2-B3 downgrade)', async () => {
    const { service, notificationService } = build({ whatsappCapable: false });
    const result = await service.resendSelectedWhatsapp('app-1', 'x', ACTOR);
    expect(result.channel).toBe('email_fallback');
    // The enqueue still goes through notify() — the WORKER owns the downgrade.
    expect(notificationService.notify).toHaveBeenCalled();
  });

  it('non-SELECTED → 422 APPLICATION_NOT_SELECTED, nothing enqueued', async () => {
    const { service, notificationService } = build({
      app: { id: 'app-1', status: ApplicationStatus.PENDING, candidateId: 'cand-1' },
    });
    await expect(service.resendSelectedWhatsapp('app-1', 'x', ACTOR)).rejects.toMatchObject({
      response: { code: 'APPLICATION_NOT_SELECTED' },
    });
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('unknown application → 404', async () => {
    const { service } = build({ app: null });
    await expect(service.resendSelectedWhatsapp('nope', 'x', ACTOR)).rejects.toMatchObject({
      response: { code: 'APPLICATION_NOT_FOUND' },
    });
  });

  it(`over the cap (${RESEND_CAP}/24h) → 429 RATE_LIMITED, nothing enqueued`, async () => {
    const { service, notificationService, redis } = build({ redisCount: RESEND_CAP + 1 });
    await expect(service.resendSelectedWhatsapp('app-1', 'x', ACTOR)).rejects.toMatchObject({
      status: 429,
      response: { code: 'RATE_LIMITED' },
    });
    expect(notificationService.notify).not.toHaveBeenCalled();
    // The budget key follows the S1-1 pattern (INCR, EXPIRE on first hit only).
    expect(redis.incr).toHaveBeenCalledWith('resend:wa:app-1');
    expect(redis.expire).not.toHaveBeenCalled(); // count > 1 → no fresh window
  });

  it('the first resend of the window sets the 24h expiry', async () => {
    const { service, redis } = build({ redisCount: 1 });
    await service.resendSelectedWhatsapp('app-1', 'x', ACTOR);
    expect(redis.expire).toHaveBeenCalledWith('resend:wa:app-1', RESEND_WINDOW_S);
  });

  it('a tombstoned candidate (null candidateId) → 422 CANDIDATE_UNAVAILABLE', async () => {
    const { service } = build({
      app: { id: 'app-1', status: ApplicationStatus.SELECTED, candidateId: null },
    });
    await expect(service.resendSelectedWhatsapp('app-1', 'x', ACTOR)).rejects.toMatchObject({
      response: { code: 'CANDIDATE_UNAVAILABLE' },
    });
  });
});
