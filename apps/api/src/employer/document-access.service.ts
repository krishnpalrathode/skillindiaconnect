import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CompanyStatus, DocumentType, UserRole } from '@prisma/client';
import { EmployerService } from './employer.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { SubscriptionReadService } from '../payments/subscription-read.service';
import { StorageService } from '../core/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';

/** Contract-fixed grant TTL (DocumentUrlGrant.expiresInSeconds). */
export const DOCUMENT_URL_EXPIRY_SECONDS = 300;

export interface DocumentUrlGrant {
  url: string;
  expiresInSeconds: number;
}

/**
 * The Pro document gate (S5-B3) — the ONE surface that turns employer plan
 * status into candidate-document access.
 *
 * Check order is the anti-leak property and is LOCKED:
 *   1. Approved employer          → 403 EMPLOYER_NOT_APPROVED
 *   2. effectivePlan().documentAccess → 403 PLAN_UPGRADE_REQUIRED
 *      (BEFORE any candidate lookup — a Free employer probing an invisible or
 *      nonexistent candidate gets the identical plan 403 and learns NOTHING)
 *   3. Privacy inheritance (S3-B2, via CandidateReadService): nonexistent,
 *      invisible, PENDING_DELETION, and type-not-uploaded are ONE
 *      indistinguishable 404 (single throw site, code NOT_FOUND per contract).
 *   4. 300s signed GET + the per-issuance `document.viewed` audit — the DPDP
 *      who-saw-whose-passport trail. Meta carries the document TYPE, never the
 *      key or URL (the redaction denylist strips those keys anyway; we simply
 *      never put them in).
 *
 * GRACE keeps access (grace is fully paid); EXPIRED loses it — both flow from
 * effectivePlan, never re-derived here.
 */
@Injectable()
export class DocumentAccessService {
  constructor(
    private readonly employerService: EmployerService,
    private readonly subscriptionReadService: SubscriptionReadService,
    private readonly candidateReadService: CandidateReadService,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  async issueDocumentUrl(
    userId: string,
    candidateId: string,
    type: DocumentType,
  ): Promise<DocumentUrlGrant> {
    // 1. Approved employer.
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    if (company.status !== CompanyStatus.APPROVED) {
      throw new ForbiddenException({ code: 'EMPLOYER_NOT_APPROVED' });
    }

    // 2. Plan gate — BEFORE candidate resolution (the upsell driver; order is
    //    the anti-leak property).
    const plan = await this.subscriptionReadService.effectivePlan(company.id);
    if (!plan.documentAccess) {
      throw new ForbiddenException({ code: 'PLAN_UPGRADE_REQUIRED' });
    }

    // 3. Privacy-inherited resolution — one null → one 404 for all causes.
    const doc = await this.candidateReadService.findVisibleDocumentKeyForEmployer(
      candidateId,
      type,
    );
    if (!doc) {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }

    // 4. Short-expiry signed GET + the issuance audit.
    const url = await this.storage.presignGet(doc.r2Key, DOCUMENT_URL_EXPIRY_SECONDS);

    await this.auditService.log({
      actorUserId: userId,
      actorRole: UserRole.EMPLOYER,
      action: AUDIT_ACTIONS.DOCUMENT_VIEWED,
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'CandidateDocument',
      targetId: candidateId,
      status: AuditStatus.SUCCESS,
      // TYPE only — never the r2Key or the signed URL.
      meta: { companyId: company.id, candidateId, documentType: type },
    });

    return { url, expiresInSeconds: DOCUMENT_URL_EXPIRY_SECONDS };
  }
}
