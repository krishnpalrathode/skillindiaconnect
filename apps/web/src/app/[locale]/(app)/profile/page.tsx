'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { BrandLoader } from '@/components/ui/brand-loader';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { ApplyUnlockedDialog } from '@/components/profile/ApplyUnlockedDialog';
import { ProfileStats } from '@/components/profile/ProfileStats';
import { PersonalInfoSection } from '@/components/profile/sections/PersonalInfoSection';
import { ExperienceSection } from '@/components/profile/sections/ExperienceSection';
import { DocumentsSection } from '@/components/profile/sections/DocumentsSection';
import { SkillsSection } from '@/components/profile/sections/SkillsSection';
import { AccountSettingsSection } from '@/components/profile/sections/AccountSettingsSection';
import { getCandidateProfile, getCandidateCompletion } from '@/lib/api/candidate';
import { useAuth } from '@/lib/auth/auth-context';
import { homePathForRole } from '@/lib/auth/home-path';
import { ApiRequestError } from '@/lib/api/client';
import { PAGE_SHELL } from '@/lib/page-shell';

type CandidateProfile = components['schemas']['CandidateProfile'];
type CompletionResult = components['schemas']['CompletionResult'];

export default function ProfilePage() {
  const t = useTranslations('profile');
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [completion, setCompletion] = useState<CompletionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetchCompletion = useCallback(async () => {
    try {
      const c = await getCandidateCompletion();
      setCompletion(c);
    } catch {
      // Non-fatal — completion data stays stale; user can refresh
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'CANDIDATE') {
      // Send them to THEIR home, not to employer onboarding.
      //
      // This used to redirect every non-candidate to `/employer/onboarding`,
      // which is only correct for an EMPLOYER — an admin was pushed onto an
      // employer registration form. `setLoading(false)` was also never reached
      // on this branch, so if the redirect did not land the page sat on its
      // spinner indefinitely: the "stuck loading" an admin saw on /profile.
      setLoading(false);
      router.replace(homePathForRole(user.role, locale));
      return;
    }

    Promise.all([getCandidateProfile(), getCandidateCompletion()])
      .then(([p, c]) => {
        setProfile(p);
        setCompletion(c);
      })
      .catch((err) => {
        if (err instanceof ApiRequestError && err.error.code === 'NOT_FOUND') {
          router.replace(`/${locale}/onboarding`);
        } else {
          setError(t('loadingError'));
        }
      })
      .finally(() => setLoading(false));
  }, [user, locale, router, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <BrandLoader size="lg" label={t('loading') || 'Loading…'} />
      </div>
    );
  }

  if (error || !profile || !completion) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
        <p className="text-neutral-600 text-center">{error ?? t('loadingError')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-sm text-primary-600 underline"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL}>
      {/*
        Fires once, on the edit that makes this profile good enough to apply
        with. Mounted HERE because this is the screen where a candidate fills
        the details — every section below refetches completion on save, so the
        crossing is observed the moment it happens.
      */}
      <ApplyUnlockedDialog completion={completion} userId={user?.id ?? null} />

      <ProfileHero profile={profile} completion={completion} />

      <ProfileStats profile={profile} />

      <PersonalInfoSection
        profile={profile}
        onProfileUpdate={setProfile}
        onCompletionRefetch={refetchCompletion}
      />

      <ExperienceSection
        profile={profile}
        onProfileUpdate={setProfile}
        onCompletionRefetch={refetchCompletion}
      />

      {/* Anchor target for PASSPORT_EXPIRY notifications (/profile#documents). */}
      <div id="documents" className="scroll-mt-20">
        <DocumentsSection
          profile={profile}
          onProfileUpdate={setProfile}
          onCompletionRefetch={refetchCompletion}
        />
      </div>

      <SkillsSection
        profile={profile}
        onProfileUpdate={setProfile}
        onCompletionRefetch={refetchCompletion}
      />

      {/* Anchor target for the sidebar "Settings" nav item
          (/profile#account-settings) — candidate settings have no standalone
          route; this card is them. */}
      <div id="account-settings" className="scroll-mt-20">
        <AccountSettingsSection profile={profile} onProfileUpdate={setProfile} />
      </div>
    </div>
  );
}
