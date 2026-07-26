'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
}

/**
 * Native select, styled. Native controls win on mobile (platform pickers,
 * accessibility for free) which fits the mobile-first mandate.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, id, children, ...props }, ref) => {
    const errorId = error && id ? `${id}-error` : undefined;
    return (
      <div className="w-full">
        <div className="relative">
          <select
            id={id}
            ref={ref}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={cn(
              'flex h-11 w-full appearance-none rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 pr-10 text-[15px] text-[var(--color-ink)] transition-colors focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-[var(--color-danger)]',
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-tertiary)]"
            aria-hidden
          />
        </div>
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-[13px] text-[var(--color-danger)]">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Select.displayName = 'Select';
