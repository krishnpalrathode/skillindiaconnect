import { Injectable, Logger } from '@nestjs/common';
import { AuditLog, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditEntry } from './audit.types';
import { redact } from './redact';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-safe audit write: NEVER throws into the caller's path.
   *
   * Use for passive / best-effort auditing — subscriber-driven events, status updates,
   * document views. If the insert fails, an app-logger error (PII-safe) is emitted and
   * the failure is swallowed so the audited operation is unaffected.
   *
   * For security-critical audits that must commit atomically with a DB write
   * (blocked publish, admin override) use logInTransaction() instead.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this._insert(this.prisma, entry);
    } catch {
      // Auditing must never break the audited operation — swallow, then alert ops.
      // No PII in the logger: action/module/status are safe; meta is excluded.
      this.logger.error(`audit insert failed: ${entry.module}/${entry.action}`, {
        module: entry.module,
        action: entry.action,
        status: entry.status,
      });
    }
  }

  /**
   * Atomic audit write: participates in the caller's Prisma transaction.
   * The audit row commits iff the surrounding transaction commits — and is absent
   * if the transaction rolls back. Throws on insert failure (propagates to caller,
   * rolling back the transaction).
   *
   * Use for security-critical audits (blocked publish, admin override) where
   * the audit row must be atomically linked to the write.
   */
  async logInTransaction(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await this._insert(tx, entry);
  }

  /**
   * Internal query — the data-access layer for the S6 admin endpoint.
   * NOT an HTTP endpoint; the controller lives in S6.
   */
  async query(filter: {
    module?: string;
    action?: string;
    actorUserId?: string;
    since?: Date;
    limit?: number;
  }): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: {
        ...(filter.module !== undefined && { module: filter.module }),
        ...(filter.action !== undefined && { action: filter.action }),
        ...(filter.actorUserId !== undefined && { actorUserId: filter.actorUserId }),
        ...(filter.since !== undefined && { createdAt: { gte: filter.since } }),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 50,
    });
  }

  private async _insert(
    client: Pick<Prisma.TransactionClient, 'auditLog'>,
    entry: AuditEntry,
  ): Promise<void> {
    const redactedMeta = redact(entry.meta ?? {});
    await client.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        actorRole: entry.actorRole as UserRole | undefined,
        action: entry.action,
        module: entry.module,
        targetType: entry.targetType,
        targetId: entry.targetId,
        ip: entry.ip,
        userAgent: entry.userAgent,
        status: entry.status,
        meta: redactedMeta as Prisma.InputJsonValue,
      },
    });
  }
}
