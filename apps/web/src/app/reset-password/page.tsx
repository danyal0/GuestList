'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { passwordSchema } from '@/lib/schemas';
import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password'));
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
        skipRefresh: true,
      });
      toast.success('Password updated. Sign in with your new password.');
      router.push('/login');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed — the link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <p className="text-[15px] text-[var(--color-ink-secondary)]">
        This reset link is invalid. Request a new one from the sign-in page.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="8+ characters, mixed case, a number"
          error={error}
          required
        />
      </div>
      <Button type="submit" loading={loading} className="w-full" size="lg">
        Update password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password" subtitle="This signs you out of all devices.">
      <React.Suspense>
        <ResetPasswordForm />
      </React.Suspense>
    </AuthCard>
  );
}
