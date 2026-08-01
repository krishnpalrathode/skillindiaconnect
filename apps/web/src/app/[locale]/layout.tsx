import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
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

// The brand is localized (hi/ar transliterate it), so the tab-title template lives
// here rather than in the root layout. Pages supply the bare page name; this appends
// the brand, so `metaTitle` values must NOT repeat it.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  const brand = t('brand');

  return {
    title: { default: brand, template: `%s — ${brand}` },
  };
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
