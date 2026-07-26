'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Phone, Mail, Star, Trash2, Plus, UserCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { createContact, updateContact, deleteContact } from '@/lib/api/employer-profile';
import type { components } from '@skillindiaconnect/shared-types';

type ContactPerson = components['schemas']['ContactPerson'];

interface ContactPersonsSectionProps {
  contacts: ContactPerson[];
  onUpdated: (contacts: ContactPerson[]) => void;
}

type FormMode = { kind: 'add' } | { kind: 'edit'; contact: ContactPerson };

interface ContactFormDraft {
  name: string;
  role: string;
  phone: string;
  email: string;
  isPrimary: boolean;
}

function emptyDraft(): ContactFormDraft {
  return { name: '', role: '', phone: '', email: '', isPrimary: false };
}

function draftFromContact(c: ContactPerson): ContactFormDraft {
  return {
    name: c.name,
    role: c.role,
    phone: c.phone ?? '',
    email: c.email ?? '',
    isPrimary: c.isPrimary,
  };
}

interface ContactCardProps {
  contact: ContactPerson;
  onEdit: (c: ContactPerson) => void;
  onDelete: (id: string) => Promise<void>;
  deletingId: string | null;
}

function ContactCard({ contact, onEdit, onDelete, deletingId }: ContactCardProps) {
  const t = useTranslations('employer.profile.contacts');
  const isDeleting = deletingId === contact.id;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
      <UserCircle2 className="mt-0.5 size-8 shrink-0 text-neutral-300" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-neutral-900 break-words">{contact.name}</span>
          {contact.isPrimary && (
            <Badge variant="primary" className="text-xs gap-1">
              <Star className="size-3" aria-hidden="true" />
              {t('primaryBadge')}
            </Badge>
          )}
        </div>
        <p className="text-xs text-neutral-600 mt-0.5">{contact.role}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {contact.phone && (
            <span className="flex items-center gap-1 text-xs text-neutral-600">
              <Phone className="size-3" aria-hidden="true" />
              {contact.phone}
            </span>
          )}
          {contact.email && (
            <span className="flex items-center gap-1 text-xs text-neutral-600">
              <Mail className="size-3" aria-hidden="true" />
              {contact.email}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onEdit(contact)}
          aria-label={`${t('edit')} ${contact.name}`}
          className="text-neutral-600 hover:text-neutral-700"
        >
          {t('edit')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={isDeleting}
          disabled={!!deletingId}
          onClick={() => onDelete(contact.id)}
          aria-label={`${t('delete')} ${contact.name}`}
          className="text-error-fg hover:text-error-fg/80"
        >
          {!isDeleting && <Trash2 className="size-3.5" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

interface ContactFormProps {
  mode: FormMode;
  draft: ContactFormDraft;
  onChange: (field: keyof ContactFormDraft, value: string | boolean) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

function ContactForm({ mode, draft, onChange, onSave, onCancel, saving, error }: ContactFormProps) {
  const t = useTranslations('employer.profile.contacts');
  const tc = useTranslations('common');

  const set = (field: keyof ContactFormDraft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(field, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-primary-200 bg-primary-50/30 p-4">
      <h3 className="text-sm font-semibold text-neutral-900">
        {mode.kind === 'add' ? t('addContact') : t('editContact')}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="cp-name" label={t('nameLabel')} required>
          <Input id="cp-name" value={draft.name} onChange={set('name')} autoFocus />
        </Field>
        <Field id="cp-role" label={t('roleLabel')} required>
          <Input id="cp-role" value={draft.role} onChange={set('role')} />
        </Field>
        <Field id="cp-phone" label={t('phoneLabel')}>
          <Input id="cp-phone" type="tel" value={draft.phone} onChange={set('phone')} />
        </Field>
        <Field id="cp-email" label={t('emailLabel')}>
          <Input id="cp-email" type="email" value={draft.email} onChange={set('email')} />
        </Field>
      </div>
      <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
        <input
          type="checkbox"
          checked={draft.isPrimary}
          onChange={set('isPrimary')}
          className="size-4 rounded border-neutral-300 text-primary-600 focus-visible:ring-[3px] focus-visible:ring-ring/70"
        />
        <span className="text-sm text-neutral-700">{t('makePrimary')}</span>
        <span className="text-xs text-neutral-600">({t('primaryHintNote')})</span>
      </label>
      {error && (
        <p className="text-xs text-error-fg font-medium" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {tc('cancel')}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={onSave}>
          {tc('save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Contact persons section. Supports add, edit, delete and primary-promotion.
 *
 * Setting a contact as primary atomically demotes the old primary server-side.
 * After each mutation the parent refetches the full contacts list so the
 * Primary badge is always accurate.
 *
 * The form is rendered inline (not inside EditableSection) because this section
 * can have multiple contacts and the per-contact edit form is separate from
 * the section-level "Edit" toggle.
 */
export function ContactPersonsSection({ contacts, onUpdated }: ContactPersonsSectionProps) {
  const t = useTranslations('employer.profile.contacts');

  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [draft, setDraft] = useState<ContactFormDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const openAdd = () => {
    setDraft(emptyDraft());
    setError(null);
    setFormMode({ kind: 'add' });
  };

  const openEdit = (c: ContactPerson) => {
    setDraft(draftFromContact(c));
    setError(null);
    setFormMode({ kind: 'edit', contact: c });
  };

  const closeForm = () => {
    setFormMode(null);
    setError(null);
  };

  const handleChange = (field: keyof ContactFormDraft, value: string | boolean) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!draft.name.trim() || !draft.role.trim()) {
      setError(t('nameRoleRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        role: draft.role.trim(),
        phone: draft.phone.trim() || undefined,
        email: draft.email.trim() || undefined,
        isPrimary: draft.isPrimary,
      };
      if (formMode?.kind === 'add') {
        await createContact(payload);
      } else if (formMode?.kind === 'edit') {
        await updateContact(formMode.contact.id, payload);
      }
      // Refetch contacts: parent re-fetches full profile
      onUpdated([]);
      closeForm();
    } catch {
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteContact(id);
      onUpdated([]);
    } catch {
      // Silently fail; user can retry
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section
      aria-label={t('sectionTitle')}
      className="rounded-[18px] border border-neutral-200/70 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
        <h2 className="text-base font-semibold text-neutral-900">{t('sectionTitle')}</h2>
        {!formMode && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openAdd}
            aria-label={t('addContact')}
            className="gap-1.5 text-neutral-600"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t('addContact')}
          </Button>
        )}
      </div>

      <div className="px-5 py-4 flex flex-col gap-3">
        {contacts.length === 0 && !formMode && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <UserCircle2 className="size-10 text-neutral-200" aria-hidden="true" />
            <p className="text-sm text-neutral-600">{t('emptyHint')}</p>
            <Button type="button" variant="outline" size="sm" onClick={openAdd} className="mt-1">
              <Plus className="size-3.5" aria-hidden="true" />
              {t('addContact')}
            </Button>
          </div>
        )}

        {contacts.map((c) =>
          formMode?.kind === 'edit' && formMode.contact.id === c.id ? (
            <ContactForm
              key={c.id}
              mode={formMode}
              draft={draft}
              onChange={handleChange}
              onSave={handleSave}
              onCancel={closeForm}
              saving={saving}
              error={error}
            />
          ) : (
            <ContactCard
              key={c.id}
              contact={c}
              onEdit={openEdit}
              onDelete={handleDelete}
              deletingId={deletingId}
            />
          ),
        )}

        {formMode?.kind === 'add' && (
          <ContactForm
            mode={formMode}
            draft={draft}
            onChange={handleChange}
            onSave={handleSave}
            onCancel={closeForm}
            saving={saving}
            error={error}
          />
        )}
      </div>
    </section>
  );
}
