import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading">
      <Skeleton className="h-56 w-full rounded-[var(--radius-xl)]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64" />
        ))}
      </div>
    </div>
  );
}
