'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * Bottom sheet on mobile, side panel on desktop — the iOS-style modal
 * presentation for secondary flows.
 */
export function SheetContent({
  className,
  children,
  title,
  side = 'bottom',
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  side?: 'bottom' | 'right';
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          'glass fixed z-50 flex flex-col p-6 shadow-[var(--shadow-float)] focus:outline-none',
          side === 'bottom' &&
            'inset-x-0 bottom-0 max-h-[86dvh] rounded-t-[var(--radius-xl)] pb-[max(env(safe-area-inset-bottom),24px)]',
          side === 'right' && 'inset-y-0 right-0 w-full max-w-md rounded-l-[var(--radius-xl)]',
          className,
        )}
        {...props}
      >
        {side === 'bottom' && (
          <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--color-ink-tertiary)]/40" />
        )}
        <DialogPrimitive.Title className="text-[19px] font-bold tracking-tight">
          {title}
        </DialogPrimitive.Title>
        <div className="mt-4 flex-1 overflow-y-auto">{children}</div>
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1.5 text-[var(--color-ink-tertiary)] transition-colors hover:bg-[var(--color-surface-3)]"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
