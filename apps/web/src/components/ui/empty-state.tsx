import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface)] px-6 py-16 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-accent-soft)]">
        <Icon className="h-7 w-7 text-[var(--color-accent)]" aria-hidden />
      </div>
      <h3 className="text-[17px] font-semibold">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-[14px] text-[var(--color-ink-secondary)]">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'We could not load this content. Please try again.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-6 py-14 text-center',
        className,
      )}
    >
      <h3 className="text-[17px] font-semibold text-[var(--color-danger)]">{title}</h3>
      <p className="mt-1 max-w-sm text-[14px] text-[var(--color-ink-secondary)]">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-surface-3)] px-4 py-2 text-[14px] font-semibold transition-colors hover:bg-[var(--color-accent-soft)]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
