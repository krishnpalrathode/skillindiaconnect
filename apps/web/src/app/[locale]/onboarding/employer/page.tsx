import { redirect } from 'next/navigation';

/**
 * Legacy S1-F1 route. Employer onboarding (Screen 14) lives at
 * /{locale}/employer/onboarding inside the employer shell — this stub only
 * keeps old links/bookmarks working.
 */
export default function LegacyEmployerOnboardingRedirect({
  params,
}: {
  params: { locale: string };
}) {
  redirect(`/${params.locale}/employer/onboarding`);
}
