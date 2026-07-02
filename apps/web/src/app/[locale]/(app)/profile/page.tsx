'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import type { components } from '@skillindiaconnect/shared-types';
import { Spinner } from '@/components/ui/spinner';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { ProfileStats } from '@/components/profile/ProfileStats';
import { PersonalInfoSection } from '@/components/profile/sections/PersonalInfoSection';
import { ExperienceSection } from '@/components/profile/sections/ExperienceSection';
import { DocumentsSection } from '@/components/profile/sections/DocumentsSection';
import { SkillsSection } from '@/components/profile/sections/SkillsSection';
import { AccountSettingsSection } from '@/components/profile/sections/AccountSettingsSection';
import { getCandidateProfile, getCandidateCompletion } from '@/lib/api/candidate';
import { useAuth } from '@/lib/auth/auth-context';
import { ApiRequestError } from '@/lib/api/client';

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
      router.replace(`/${locale}/onboarding/employer`);
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
        <Spinner size={32} label={t('loading') || 'Loading…'} />
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
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
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

      <DocumentsSection
        profile={profile}
        onProfileUpdate={setProfile}
        onCompletionRefetch={refetchCompletion}
      />

      <SkillsSection
        profile={profile}
        onProfileUpdate={setProfile}
        onCompletionRefetch={refetchCompletion}
      />

      <AccountSettingsSection profile={profile} onProfileUpdate={setProfile} />
    </div>
  );
}
