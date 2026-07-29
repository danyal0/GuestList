import Image from 'next/image';
import { cn } from '@/lib/utils';

/** Intrinsic ratio of /brand/logo.png (trimmed). */
const LOGO_RATIO = 408 / 445;

const HEIGHTS = {
  sm: 28,
  md: 32,
  lg: 48,
  xl: 72,
  header: 64,
} as const;

export function BrandLogo({
  size = 'md',
  className,
  priority = false,
}: {
  size?: keyof typeof HEIGHTS;
  className?: string;
  priority?: boolean;
}) {
  const height = HEIGHTS[size];
  const width = Math.round(height * LOGO_RATIO);
  return (
    <Image
      src="/brand/logo.png"
      alt="MKE Plays"
      width={width}
      height={height}
      priority={priority}
      className={cn('h-auto w-auto object-contain', className)}
    />
  );
}
