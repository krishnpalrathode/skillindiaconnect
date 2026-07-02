import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { MockSetup } from '@/mocks/mock-setup';
import { AuthProvider } from '@/lib/auth/auth-context';
import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <MockSetup>
        <AuthProvider>{children}</AuthProvider>
      </MockSetup>
    </NextIntlClientProvider>
  );
}
