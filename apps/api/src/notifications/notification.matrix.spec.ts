/**
 * Spec-conformance test for the notification matrix.
 * Any change to Phase-1 §6's channel assignments must be reflected here.
 * Adding a new NotificationType without a matrix entry will cause a TS error.
 */
import { NotificationType } from '@prisma/client';
import { NOTIFICATION_MATRIX } from './notification.matrix';

describe('NOTIFICATION_MATRIX — Phase-1 §6 locked spec', () => {
  it('covers every NotificationType (no gaps)', () => {
    const matrixKeys = Object.keys(NOTIFICATION_MATRIX);
    const allTypes = Object.values(NotificationType);
    expect(matrixKeys.sort()).toEqual(allTypes.sort());
  });

  // ── APPLICATION events ─────────────────────────────────────────────────────

  it('APPLICATION_SELECTED → whatsapp ✓ · email ✓ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.APPLICATION_SELECTED];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(true);
    expect(e.whatsappTemplate).toBe('wa.selected');
    expect(e.email).toBe(true);
  });

  it('APPLICATION_SHORTLISTED → whatsapp ✗ · email ✓ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.APPLICATION_SHORTLISTED];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(true);
  });

  it('APPLICATION_REJECTED → whatsapp ✗ · email ✓ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.APPLICATION_REJECTED];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(true);
  });

  // ── JOB events ────────────────────────────────────────────────────────────

  it('NEW_JOB_MATCH → whatsapp ✗ · email ✓ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.NEW_JOB_MATCH];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(true);
  });

  it('JOB_CLOSING_SOON → whatsapp ✗ · email ✗ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.JOB_CLOSING_SOON];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(false);
  });

  // ── PROFILE / COMPLIANCE events ───────────────────────────────────────────

  it('PROFILE_REMINDER → whatsapp ✗ · email ✓ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.PROFILE_REMINDER];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(true);
  });

  it('PASSPORT_EXPIRY → whatsapp ✗ · email ✓ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.PASSPORT_EXPIRY];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(true);
  });

  it('PROFILE_VIEWED → whatsapp ✗ · email ✗ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.PROFILE_VIEWED];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(false);
  });

  // ── EMPLOYER events ────────────────────────────────────────────────────────

  it('EMPLOYER_APPROVED → whatsapp ✗ · email ✓ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.EMPLOYER_APPROVED];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(true);
  });

  it('EMPLOYER_REJECTED → whatsapp ✗ · email ✓ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.EMPLOYER_REJECTED];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(true);
  });

  it('EMPLOYER_SUSPENDED → whatsapp ✗ · email ✓ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.EMPLOYER_SUSPENDED];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(true);
  });

  // ── SUBSCRIPTION events ────────────────────────────────────────────────────

  it.each([
    NotificationType.SUBSCRIPTION_PURCHASED,
    NotificationType.SUBSCRIPTION_EXPIRING,
    NotificationType.SUBSCRIPTION_EXPIRED,
  ])('%s → whatsapp ✗ · email ✓ · inApp ✓', (type) => {
    const e = NOTIFICATION_MATRIX[type];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(false);
    expect(e.email).toBe(true);
  });

  // ── CANDIDATE_MATCHES ─────────────────────────────────────────────────────

  it('CANDIDATE_MATCHES → inApp ✓ · email ✓ (WhatsApp opt-in when template approved)', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.CANDIDATE_MATCHES];
    expect(e.inApp).toBe(true);
    expect(e.email).toBe(true);
  });

  // ── RESUME_SENT (CR-001) ───────────────────────────────────────────────────

  it('RESUME_SENT → whatsapp ✓ (wa.resume_doc) · email ✗ · inApp ✓', () => {
    const e = NOTIFICATION_MATRIX[NotificationType.RESUME_SENT];
    expect(e.inApp).toBe(true);
    expect(e.whatsapp).toBe(true);
    expect(e.whatsappTemplate).toBe('wa.resume_doc');
    expect(e.email).toBe(false);
  });

  // ── Structural invariants ─────────────────────────────────────────────────

  it('every whatsapp=true entry has a whatsappTemplate', () => {
    for (const [type, entry] of Object.entries(NOTIFICATION_MATRIX)) {
      if (entry.whatsapp) {
        expect(entry.whatsappTemplate).toBeTruthy();
        `${type} is missing whatsappTemplate`;
      }
    }
  });

  it('at least one inApp-only type (no external channels)', () => {
    const inAppOnly = Object.values(NOTIFICATION_MATRIX).filter(
      (e) => e.inApp && !e.whatsapp && !e.email,
    );
    expect(inAppOnly.length).toBeGreaterThan(0);
  });
});
