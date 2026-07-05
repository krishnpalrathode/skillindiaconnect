import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

export default async function JobNotFound() {
  const t = await getTranslations('jobs.detail');
  return (
    <main className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
      <h1 className="text-2xl font-bold text-neutral-900">{t('notFoundTitle')}</h1>
      <p className="mt-3 text-neutral-600">{t('notFoundBody')}</p>
      <Link
        href="/jobs"
        className={cn(buttonVariants({ variant: 'secondary' }), 'mt-8 inline-flex')}
      >
        {t('backToJobs')}
      </Link>
    </main>
  );
}
