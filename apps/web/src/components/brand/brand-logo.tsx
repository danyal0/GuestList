import Image from 'next/image';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 28,
  md: 32,
  lg: 48,
  xl: 72,
} as const;

export function BrandLogo({
  size = 'md',
  className,
  priority = false,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  priority?: boolean;
}) {
  const px = SIZES[size];
  return (
    <Image
      src="/brand/logo.png"
      alt="MKE Plays"
      width={px}
      height={px}
      priority={priority}
      className={cn('rounded-[10px] object-cover', className)}
    />
  );
}
