import { WifiOff } from 'lucide-react';

export const metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-surface-3)]">
        <WifiOff className="h-8 w-8 text-[var(--color-ink-tertiary)]" aria-hidden />
      </div>
      <h1 className="text-[24px] font-extrabold tracking-tight">You&apos;re offline</h1>
      <p className="mt-2 max-w-sm text-[15px] text-[var(--color-ink-secondary)]">
        MKE Plays needs a connection for fresh content. Recently viewed pages may still work — or try
        again once you&apos;re back online.
      </p>
    </div>
  );
}
