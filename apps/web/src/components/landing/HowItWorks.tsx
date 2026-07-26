import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { UserPlus, FileCheck2, Handshake, ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

const STEPS = [
  { key: 'step1', Icon: UserPlus },
  { key: 'step2', Icon: FileCheck2 },
  { key: 'step3', Icon: Handshake },
] as const;

/** "How it works" for workers — three numbered steps. Server-rendered, no JS. */
export function HowItWorks({ locale }: { locale: string }) {
  const t = useTranslations('landing.howItWorks');

  return (
    <section aria-labelledby="how-it-works-heading" className="bg-neutral-50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2
            id="how-it-works-heading"
            className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl"
          >
            {t('heading')}
          </h2>
          <p className="mt-2 text-base text-neutral-700">{t('subheading')}</p>
        </div>

        <ol className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6">
          {STEPS.map(({ key, Icon }, i) => (
            <li
              key={key}
              className="relative rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-700 text-white"
                >
                  <Icon className="size-6" />
                </span>
                <span
                  aria-hidden="true"
                  className="text-3xl font-bold tabular-nums text-neutral-200"
                >
                  {i + 1}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-neutral-900">{t(`${key}.title`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-neutral-700">{t(`${key}.body`)}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8">
          <Link
            href={`/${locale}/signup`}
            className={cn(
              buttonVariants({ variant: 'primary', size: 'lg' }),
              'group rounded-xl font-bold shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
            )}
          >
            {t('cta')}
            <ArrowRight
              className="size-5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}
