'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Video } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Badge } from '@/components/ui/badge';
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
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-neutral-800 truncate">{label}</p>
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <FileText className="size-3.5 shrink-0 text-neutral-400" aria-hidden="true" />
        <span className="truncate">{fileName}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={STATUS_VARIANT[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
        <DocumentValidity expiryDate={doc.expiryDate} />
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
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-neutral-700">{label}</p>
                <p className="text-xs text-neutral-400">{t('notUploaded')}</p>
              </div>
            )}
          </div>
        );
      })}

      {/* Video — B6 placeholder */}
      <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-neutral-200 bg-neutral-50">
        <Video className="size-4 text-neutral-400 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-neutral-600">{t('videoIntro')}</p>
          <p className="text-xs text-neutral-400">{t('videoComingSoon')}</p>
        </div>
      </div>

      <p className="text-xs text-neutral-500 font-medium">{t('count', { count: uploadedCount })}</p>
    </div>
  );

  const editForm = (
    <div className="flex flex-col gap-5">
      {DOC_TYPES.map(({ type, labelKey, hintKey, maxMb }) => {
        const existingDoc = getDoc(type);
        const label = t(labelKey as 'passport' | 'experienceCert' | 'educationalCert');
        const hint = tUpload(
          hintKey as 'passportHint' | 'experienceCertHint' | 'educationalCertHint',
        );
        return (
          <div key={type} className="flex flex-col gap-2">
            {existingDoc && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-neutral-50 border border-neutral-200">
                <FileText className="size-4 text-neutral-400 shrink-0" aria-hidden="true" />
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
            <FileUpload
              docType={type}
              label={existingDoc ? t('reupload') : label}
              hint={hint}
              maxMb={maxMb}
              expiryDate={existingDoc?.expiryDate}
              onDone={handleUploadDone(type)}
            />
          </div>
        );
      })}

      {/* Video — B6 placeholder */}
      <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-neutral-200 bg-neutral-50">
        <Video className="size-4 text-neutral-400 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-neutral-600">{t('videoIntro')}</p>
          <p className="text-xs text-neutral-400">{t('videoComingSoon')}</p>
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
