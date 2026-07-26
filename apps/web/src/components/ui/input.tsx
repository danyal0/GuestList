'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, id, 'aria-describedby': ariaDescribedBy, ...props }, ref) => {
    const errorId = error && id ? `${id}-error` : undefined;
    return (
      <div className="w-full">
        <input
          type={type}
          id={id}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(ariaDescribedBy, errorId) || undefined}
          className={cn(
            'flex h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 text-[15px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-tertiary)] transition-colors focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-[var(--color-danger)]',
            className,
          )}
          {...props}
        />
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-[13px] text-[var(--color-danger)]">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
