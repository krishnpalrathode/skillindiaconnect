import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AuditStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from './audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus as AuditStatusEnum } from './audit.types';
import {
  DEFAULT_WINDOW_DAYS,
  EXPORT_MAX_RANGE_DAYS,
  EXPORT_MAX_ROWS,
  LogQueryDto,
} from './dto/log-query.dto';

const DEFAULT_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The wire shape (contract: AuditLogEntry). `id` is a STRING — see below. */
export interface AuditLogEntryDto {
  id: string;
  createdAt: string;
  module: string;
  action: string;
  actorUserId: string | null;
  actorRole: UserRole | null;
  targetType: string | null;
  targetId: string | null;
  status: AuditStatus;
  meta: unknown;
}

export interface LogPage {
  data: AuditLogEntryDto[];
  nextCursor: string | null;
}

/**
 * The READ side of the audit trail (Screen 29). S2-B2 shipped write-only on
 * purpose; this is its query half.
 *
 * THREE design decisions, all forced by the physical schema (migration 0000):
 *
 * 1. KEYSET ON THE BigInt PK, NOT OFFSET. `audit_logs.id` is a BigInt
 *    autoincrement, so it is monotonic with insertion AND unique — the only
 *    column that is both. `WHERE id < :cursor ORDER BY id DESC LIMIT n` therefore
 *    walks the trail with no skipped and no duplicated rows even while new rows
 *    are being inserted concurrently (a new row gets a HIGHER id, so it lands
 *    ahead of the walk, never inside it). OFFSET would shift the window under
 *    every insert and silently duplicate rows; `ORDER BY createdAt` without a
 *    tiebreaker is non-deterministic across equal timestamps.
 *
 * 2. A BOUNDED DEFAULT WINDOW. The only createdAt index is BRIN, which
 *    accelerates RANGE scans, not unfiltered ones. An admin opening Screen 29
 *    with no filters would otherwise walk an append-only, unbounded table from
 *    the newest end — cheap today, a full scan in a year. So an absent date range
 *    means "the last DEFAULT_WINDOW_DAYS (30) days", not "everything". Callers
 *    widen it EXPLICITLY by passing `from`.
 *
 * 3. NO FREE-TEXT OVER `meta`. See LogQueryDto — `q` is scoped to structured
 *    columns; searching the JSONB is declined.
 *
 * `meta` is returned EXACTLY AS STORED. B2's redaction denylist already
 * guarantees no raw PII is in it; re-redacting here would create a second,
 * silently-diverging implementation of that guarantee.
 */
@Injectable()
export class AuditQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ── The query ──────────────────────────────────────────────────────────────

  async query(dto: LogQueryDto): Promise<LogPage> {
    const limit = dto.limit ?? DEFAULT_LIMIT;
    const where = this.buildWhere(dto);

    // Fetch one extra to know whether another page exists without a COUNT.
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      data: page.map(toEntryDto),
      // The cursor is the last row's id — the next page is strictly older.
      nextCursor: hasMore ? String(page[page.length - 1]!.id) : null,
    };
  }

  // ── The export (bounded + self-auditing) ───────────────────────────────────

  /**
   * The riskiest endpoint in the console: it turns "read a page" into "walk out
   * with the table". Three controls, and it is only safe with ALL THREE:
   *   - a SEPARATE RBAC key (logs.export — enforced at the controller),
   *   - a HARD CAP (below), and
   *   - a SELF-AUDIT row (below): who extracted what, when.
   */
  async export(
    dto: LogQueryDto,
    actor: { userId: string; role: UserRole },
  ): Promise<{ csv: string; rowCount: number; filename: string }> {
    // Bound 1: the explicit date range may not exceed EXPORT_MAX_RANGE_DAYS.
    if (dto.from && dto.to) {
      const days = (new Date(dto.to).getTime() - new Date(dto.from).getTime()) / DAY_MS;
      if (days > EXPORT_MAX_RANGE_DAYS) {
        throw this.tooLarge();
      }
    }

    const where = this.buildWhere(dto);

    // Bound 2: the row count. Counted BEFORE materializing anything — an
    // unbounded export of an append-only table is a memory incident waiting to
    // happen, and discovering that after loading 2M rows is too late.
    const rowCount = await this.prisma.auditLog.count({ where });
    if (rowCount > EXPORT_MAX_ROWS) {
      throw this.tooLarge();
    }

    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' } });
    const csv = toCsv(rows.map(toEntryDto));

    // THE META-TRAIL. An export is exactly the kind of event the audit log
    // exists to record — so the export records itself. Non-negotiable.
    const fingerprint = filterFingerprint(dto);
    await this.auditService.log({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.AUDIT_EXPORTED,
      module: AUDIT_MODULES.ADMIN,
      targetType: 'AuditLog',
      status: AuditStatusEnum.SUCCESS,
      meta: { filters: fingerprint, rowCount },
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return { csv, rowCount, filename: `audit-log-${stamp}.csv` };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private tooLarge(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      code: 'EXPORT_TOO_LARGE',
      meta: { maxRows: EXPORT_MAX_ROWS, maxRangeDays: EXPORT_MAX_RANGE_DAYS },
    });
  }

  /**
   * Every predicate here hits a structured column. The date range is what the
   * BRIN index on createdAt accelerates — which is why the default window
   * (decision 2 above) is applied when the caller supplies neither bound.
   */
  private buildWhere(dto: LogQueryDto): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};

    if (dto.module) where.module = dto.module;
    if (dto.action) where.action = dto.action;
    if (dto.actorId) where.actorUserId = dto.actorId;
    if (dto.targetId) where.targetId = dto.targetId;
    if (dto.status) where.status = dto.status;

    // Bounded default window — an unfiltered Screen 29 must not scan the trail.
    const from = dto.from ? new Date(dto.from) : undefined;
    const to = dto.to ? new Date(dto.to) : undefined;
    if (from || to) {
      where.createdAt = { ...(from && { gte: from }), ...(to && { lte: to }) };
    } else {
      where.createdAt = { gte: new Date(Date.now() - DEFAULT_WINDOW_DAYS * DAY_MS) };
    }

    // `q` is scoped to STRUCTURED columns — never a scan over meta JSONB.
    if (dto.q) {
      where.OR = [
        { action: { contains: dto.q, mode: 'insensitive' } },
        { targetId: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    // Keyset: strictly older than the cursor (ids descend).
    if (dto.cursor) {
      where.id = { lt: BigInt(dto.cursor) };
    }

    return where;
  }
}

// ── Mappers ──────────────────────────────────────────────────────────────────

/**
 * BigInt → string. `audit_logs.id` exceeds JS's safe integer range, and
 * `JSON.stringify` THROWS on a raw BigInt (B2's spec pinned this). Converting at
 * the mapper is the single serialization point — no global JSON patching.
 */
function toEntryDto(row: {
  id: bigint;
  createdAt: Date;
  module: string;
  action: string;
  actorUserId: string | null;
  actorRole: UserRole | null;
  targetType: string | null;
  targetId: string | null;
  status: AuditStatus;
  meta: unknown;
}): AuditLogEntryDto {
  return {
    id: String(row.id),
    createdAt: row.createdAt.toISOString(),
    module: row.module,
    action: row.action,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    targetType: row.targetType,
    targetId: row.targetId,
    status: row.status,
    // AS STORED — B2 owns the redaction guarantee (see the class docblock).
    meta: row.meta,
  };
}

const CSV_COLUMNS = [
  'id',
  'createdAt',
  'module',
  'action',
  'actorUserId',
  'actorRole',
  'targetType',
  'targetId',
  'status',
  'meta',
] as const;

/** RFC-4180 escaping: quote the field and double any embedded quote. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(entries: AuditLogEntryDto[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = entries.map((e) =>
    CSV_COLUMNS.map((c) => csvCell(e[c as keyof AuditLogEntryDto])).join(','),
  );
  return [header, ...lines].join('\n');
}

/**
 * The filter set, recorded on the self-audit row so "WHAT did they extract?" is
 * answerable months later. Pagination fields are excluded — they describe the
 * transport, not the selection.
 */
function filterFingerprint(dto: LogQueryDto): Record<string, unknown> {
  const selection = {
    module: dto.module,
    action: dto.action,
    actorId: dto.actorId,
    targetId: dto.targetId,
    status: dto.status,
    from: dto.from,
    to: dto.to,
    q: dto.q,
  };
  return Object.fromEntries(Object.entries(selection).filter(([, v]) => v !== undefined));
}
