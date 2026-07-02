import { useTranslations } from 'next-intl';

export default function EmployerOnboardingPage() {
  const t = useTranslations('auth');
  return (
    <main className="flex min-h-svh items-center justify-center">
      <p className="text-neutral-600">{t('employerOnboardingComingSoon')}</p>
    </main>
  );
}
