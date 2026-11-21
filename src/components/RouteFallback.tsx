import { Skeleton } from '@/components/ui/skeleton';

/** Shown while a lazily loaded page's code is downloading. */
export function RouteFallback() {
  return (
    <div className="container mx-auto max-w-4xl space-y-4 px-4 py-8" aria-busy="true">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
