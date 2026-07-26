import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('skeleton rounded-[var(--radius-md)]', className)}
      {...props}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-hairline)] overflow-hidden">
      <Skeleton className="h-36 w-full rounded-none" />
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}
