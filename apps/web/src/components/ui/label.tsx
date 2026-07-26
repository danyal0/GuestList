'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'mb-1.5 block text-[13px] font-semibold text-[var(--color-ink-secondary)] uppercase tracking-wide',
      className,
    )}
    {...props}
  />
));
Label.displayName = 'Label';
