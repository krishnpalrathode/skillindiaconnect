import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StaticPageShell } from '@/components/landing/StaticPageShell';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'staticPages.about' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * The four "how we're different" points share one shape — an emphasized lead-in
 * and a plain-language explanation. Keyed 1..4 so the copy stays in the message
 * files (translatable, RTL-safe) and the component stays a loop.
 */
const DIFFERENTIATORS = [1, 2, 3, 4] as const;

/**
 * Public, server-rendered About page — vision, mission, and about-us.
 *
 * Long-form prose deliberately unadorned: no imagery, no stats, no icons. This
 * is a trust page a worker may read before handing over their passport, so it
 * leans on whitespace and typography rather than decoration. Every claim here is
 * enforced in the product (publish gate, viewer-aware DTOs, employer review).
 *
 * One h1 (in StaticPageShell's header band), each section an h2. Logical
 * properties throughout (border-s / ps-*) so the pull-quote accent and text flow
 * mirror correctly under `dir="rtl"` for Arabic.
 */
export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'staticPages.about' });

  return (
    <StaticPageShell locale={locale} title={t('title')} lead={t('lead')}>
      <div className="flex flex-col gap-12">
        {/* Vision */}
        <section aria-labelledby="about-vision">
          <h2 id="about-vision" className="text-2xl font-bold tracking-tight text-neutral-900">
            {t('visionHeading')}
          </h2>
          <p className="mt-4 border-s-4 border-primary-600 ps-5 text-xl font-semibold leading-snug text-neutral-900">
            {t('visionStatement')}
          </p>
          <p className="mt-4 text-base leading-relaxed text-neutral-700">{t('visionBody')}</p>
        </section>

        {/* Mission */}
        <section aria-labelledby="about-mission">
          <h2 id="about-mission" className="text-2xl font-bold tracking-tight text-neutral-900">
            {t('missionHeading')}
          </h2>
          <p className="mt-4 border-s-4 border-primary-600 ps-5 text-xl font-semibold leading-snug text-neutral-900">
            {t('missionStatement')}
          </p>
          <p className="mt-4 text-base leading-relaxed text-neutral-700">{t('missionBody')}</p>
          <p className="mt-4 text-base font-medium leading-relaxed text-primary-700">
            {t('missionFree')}
          </p>
        </section>

        {/* Why we exist */}
        <section aria-labelledby="about-why">
          <h2 id="about-why" className="text-2xl font-bold tracking-tight text-neutral-900">
            {t('whyHeading')}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-neutral-700">{t('whyBody1')}</p>
          <p className="mt-4 text-base leading-relaxed text-neutral-700">{t('whyBody2')}</p>
        </section>

        {/* How we're different */}
        <section aria-labelledby="about-different">
          <h2 id="about-different" className="text-2xl font-bold tracking-tight text-neutral-900">
            {t('differentHeading')}
          </h2>
          <ul className="mt-4 flex flex-col gap-5">
            {DIFFERENTIATORS.map((n) => (
              <li key={n} className="text-base leading-relaxed text-neutral-700">
                <strong className="font-semibold text-neutral-900">{t(`different${n}Lead`)}</strong>{' '}
                {t(`different${n}Body`)}
              </li>
            ))}
          </ul>
        </section>

        {/* Who we serve */}
        <section aria-labelledby="about-who">
          <h2 id="about-who" className="text-2xl font-bold tracking-tight text-neutral-900">
            {t('whoHeading')}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-neutral-700">{t('whoBody')}</p>
        </section>
      </div>
    </StaticPageShell>
  );
}
