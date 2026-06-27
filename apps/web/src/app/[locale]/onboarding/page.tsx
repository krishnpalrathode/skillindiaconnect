import { useTranslations } from 'next-intl';

export default function OnboardingPage() {
  const t = useTranslations('auth');
  return (
    <main className="flex min-h-svh items-center justify-center">
      <p className="text-neutral-600">{t('onboardingComingSoon')}</p>
    </main>
  );
}
