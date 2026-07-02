import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { JobCard } from '@/lib/api/jobs';

interface BenefitChipsProps {
  job: Pick<JobCard, 'market' | 'accommodation' | 'healthInsurance' | 'transportation'>;
  className?: string;
}

/**
 * The API only ever sends three benefit booleans (accommodation,
 * healthInsurance, transportation) — there's no separate PF/ESI/Bonus field.
 * Per spec, the SAME three flags are relabeled by market: LOCAL (India)
 * jobs read as the statutory benefit bundle (PF/ESI/Bonus); GULF jobs read
 * as the worker-protection bundle that's mandatory to publish there
 * (Accommodation/Transport/Food). A chip only renders when its flag is true.
 */
export function BenefitChips({ job, className }: BenefitChipsProps) {
  const t = useTranslations('jobs.benefits');
  const isLocal = job.market === 'LOCAL';

  const chips: string[] = [];
  if (job.accommodation) chips.push(isLocal ? t('pf') : t('accommodation'));
  if (job.transportation) chips.push(isLocal ? t('bonus') : t('transport'));
  if (job.healthInsurance) chips.push(isLocal ? t('esi') : t('food'));

  if (chips.length === 0) return null;

  return (
    <ul
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      aria-label={t('listLabel')}
    >
      {chips.map((label) => (
        <li key={label}>
          <Badge variant="success">{label}</Badge>
        </li>
      ))}
    </ul>
  );
}
