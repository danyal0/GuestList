'use client';

import * as React from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ForgotPasswordPage() {
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email')).trim();
    if (!email) return;
    setLoading(true);
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
        skipRefresh: true,
      });
      setSent(true);
    } catch {
      // Same UX either way — never reveal whether the account exists.
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthCard
        title="Check your inbox"
        subtitle="If an account exists for that email, we sent a reset link. It expires in 1 hour."
      >
        <Button asChild className="w-full" size="lg">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we'll send you a reset link.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
        </div>
        <Button type="submit" loading={loading} className="w-full" size="lg">
          Send reset link
        </Button>
        <p className="text-center text-[14px] text-[var(--color-ink-secondary)]">
          Remembered it?{' '}
          <Link href="/login" className="font-semibold text-[var(--color-accent)]">
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
