import { useTranslations } from 'next-intl';
import { ShieldCheck, Home, HeartPulse, Bus, Lock } from 'lucide-react';

const PILLARS = [
  { key: 'accommodation', Icon: Home },
  { key: 'insurance', Icon: HeartPulse },
  { key: 'transport', Icon: Bus },
] as const;

/**
 * The differentiator section. The claim here is literally true of the product:
 * the API's publish guard rejects any job missing accommodation, health
 * insurance, or transportation (WORKER_PROTECTION_VIOLATION), so this is
 * described as an enforced rule rather than a marketing promise.
 */
export function WorkerProtection() {
  const t = useTranslations('landing.protection');

  return (
    <section
      aria-labelledby="protection-heading"
      className="relative overflow-hidden bg-primary-800 py-16 sm:py-24"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -end-32 top-0 size-[28rem] rounded-full bg-accent-500/15 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-accent-500 text-neutral-900 shadow-lg"
          >
            <ShieldCheck className="size-8" />
          </span>

          <h2
            id="protection-heading"
            className="mt-6 text-2xl font-bold tracking-tight text-white sm:text-4xl"
          >
            {t('heading')}
          </h2>

          <p className="mt-4 text-base leading-relaxed text-white/85 sm:text-lg">{t('lead')}</p>
        </div>

        <ul className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-3">
          {PILLARS.map(({ key, Icon }) => (
            <li
              key={key}
              className="rounded-2xl border border-white/15 bg-white/10 p-6 text-center backdrop-blur-sm"
            >
              <span
                aria-hidden="true"
                className="mx-auto flex size-12 items-center justify-center rounded-xl bg-white/15 text-accent-300"
              >
                <Icon className="size-6" />
              </span>
              <h3 className="mt-4 text-lg font-bold text-white">{t(`${key}.title`)}</h3>
              <p className="mt-1 text-sm text-white/80">{t(`${key}.body`)}</p>
            </li>
          ))}
        </ul>

        <p className="mx-auto mt-10 flex max-w-2xl items-center justify-center gap-2.5 rounded-xl bg-white/10 px-5 py-4 text-center text-sm font-medium text-white sm:text-base">
          <Lock className="size-5 shrink-0 text-accent-300" aria-hidden="true" />
          {t('enforcement')}
        </p>
      </div>
    </section>
  );
}
