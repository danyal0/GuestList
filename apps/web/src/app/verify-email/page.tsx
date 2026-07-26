'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = React.useState<'verifying' | 'success' | 'error'>('verifying');

  React.useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    api('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
      skipRefresh: true,
    })
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  if (status === 'verifying') {
    return <p className="text-[15px] text-[var(--color-ink-secondary)]">Verifying your email…</p>;
  }
  if (status === 'success') {
    return (
      <div className="space-y-4">
        <p className="text-[15px] text-[var(--color-ink-secondary)]">
          Your email is verified. Welcome aboard! 🎉
        </p>
        <Button asChild className="w-full" size="lg">
          <Link href="/">Start exploring</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-[var(--color-ink-secondary)]">
        This verification link is invalid or has expired. You can request a new one from Settings.
      </p>
      <Button asChild variant="secondary" className="w-full" size="lg">
        <Link href="/settings">Go to settings</Link>
      </Button>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthCard title="Email verification">
      <React.Suspense>
        <VerifyEmailContent />
      </React.Suspense>
    </AuthCard>
  );
}
