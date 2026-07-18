import { UserRole } from '@prisma/client';
import { AdminNotesService } from './admin-notes.service';
import type { PrismaService } from '../core/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const AUTHOR = { userId: 'admin-1', role: UserRole.ADMIN };
const OTHER_ADMIN = { userId: 'admin-2', role: UserRole.ADMIN };
const SUPER = { userId: 'super-1', role: UserRole.SUPER_ADMIN };

const NOTE_ROW = {
  id: 'note-1',
  applicationId: 'app-1',
  authorId: 'admin-1',
  authorRole: UserRole.ADMIN,
  body: 'internal judgment about the applicant',
  createdAt: new Date('2026-07-14T00:00:00Z'),
};

function build(overrides?: { note?: typeof NOTE_ROW | null; appCount?: number }) {
  const prisma = {
    application: { count: jest.fn().mockResolvedValue(overrides?.appCount ?? 1) },
    applicationNote: {
      findMany: jest.fn().mockResolvedValue([NOTE_ROW]),
      findFirst: jest
        .fn()
        .mockResolvedValue(overrides?.note === undefined ? NOTE_ROW : overrides.note),
      create: jest.fn().mockResolvedValue(NOTE_ROW),
      delete: jest.fn().mockResolvedValue(NOTE_ROW),
    },
  } as unknown as PrismaService;
  const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { service: new AdminNotesService(prisma, auditService), prisma, auditService };
}

describe('AdminNotesService — internal-only records', () => {
  it('lists OLDEST first (the contract order) and maps to NoteEntry', async () => {
    const { service, prisma } = build();
    const notes = await service.list('app-1');
    expect((prisma.applicationNote.findMany as jest.Mock).mock.calls[0][0].orderBy).toEqual({
      createdAt: 'asc',
    });
    expect(notes[0]).toEqual({
      id: 'note-1',
      authorUserId: 'admin-1',
      authorRole: UserRole.ADMIN,
      body: 'internal judgment about the applicant',
      createdAt: '2026-07-14T00:00:00.000Z',
    });
  });

  it('add() stores author + role and audits IDS ONLY — never the note content', async () => {
    const { service, auditService } = build();
    await service.add('app-1', 'internal judgment about the applicant', AUTHOR);

    const entry = (auditService.log as jest.Mock).mock.calls[0][0];
    expect(entry.action).toBe('application.note.added');
    expect(entry.meta).toEqual({ noteId: 'note-1' });
    // The content NEVER enters the audit trail.
    expect(JSON.stringify(entry)).not.toContain('internal judgment');
  });

  it('unknown application → 404 on list and add', async () => {
    const { service } = build({ appCount: 0 });
    await expect(service.list('nope')).rejects.toMatchObject({
      response: { code: 'APPLICATION_NOT_FOUND' },
    });
    await expect(service.add('nope', 'x', AUTHOR)).rejects.toMatchObject({
      response: { code: 'APPLICATION_NOT_FOUND' },
    });
  });

  describe('the deletion rule: author or SUPER_ADMIN', () => {
    it('the author deletes their own note (audited, ids only)', async () => {
      const { service, prisma, auditService } = build();
      await service.remove('app-1', 'note-1', AUTHOR);
      expect(prisma.applicationNote.delete).toHaveBeenCalledWith({ where: { id: 'note-1' } });
      const entry = (auditService.log as jest.Mock).mock.calls[0][0];
      expect(entry.action).toBe('application.note.deleted');
      expect(JSON.stringify(entry)).not.toContain('internal judgment');
    });

    it('a SUPER_ADMIN deletes anyone’s note', async () => {
      const { service, prisma } = build();
      await service.remove('app-1', 'note-1', SUPER);
      expect(prisma.applicationNote.delete).toHaveBeenCalled();
    });

    it('another ADMIN cannot → 403 NOT_NOTE_AUTHOR', async () => {
      const { service, prisma } = build();
      await expect(service.remove('app-1', 'note-1', OTHER_ADMIN)).rejects.toMatchObject({
        response: { code: 'NOT_NOTE_AUTHOR' },
      });
      expect(prisma.applicationNote.delete).not.toHaveBeenCalled();
    });

    it('a note on a DIFFERENT application → 404 (scoped lookup)', async () => {
      const { service, prisma } = build({ note: null });
      await expect(service.remove('app-2', 'note-1', AUTHOR)).rejects.toMatchObject({
        response: { code: 'NOTE_NOT_FOUND' },
      });
      expect(
        (prisma.applicationNote.findFirst as jest.Mock).mock.calls[0][0].where,
      ).toEqual({ id: 'note-1', applicationId: 'app-2' });
    });
  });
});
