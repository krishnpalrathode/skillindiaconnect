'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { useEmployer } from '@/lib/employer/employer-context';
import { getEmployerProfile } from '@/lib/api/employer-profile';
import { BrandLoader } from '@/components/ui/brand-loader';
import { Button } from '@/components/ui/button';
import { EmployerProfileHero } from '@/components/employer/profile/EmployerProfileHero';
import { CompanyInfoSection } from '@/components/employer/profile/CompanyInfoSection';
import { HiringPreferencesSection } from '@/components/employer/profile/HiringPreferencesSection';
import { ContactPersonsSection } from '@/components/employer/profile/ContactPersonsSection';
import { CompanyDocumentsSection } from '@/components/employer/profile/CompanyDocumentsSection';
import { AccountSettingsSection } from '@/components/employer/profile/AccountSettingsSection';
import type { components } from '@skillindiaconnect/shared-types';
import { EMPLOYER_PAGE_SHELL } from '@/lib/page-shell';

type EmployerProfile = components['schemas']['EmployerProfile'];
type Company = components['schemas']['Company'];
type HiringPreferences = components['schemas']['HiringPreferences'];
type ContactPerson = components['schemas']['ContactPerson'];

/**
 * Screen 20 — Employer Profile
 *
 * Fetches GET /employers/me/profile (full profile including company, contacts, hiring prefs,
 * logo URL, and profileChecklist). All edits call their respective PATCH/POST/DELETE endpoints
 * and then either update state locally (company patches) or trigger a full profile refetch
 * (contacts, hiring prefs) so profileChecklist.hint stays accurate.
 */
export default function EmployerProfilePage() {
  const t = useTranslations('employer.profile');
  const { company: shellCompany, isLoading: companyLoading } = useEmployer();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [profile, setProfile] = useState<EmployerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect to onboarding when there's no company
  useEffect(() => {
    if (!companyLoading && shellCompany === null) {
      router.replace(`/${locale}/employer/onboarding`);
    }
  }, [companyLoading, shellCompany, router, locale]);

  const fetchProfile = useCallback(async () => {
    try {
      const data = await getEmployerProfile();
      setProfile(data);
      setError(null);
    } catch {
      setError(t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (companyLoading || shellCompany === null) return;
    fetchProfile();
  }, [companyLoading, shellCompany, fetchProfile]);

  const refetch = useCallback(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Update company locally without a full refetch (PATCH returns fresh Company)
  const handleCompanyUpdated = (updated: Company) => {
    setProfile((prev) => (prev ? { ...prev, company: updated } : prev));
  };

  // After hiring prefs save, refetch full profile to update profileChecklist.hint
  const handlePrefsUpdated = (_pref: HiringPreferences) => {
    refetch();
  };

  // After any contact CRUD, refetch full profile for accurate contacts + checklist
  const handleContactsUpdated = (_: ContactPerson[]) => {
    refetch();
  };

  if (companyLoading || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <BrandLoader size="md" label={t('loadingProfile')} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-neutral-200/70 bg-white p-10 text-center shadow-sm">
        <p className="text-sm text-neutral-600">{error}</p>
        <Button variant="outline" size="sm" className="rounded-xl" onClick={refetch}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className={EMPLOYER_PAGE_SHELL}>
      <EmployerProfileHero profile={profile} onProfileUpdate={setProfile} />

      <CompanyInfoSection company={profile.company} onUpdated={handleCompanyUpdated} />

      <HiringPreferencesSection profile={profile} onUpdated={handlePrefsUpdated} />

      <ContactPersonsSection contacts={profile.contacts} onUpdated={handleContactsUpdated} />

      <CompanyDocumentsSection company={profile.company} onRefetch={refetch} />

      <AccountSettingsSection company={profile.company} onUpdated={handleCompanyUpdated} />
    </div>
  );
}
