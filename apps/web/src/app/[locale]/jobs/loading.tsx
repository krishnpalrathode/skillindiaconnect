import { Skeleton } from '@/components/ui/skeleton';

export default function JobsLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Skeleton className="h-9 w-48 sm:h-10 sm:w-64" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>

      {/* Search controls skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 w-24" />
      </div>
      <div className="mt-3 flex gap-3">
        <Skeleton className="h-11 w-64" />
        <Skeleton className="ms-auto h-11 w-40" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        {/* Filters skeleton */}
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-4 w-20" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-24 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>

        {/* Job cards skeleton */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="size-9 rounded-md" />
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-neutral-100">
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
