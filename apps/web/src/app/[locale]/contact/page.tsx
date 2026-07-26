import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Mail, Clock, ShieldAlert, KeyRound } from 'lucide-react';
import { StaticPageShell } from '@/components/landing/StaticPageShell';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

const SUPPORT_EMAIL = 'support@skillindiaconnect.com';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'staticPages.contact' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * Contact page. Deliberately mailto-based rather than a form: there is no
 * contact-message endpoint in the API, and a form that posts nowhere would be
 * a broken promise to a worker reporting a fraudulent job.
 */
export default async function ContactPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'staticPages.contact' });

  const blocks = [
    { key: 'supportHours', Icon: Clock },
    { key: 'report', Icon: ShieldAlert },
    { key: 'account', Icon: KeyRound },
  ] as const;

  return (
    <StaticPageShell locale={locale} title={t('title')} lead={t('lead')}>
      <div className="flex flex-col gap-10">
        {/* Primary contact card */}
        <section
          aria-labelledby="contact-email"
          className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6 sm:p-8"
        >
          <span
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-xl bg-primary-700 text-white"
          >
            <Mail className="size-6" />
          </span>
          <h2 id="contact-email" className="mt-4 text-xl font-bold tracking-tight text-neutral-900">
            {t('emailHeading')}
          </h2>
          <p className="mt-2 text-base leading-relaxed text-neutral-700">{t('emailBody')}</p>

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className={cn(
              buttonVariants({ variant: 'primary', size: 'lg' }),
              'mt-5 rounded-xl font-bold shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
            )}
          >
            <Mail className="size-5" aria-hidden="true" />
            {t('emailCta')}
          </a>

          <p className="mt-3 text-sm font-medium text-neutral-700">{SUPPORT_EMAIL}</p>
        </section>

        {blocks.map(({ key, Icon }) => (
          <section key={key} aria-labelledby={`contact-${key}`}>
            <div className="flex items-start gap-4">
              <span
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <h2
                  id={`contact-${key}`}
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
