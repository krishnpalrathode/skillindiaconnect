import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ShieldCheck, HeartHandshake, IndianRupee, Users } from 'lucide-react';
import { StaticPageShell } from '@/components/landing/StaticPageShell';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'staticPages.about' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'staticPages.about' });

  const blocks = [
    { key: 'mission', Icon: HeartHandshake },
    { key: 'protection', Icon: ShieldCheck },
    { key: 'free', Icon: IndianRupee },
    { key: 'who', Icon: Users },
  ] as const;

  return (
    <StaticPageShell locale={locale} title={t('title')} lead={t('lead')}>
      <div className="flex flex-col gap-10">
        {blocks.map(({ key, Icon }) => (
          <section key={key} aria-labelledby={`about-${key}`}>
            <div className="flex items-start gap-4">
              <span
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <h2
                  id={`about-${key}`}
                  className="text-xl font-bold tracking-tight text-neutral-900"
                >
                  {t(`${key}Heading`)}
                </h2>
                <p className="mt-2 text-base leading-relaxed text-neutral-700">{t(`${key}Body`)}</p>
              </div>
            </div>
          </section>
        ))}
      </div>
    </StaticPageShell>
  );
}
