import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { Hero } from '@/components/landing/Hero';
import { TrustStrip } from '@/components/landing/TrustStrip';
import { RecentJobs } from '@/components/landing/RecentJobs';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { WorkerProtection } from '@/components/landing/WorkerProtection';
import { ForEmployers } from '@/components/landing/ForEmployers';
import { JobCategories } from '@/components/landing/JobCategories';
import { LandingFooter } from '@/components/landing/LandingFooter';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing.meta' });
  // `absolute` opts out of the layout's `%s — brand` template: the landing title
  // already leads with the brand.
  return { title: { absolute: t('title') }, description: t('description') };
}

/**
 * Public landing page (locale root). Everything between the header and footer
 * is a server component with no client JS, so the page is static HTML + CSS on
 * first paint — no hero image, no video, nothing that can shift layout.
 */
export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing.nav' });

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary-700 focus:px-4 focus:py-2 focus:text-white"
      >
        {t('skipToContent')}
      </a>

      <LandingHeader />

      <main id="main">
        <Hero locale={locale} />
        <TrustStrip />
        {/*
          Jobs come BEFORE "how it works".

          Someone who wants a job wants jobs. Making them read a three-step
          process diagram first asks for patience from the visitor least likely
          to spend any — and the strongest argument this page can make is simply
          that the listings are real and recent. The explainer still earns its
          place; it just answers the second question, not the first.
        */}
        <RecentJobs locale={locale} />
        <HowItWorks locale={locale} />
        <WorkerProtection />
        <ForEmployers locale={locale} />
        <JobCategories locale={locale} />
      </main>

      <LandingFooter />
    </>
  );
}
