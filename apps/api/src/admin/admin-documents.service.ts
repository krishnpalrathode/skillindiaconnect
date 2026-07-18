import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentType, UserRole } from '@prisma/client';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { EmployerService } from '../employer/employer.service';
import { StorageService } from '../core/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';

/** Contract-fixed grant TTL — the same 300s S5-B3 uses. One number, one meaning. */
export const DOCUMENT_URL_EXPIRY_SECONDS = 300;

export interface DocumentUrlGrant {
  url: string;
  expiresInSeconds: number;
}

export interface AdminActor {
  userId: string;
  role: UserRole;
}

/**
 * Admin document access (S6a-B1, locked decision 5) — employer registration
 * certificates AND candidate documents.
 *
 * Owns no tables: keys come from EmployerService / CandidateReadService, signing
 * comes from S5-B3's StorageService.presignGet (there is exactly ONE signing
 * path in this codebase and this is not a second one).
 *
 * ═══ THE RELAXATION, AND WHY IT IS SAFE ═══
 * The employer document gate (S5-B3) refuses any candidate with
 * `profileVisible = false`. This admin path does NOT — see
 * CandidateReadService.findDocumentKeyForAdmin. That is deliberate: fraud
 * review, disputes and DPDP data-subject requests routinely concern candidates
 * who have hidden themselves, and an admin who cannot see them cannot
 * investigate them.
 *
 * The ONLY thing that makes it defensible is that EVERY grant writes a
 * `document.viewed` audit row naming the acting admin. The relaxation and the
 * audit are ONE control, not two — remove the audit and the relaxation becomes
 * an unlogged backdoor into hidden people's passports. Implement both or
 * neither.
 *
 * The audit meta carries the document TYPE and the subject id — NEVER the R2 key
 * and NEVER the signed URL. (B2's redaction denylist strips `r2key`/`signedurl`
 * anyway; we rely on it AND simply never put them in. The tests assert the raw
 * persisted meta.)
 */
@Injectable()
export class AdminDocumentsService {
  constructor(
    private readonly employerService: EmployerService,
    private readonly candidateRead: CandidateReadService,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Employer registration certificate. S2-B4's admin list carries only the
   * REFERENCE; an admin has to actually READ the document to approve or reject a
   * company, which is what this grants.
   *
   * 404 covers "no such company" and "no certificate on file" — indistinguishable
   * (there is nothing to leak either way, but one 404 keeps the surface uniform).
   */
  async issueEmployerCertificateUrl(
    companyId: string,
    actor: AdminActor,
  ): Promise<DocumentUrlGrant> {
    const r2Key = await this.employerService.getRegistrationCertKey(companyId);
    if (!r2Key) {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }

    const url = await this.storage.presignGet(r2Key, DOCUMENT_URL_EXPIRY_SECONDS);

    await this.auditService.log({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.DOCUMENT_VIEWED,
      module: AUDIT_MODULES.ADMIN,
      targetType: 'CompanyDocument',
      targetId: companyId,
      status: AuditStatus.SUCCESS,
      // TYPE + subject only. No key, no URL.
      meta: { documentType: 'REGISTRATION_CERT', companyId },
    });

    return { url, expiresInSeconds: DOCUMENT_URL_EXPIRY_SECONDS };
  }

  /**
   * Candidate document. Reachable for ANY candidate — visible, hidden, or
   * PENDING_DELETION (see the class docblock; a pending deletion is exactly when
   * a dispute is most likely live). Once the purge worker runs the row and the R2
   * object are gone, so this 404s naturally with no special case.
   *
   * 404 covers "no such candidate", "purged", and "that type was never uploaded"
   * — indistinguishable.
   */
  async issueCandidateDocumentUrl(
    candidateId: string,
    type: DocumentType,
    actor: AdminActor,
  ): Promise<DocumentUrlGrant> {
    const doc = await this.candidateRead.findDocumentKeyForAdmin(candidateId, type);
    if (!doc) {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }

    const url = await this.storage.presignGet(doc.r2Key, DOCUMENT_URL_EXPIRY_SECONDS);

    // THE control that makes the visibility relaxation defensible. Every grant,
    // no exceptions — this is the DPDP who-saw-whose-passport trail.
    await this.auditService.log({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.DOCUMENT_VIEWED,
      module: AUDIT_MODULES.ADMIN,
      targetType: 'CandidateDocument',
      targetId: candidateId,
      status: AuditStatus.SUCCESS,
      // TYPE + subject only. No key, no URL.
      meta: { documentType: type, candidateId },
    });

    return { url, expiresInSeconds: DOCUMENT_URL_EXPIRY_SECONDS };
  }
}
