'use client';

import { Button } from '@/components/ui/button';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center text-center" role="alert">
      <h1 className="text-[24px] font-extrabold tracking-tight">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-[15px] text-[var(--color-ink-secondary)]">
        An unexpected error occurred. Our team has been notified — please try again.
      </p>
      <Button onClick={reset} className="mt-6">
        Try again
      </Button>
    </div>
  );
}
