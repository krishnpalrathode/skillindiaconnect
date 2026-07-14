import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';

export interface NoteActor {
  userId: string;
  role: UserRole;
}

/** The contract's NoteEntry. */
export interface NoteEntryDto {
  id: string;
  authorUserId: string;
  authorRole: UserRole;
  body: string;
  createdAt: string;
}

/**
 * Internal application notes (S6b-B2, Screen 26).
 *
 * ADMIN-ONLY RECORDS, structurally unreachable from candidate/employer
 * surfaces: application_notes is a separate table that no candidate- or
 * employer-facing mapper joins (`Application`, `ApplicationDetail`,
 * `ApplicationCard`, `ApplicantCard` and the candidate timeline are all built
 * from `applications` + `application_timeline` only). Adding a note to any
 * non-admin response is a contract violation — the leak-proof test asserts
 * this on raw JSON.
 *
 * Notes may contain judgments/PII by nature (they are an internal record):
 * they live in the DB and are NEVER copied into audit meta — the audit records
 * THAT a note was added/deleted, not what it said.
 *
 * Deletion rule (stated): the note's AUTHOR may delete their own note; a
 * SUPER_ADMIN may delete any note. Everyone else → 403 NOT_NOTE_AUTHOR.
 */
@Injectable()
export class AdminNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Oldest first, per the contract — a conversation reads top-down. */
  async list(applicationId: string): Promise<NoteEntryDto[]> {
    await this.assertApplicationExists(applicationId);
    const notes = await this.prisma.applicationNote.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'asc' },
    });
    return notes.map((n) => this.toEntry(n));
  }

  async add(applicationId: string, body: string, actor: NoteActor): Promise<NoteEntryDto> {
    await this.assertApplicationExists(applicationId);
    const note = await this.prisma.applicationNote.create({
      data: {
        applicationId,
        authorId: actor.userId,
        authorRole: actor.role,
        body,
      },
    });

    await this.auditService.log({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.APPLICATION_NOTE_ADDED,
      module: AUDIT_MODULES.APPLICATIONS,
      targetType: 'Application',
      targetId: applicationId,
      status: AuditStatus.SUCCESS,
      // Ids only — the note's CONTENT never enters the audit trail.
      meta: { noteId: note.id },
    });

    return this.toEntry(note);
  }

  async remove(applicationId: string, noteId: string, actor: NoteActor): Promise<void> {
    const note = await this.prisma.applicationNote.findFirst({
      where: { id: noteId, applicationId },
    });
    if (!note) throw new NotFoundException({ code: 'NOTE_NOT_FOUND' });

    if (note.authorId !== actor.userId && actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException({ code: 'NOT_NOTE_AUTHOR' });
    }

    await this.prisma.applicationNote.delete({ where: { id: noteId } });

    await this.auditService.log({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.APPLICATION_NOTE_DELETED,
      module: AUDIT_MODULES.APPLICATIONS,
      targetType: 'Application',
      targetId: applicationId,
      status: AuditStatus.SUCCESS,
      meta: { noteId },
    });
  }

  private async assertApplicationExists(applicationId: string): Promise<void> {
    const count = await this.prisma.application.count({ where: { id: applicationId } });
    if (count === 0) throw new NotFoundException({ code: 'APPLICATION_NOT_FOUND' });
  }

  private toEntry(note: {
    id: string;
    authorId: string;
    authorRole: UserRole | null;
    body: string;
    createdAt: Date;
  }): NoteEntryDto {
    return {
      id: note.id,
      authorUserId: note.authorId,
      // Every write sets authorRole; the fallback exists only for type safety
      // on the nullable migration column.
      authorRole: note.authorRole ?? UserRole.ADMIN,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    };
  }
}
