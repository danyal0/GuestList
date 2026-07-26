'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'glass fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xl)] p-6 shadow-[var(--shadow-float)] focus:outline-none',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="text-[19px] font-bold tracking-tight">
          {title}
        </DialogPrimitive.Title>
        {description && (
          <DialogPrimitive.Description className="mt-1 text-[14px] text-[var(--color-ink-secondary)]">
            {description}
          </DialogPrimitive.Description>
        )}
        <div className="mt-4">{children}</div>
        <DialogPrimitive.Close
          aria-label="Close dialog"
          className="absolute right-4 top-4 rounded-full p-1.5 text-[var(--color-ink-tertiary)] transition-colors hover:bg-[var(--color-surface-3)]"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
