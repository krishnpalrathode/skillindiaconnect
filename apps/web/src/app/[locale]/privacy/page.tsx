import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StaticPageShell } from '@/components/landing/StaticPageShell';
import { LegalSections, type LegalSection } from '@/components/landing/LegalSections';

/** Draft date for the policy text below. Bump when the copy changes. */
const LAST_UPDATED_ISO = '2026-07-26';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'staticPages.privacy' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'staticPages.privacy' });
  const sections = t.raw('sections') as LegalSection[];

  const lastUpdated = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
    new Date(LAST_UPDATED_ISO),
  );

  return (
    <StaticPageShell
      locale={locale}
      title={t('title')}
      lead={t('lead')}
      lastUpdated={lastUpdated}
      draftNotice
    >
      <LegalSections sections={sections} />
    </StaticPageShell>
  );
}
