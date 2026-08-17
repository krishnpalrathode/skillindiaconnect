'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Upload } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EditableSection } from '@/components/profile/EditableSection';
import { DocumentValidity } from '@/components/common/DocumentValidity';
import { FileUpload } from '@/components/upload/FileUpload';
import { VideoIntroUpload } from '@/components/profile/VideoIntroUpload';
import { getCandidateProfile } from '@/lib/api/candidate';
import type { PresignRequest } from '@/lib/api/candidate';
import { MAX_UPLOAD_MB } from '@/lib/uploads';

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

/* Size is the platform-wide ceiling for every type — see lib/uploads.ts. */
const DOC_TYPES: { type: DocType; labelKey: string; hintKey: string; maxMb: number }[] = [
  { type: 'PASSPORT', labelKey: 'passport', hintKey: 'passportHint', maxMb: MAX_UPLOAD_MB },
  {
    type: 'EXPERIENCE_CERT',
    labelKey: 'experienceCert',
    hintKey: 'experienceCertHint',
    maxMb: MAX_UPLOAD_MB,
  },
  {
    type: 'EDUCATIONAL_CERT',
    labelKey: 'educationalCert',
    hintKey: 'educationalCertHint',
    maxMb: MAX_UPLOAD_MB,
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
              /*
                A missing document is the one row a candidate needs to ACT on, and
                it used to be an inert div — the only way to upload was to spot the
                small "Edit" link in the section header, so the page read as
                "documents don't work". The row is now the button that opens the
                upload form.
              */
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="group flex w-full items-center gap-3 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50/40 p-4 text-start transition-colors hover:border-[#0F3D91]/50 hover:bg-[#E8F0FE]/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 transition-colors group-hover:bg-[#E8F0FE] group-hover:text-[#0F3D91]"
                  aria-hidden="true"
                >
                  <Upload className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-neutral-700">{label}</span>
                  <span className="text-xs text-neutral-600">{t('notUploaded')}</span>
                </span>
                <span className="ms-auto shrink-0 text-sm font-semibold text-[#0F3D91]">
                  {t('uploadNow')}
                </span>
              </button>
            )}
          </div>
        );
      })}

      {/* Working video introduction — live (was a "coming soon" placeholder).
          It owns its own fetch/upload state and its own buttons, so it is not
          threaded through this section's edit form: it is not a profile FIELD,
          it is a separate object with its own lifecycle. Rendered in both the
          read and edit views so it is reachable either way — only one of the
          two is ever mounted. */}
      <VideoIntroUpload />

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
              <Field
                id="profile-passport-expiry"
                label={tUpload('passportExpiryLabel')}
                required
                /*
                  The passport dropzone is disabled until this is filled. Without
                  saying so ON the field, clicking the dropzone just did nothing
                  and the upload looked broken — so the reason lives here, where
                  the blocking input is, not only in the dropzone's hint.
                */
                hint={needsExpiry ? tUpload('passportExpiryRequired') : undefined}
              >
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

      {/* Working video introduction — live (was a "coming soon" placeholder).
          It owns its own fetch/upload state and its own buttons, so it is not
          threaded through this section's edit form: it is not a profile FIELD,
          it is a separate object with its own lifecycle. Rendered in both the
          read and edit views so it is reachable either way — only one of the
          two is ever mounted. */}
      <VideoIntroUpload />
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
