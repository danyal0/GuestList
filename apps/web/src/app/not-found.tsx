import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-accent-soft)]">
        <Compass className="h-8 w-8 text-[var(--color-accent)]" aria-hidden />
      </div>
      <h1 className="text-[24px] font-extrabold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-sm text-[15px] text-[var(--color-ink-secondary)]">
        This page moved, was removed, or never existed. Let&apos;s get you back to the good stuff.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Back to Discover</Link>
      </Button>
    </div>
  );
}
