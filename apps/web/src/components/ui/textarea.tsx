'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, id, ...props }, ref) => {
    const errorId = error && id ? `${id}-error` : undefined;
    return (
      <div className="w-full">
        <textarea
          id={id}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn(
            'flex min-h-[110px] w-full rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 py-3 text-[15px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-tertiary)] transition-colors focus:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 resize-y',
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
Textarea.displayName = 'Textarea';
