'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all duration-200 ease-[var(--ease-spring)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-accent)] text-white shadow-sm hover:bg-[var(--color-accent-strong)]',
        secondary:
          'bg-[var(--color-surface-3)] text-[var(--color-ink)] hover:bg-[color-mix(in_srgb,var(--color-surface-3)_80%,var(--color-ink)_6%)]',
        ghost: 'text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]',
        outline:
          'border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]',
        destructive: 'bg-[var(--color-danger)] text-white hover:opacity-90',
        glass: 'glass text-[var(--color-ink)] hover:bg-[color-mix(in_srgb,var(--color-surface)_85%,transparent)]',
      },
      size: {
        sm: 'h-8 rounded-[var(--radius-sm)] px-3 text-[13px]',
        md: 'h-11 rounded-[var(--radius-md)] px-5 text-[15px]',
        lg: 'h-[52px] rounded-[var(--radius-lg)] px-7 text-[17px]',
        icon: 'h-10 w-10 rounded-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    if (asChild) {
      // Slot requires exactly one element child, so the loading spinner only
      // applies to real <button> renders.
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
