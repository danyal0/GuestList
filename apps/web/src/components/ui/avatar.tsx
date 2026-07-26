'use client';

import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn, initials } from '@/lib/utils';

interface AvatarProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  src?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-[13px]',
  lg: 'h-14 w-14 text-[17px]',
  xl: 'h-24 w-24 text-[28px]',
};

export function Avatar({ src, name, size = 'md', className, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[#5e5ce6]',
        sizes[size],
        className,
      )}
      {...props}
    >
      {src && (
        <AvatarPrimitive.Image
          src={src}
          alt={name}
          className="aspect-square h-full w-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center font-semibold text-white"
        delayMs={src ? 300 : 0}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
