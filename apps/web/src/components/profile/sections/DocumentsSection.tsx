'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Video } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EditableSection } from '@/components/profile/EditableSection';
import { DocumentValidity } from '@/components/common/DocumentValidity';
import { FileUpload } from '@/components/upload/FileUpload';
import { getCandidateProfile } from '@/lib/api/candidate';
import type { PresignRequest } from '@/lib/api/candidate';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CandidateDocument = components['schemas']['CandidateDocument'];
type DocumentStatus = components['schemas']['DocumentStatus'];
type DocType = PresignRequest['type'];

interface DocumentsSectionProps {
  profile: CandidateProfile;
  onProfileUpdate: (p: CandidateProfile) => void;
  onCompletionRefetch: () => Promise<void>;
}

const STATUS_VARIANT: Record<DocumentStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  VERIFIED: 'success',
  PENDING: 'warning',
  REJECTED: 'error',
};

const STATUS_LABEL: Record<DocumentStatus, string> = {
  VERIFIED: 'Verified',
  PENDING: 'Pending review',
  REJECTED: 'Rejected',
};

const DOC_TYPES: { type: DocType; labelKey: string; hintKey: string; maxMb: number }[] = [
  { type: 'PASSPORT', labelKey: 'passport', hintKey: 'passportHint', maxMb: 10 },
  { type: 'EXPERIENCE_CERT', labelKey: 'experienceCert', hintKey: 'experienceCertHint', maxMb: 5 },
  {
    type: 'EDUCATIONAL_CERT',
    labelKey: 'educationalCert',
    hintKey: 'educationalCertHint',
    maxMb: 5,
  },
];

function DocRow({ doc, label }: { doc: CandidateDocument; label: string }) {
  const fileName = doc.key.split('/').pop() ?? doc.key;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-neutral-200/70 bg-neutral-50/60 p-4 transition-all duration-200 hover:border-[#0F3D91]/20 hover:bg-white hover:shadow-sm">
      <span
        className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#0F3D91]"
        aria-hidden="true"
      >
        <FileText className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="truncate text-sm font-bold text-neutral-900">{label}</p>
        <p className="truncate text-xs text-neutral-600">{fileName}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={STATUS_VARIANT[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
          <DocumentValidity expiryDate={doc.expiryDate} />
        </div>
      </div>
    </div>
  );
}

export function DocumentsSection({
  profile,
  onProfileUpdate,
  onCompletionRefetch,
}: DocumentsSectionProps) {
  const t = useTranslations('profile.documents');
  const tSec = useTranslations('profile.sections');
  const tUpload = useTranslations('onboarding.documentsSkills');

  const [isEditing, setIsEditing] = useState(false);

  function getDoc(type: DocType): CandidateDocument | undefined {
    return (profile.documents ?? []).find((d) => d.type === type);
  }

  // The API rejects a PASSPORT confirm without a FUTURE expiryDate (422
  // INVALID_PASSPORT_EXPIRY), so the date must be collected here — it cannot be
  // inferred from the existing document, whose expiry may itself be in the past.
  const today = new Date().toISOString().slice(0, 10);
  const existingPassportExpiry = getDoc('PASSPORT')?.expiryDate?.slice(0, 10) ?? '';
  const [passportExpiry, setPassportExpiry] = useState(
    existingPassportExpiry > today ? existingPassportExpiry : '',
  );

  function handleUploadDone(_type: DocType) {
    return async (_key: string) => {
      try {
        const updated = await getCandidateProfile();
        onProfileUpdate(updated);
      } catch {
        // Non-fatal — profile will refresh on next user action
      }
      await onCompletionRefetch();
    };
  }

  const uploadedCount = DOC_TYPES.filter((dt) => !!getDoc(dt.type)).length;

  const viewContent = (
    <div className="flex flex-col gap-4">
      {DOC_TYPES.map(({ type, labelKey }) => {
        const doc = getDoc(type);
        const label = t(labelKey as 'passport' | 'experienceCert' | 'educationalCert');
        return (
          <div key={type}>
            {doc ? (
              <DocRow doc={doc} label={label} />
            ) : (
              <div className="flex flex-col gap-0.5 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/40 p-4">
                <p className="text-sm font-semibold text-neutral-700">{label}</p>
                <p className="text-xs text-neutral-600">{t('notUploaded')}</p>
              </div>
            )}
          </div>
        );
      })}

      {/* Video — B6 placeholder */}
      <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-neutral-200 bg-neutral-50/60 p-4">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600"
          aria-hidden="true"
        >
          <Video className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-neutral-600">{t('videoIntro')}</p>
          <p className="text-xs text-neutral-600">{t('videoComingSoon')}</p>
        </div>
      </div>

      <p className="text-xs text-neutral-600 font-medium">{t('count', { count: uploadedCount })}</p>
    </div>
  );

  const editForm = (
    <div className="flex flex-col gap-5">
      {DOC_TYPES.map(({ type, labelKey, hintKey, maxMb }) => {
        const existingDoc = getDoc(type);
        const label = t(labelKey as 'passport' | 'experienceCert' | 'educationalCert');
        const isPassport = type === 'PASSPORT';
        const needsExpiry = isPassport && !passportExpiry;
        const hint = needsExpiry
          ? tUpload('passportExpiryRequired')
          : tUpload(hintKey as 'passportHint' | 'experienceCertHint' | 'educationalCertHint');
        return (
          <div key={type} className="flex flex-col gap-2">
            {existingDoc && (
              <div className="flex items-center gap-2.5 rounded-xl border border-neutral-200/70 bg-neutral-50/60 p-3">
                <FileText className="size-4 text-neutral-600 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-neutral-600 truncate">
                    {existingDoc.key.split('/').pop()}
                  </p>
                  <div className="flex gap-1.5 mt-0.5">
                    <Badge variant={STATUS_VARIANT[existingDoc.status]} className="text-xs">
                      {STATUS_LABEL[existingDoc.status]}
                    </Badge>
                    <DocumentValidity expiryDate={existingDoc.expiryDate} />
                  </div>
                </div>
              </div>
            )}
            {isPassport && (
              <Field id="profile-passport-expiry" label={tUpload('passportExpiryLabel')} required>
                <Input
                  className="h-12 rounded-xl"
                  type="date"
                  value={passportExpiry}
                  min={today}
                  onChange={(e) => setPassportExpiry(e.target.value)}
                />
              </Field>
            )}
            <FileUpload
              docType={type}
              label={existingDoc ? t('reupload') : label}
              hint={hint}
              maxMb={maxMb}
              expiryDate={isPassport ? passportExpiry || undefined : undefined}
              disabled={needsExpiry}
              onDone={handleUploadDone(type)}
            />
          </div>
        );
      })}

      {/* Video — B6 placeholder */}
      <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-neutral-200 bg-neutral-50/60 p-4">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600"
          aria-hidden="true"
        >
          <Video className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-neutral-600">{t('videoIntro')}</p>
          <p className="text-xs text-neutral-600">{t('videoComingSoon')}</p>
        </div>
      </div>
    </div>
  );

  return (
    <EditableSection
      title={tSec('documents')}
      isEditing={isEditing}
      onEdit={() => setIsEditing(true)}
      onCancel={() => setIsEditing(false)}
      onSave={async () => {
        await onCompletionRefetch();
        setIsEditing(false);
      }}
      form={editForm}
    >
      {viewContent}
    </EditableSection>
  );
}
