import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Building2, Check, ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

const POINTS = ['point1', 'point2', 'point3'] as const;

/**
 * Employer-facing section. The CTA reuses the app's existing
 * `?role=employer` signup convention (same href EmployerLoginForm uses).
 */
export function ForEmployers({ locale }: { locale: string }) {
  const t = useTranslations('landing.employers');

  return (
    <section aria-labelledby="employers-heading" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-8 rounded-2xl border border-neutral-200 bg-neutral-50 p-6 sm:p-10 lg:grid-cols-2 lg:gap-12">
          <div>
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-xl bg-primary-700 text-white"
            >
              <Building2 className="size-6" />
            </span>

            <h2
              id="employers-heading"
              className="mt-5 text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl"
            >
              {t('heading')}
            </h2>

            <p className="mt-3 text-base leading-relaxed text-neutral-700">{t('body')}</p>

            <div className="mt-6">
              <Link
                href={`/${locale}/signup?role=employer`}
                className={cn(
                  buttonVariants({ variant: 'secondary', size: 'lg' }),
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

          <ul className="flex flex-col gap-3">
            {POINTS.map((p) => (
              <li
                key={p}
                className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4"
              >
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-bg text-success-fg"
                >
                  <Check className="size-4" />
                </span>
                <span className="text-sm font-medium text-neutral-800">{t(p)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
