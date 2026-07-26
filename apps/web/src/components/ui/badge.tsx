import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
        neutral: 'bg-[var(--color-surface-3)] text-[var(--color-ink-secondary)]',
        success: 'bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] text-[var(--color-success)]',
        warning: 'bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)] text-[var(--color-warning)]',
        danger: 'bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] text-[var(--color-danger)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
