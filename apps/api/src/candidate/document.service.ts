import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CandidateDocument, DocumentType } from '@prisma/client';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../core/prisma/prisma.service';
import { assessPassportValidity, PASSPORT_MIN_VALIDITY_DAYS } from './passport-validity';
import { StorageService } from '../core/storage/storage.service';
import { QUEUE_NAMES, JOB_NAMES, R2_DELETE_JOB_OPTS } from '../queue/queue.constants';
import { CANDIDATE_EVENTS, CandidateChangedPayload } from './events/candidate.events';
import {
  ACCEPTED_DOC_TYPES,
  AcceptedDocType,
  DOC_LIMITS,
  PASSPORT_DOC_TYPE,
} from './document.constants';
import { PresignDocumentDto } from './dto/presign-document.dto';
import { ConfirmDocumentDto } from './dto/confirm-document.dto';

@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue(QUEUE_NAMES.R2_DELETE) private readonly r2DeleteQueue: Queue,
  ) {}

  async presign(
    dto: PresignDocumentDto,
    candidateId: string,
  ): Promise<{ uploadUrl: string; key: string; expiresInSeconds: number }> {
    // WORKING_VIDEO is Phase 2 — not supported at MVP.
    if (dto.type === 'WORKING_VIDEO') {
      throw new UnprocessableEntityException({ code: 'VIDEO_NOT_SUPPORTED_AT_MVP' });
    }
    if (!ACCEPTED_DOC_TYPES.includes(dto.type as AcceptedDocType)) {
      throw new UnprocessableEntityException({ code: 'INVALID_DOC_TYPE' });
    }
    const limits = DOC_LIMITS[dto.type as AcceptedDocType];
    if (!limits.mimes.includes(dto.mimeType)) {
      throw new UnprocessableEntityException({ code: 'INVALID_FILE_TYPE' });
    }
    // First-line size check on declared value — the real gate is the HEAD check in confirm().
    if (dto.sizeBytes > limits.maxBytes) {
      throw new UnprocessableEntityException({ code: 'FILE_TOO_LARGE' });
    }
    // Safe file name: keep alphanumeric, dots, hyphens, underscores.
    const safeFileName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `candidates/${candidateId}/${dto.type}/${uuidv4()}-${safeFileName}`;
    const { url, expiresInSeconds } = await this.storage.presignPut({
      key,
      contentType: dto.mimeType,
      maxBytes: limits.maxBytes,
    });
    return { uploadUrl: url, key, expiresInSeconds };
  }

  async confirm(dto: ConfirmDocumentDto, candidateId: string): Promise<CandidateDocument> {
    // Ownership: key must be under this candidate's prefix.
    const expectedPrefix = `candidates/${candidateId}/`;
    if (!dto.key.startsWith(expectedPrefix)) {
      throw new ForbiddenException({ code: 'KEY_NOT_OWNED' });
    }
    // HEAD check — proves the client actually completed the PUT.
    const head = await this.storage.headObject(dto.key);
    if (!head) {
      throw new UnprocessableEntityException({ code: 'UPLOAD_NOT_FOUND' });
    }
    // Derive type from key: candidates/{candidateId}/{TYPE}/{filename}
    const rawType = dto.key.split('/')[2];
    if (!rawType || !ACCEPTED_DOC_TYPES.includes(rawType as AcceptedDocType)) {
      throw new UnprocessableEntityException({ code: 'INVALID_DOC_TYPE' });
    }
    const docType = rawType as AcceptedDocType;
    const limits = DOC_LIMITS[docType];
    // Re-validate from HEAD (real values — client declarations can be falsified).
    if (head.sizeBytes > limits.maxBytes) {
      throw new UnprocessableEntityException({ code: 'FILE_TOO_LARGE' });
    }
    if (!limits.mimes.includes(head.contentType)) {
      throw new UnprocessableEntityException({ code: 'INVALID_FILE_TYPE' });
    }
    /*
      Passport requires an expiry date with at least the minimum validity left.

      The two failures are kept SEPARATE because the candidate's next action
      differs. A malformed or past date is a data-entry problem — retype it.
      A real date under the six-month floor is a document problem: no amount of
      retyping fixes it, they have to renew the passport. Collapsing both into
      INVALID_PASSPORT_EXPIRY would send someone with a genuinely short-dated
      passport back to correct a date that was already correct.
    */
    let expiryDate: Date | null = null;
    if (docType === PASSPORT_DOC_TYPE) {
      if (!dto.expiryDate) {
        throw new UnprocessableEntityException({ code: 'INVALID_PASSPORT_EXPIRY' });
      }
      const expiry = new Date(dto.expiryDate);
      if (isNaN(expiry.getTime())) {
        throw new UnprocessableEntityException({ code: 'INVALID_PASSPORT_EXPIRY' });
      }
      const validity = assessPassportValidity(expiry);
      if (validity.status === 'expired') {
        throw new UnprocessableEntityException({ code: 'INVALID_PASSPORT_EXPIRY' });
      }
      if (validity.status === 'below_minimum') {
        throw new UnprocessableEntityException({
          code: 'PASSPORT_EXPIRES_TOO_SOON',
          // The numbers travel so the UI can say "expires in 84 days; Gulf
          // employers need 180" rather than restating a rule it might drift from.
          meta: {
            minValidityDays: PASSPORT_MIN_VALIDITY_DAYS,
            daysRemaining: validity.daysRemaining,
          },
        });
      }
      expiryDate = expiry;
    }
    // Upsert on (candidateId, type) — re-upload replaces without a duplicate row.
    const fileName = dto.key.split('/').pop() ?? dto.key;
    const doc = await this.prisma.candidateDocument.upsert({
      where: { candidateId_type: { candidateId, type: docType as DocumentType } },
      create: {
        candidateId,
        type: docType as DocumentType,
        r2Key: dto.key,
        fileName,
        mimeType: head.contentType,
        sizeBytes: head.sizeBytes,
        expiryDate,
      },
      update: {
        r2Key: dto.key,
        fileName,
        mimeType: head.contentType,
        sizeBytes: head.sizeBytes,
        expiryDate,
      },
    });
    // emitAsync so the S1-2 listener recomputes completion before we return.
    await this.eventEmitter.emitAsync(CANDIDATE_EVENTS.DOCUMENT_CHANGED, {
      candidateId,
    } satisfies CandidateChangedPayload);
    return doc;
  }

  async deleteDocument(type: string, candidateId: string): Promise<void> {
    if (!ACCEPTED_DOC_TYPES.includes(type as AcceptedDocType)) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND' });
    }
    const doc = await this.prisma.candidateDocument.findUnique({
      where: { candidateId_type: { candidateId, type: type as DocumentType } },
    });
    if (!doc) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND' });
    }
    await this.prisma.candidateDocument.delete({
      where: { candidateId_type: { candidateId, type: type as DocumentType } },
    });
    // Enqueue object deletion — consumed by R2DeleteProcessor in the worker.
    // BullMQ 5.x forbids ':' in custom jobIds; r2Key contains only alphanumeric, /, -, _.
    await this.r2DeleteQueue.add(
      JOB_NAMES.DELETE_OBJECT,
      { key: doc.r2Key },
      { jobId: `r2del-${doc.r2Key}`, ...R2_DELETE_JOB_OPTS },
    );
    await this.eventEmitter.emitAsync(CANDIDATE_EVENTS.DOCUMENT_CHANGED, {
      candidateId,
    } satisfies CandidateChangedPayload);
  }
}
