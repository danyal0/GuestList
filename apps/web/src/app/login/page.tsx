'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { loginSchema } from '@/lib/schemas';
import type { User } from '@/lib/types';
import { useAuthStore } from '@/stores/auth-store';
import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values = {
      identifier: String(form.get('identifier')),
      password: String(form.get('password')),
    };

    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const data = await api<{ user: User; accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        skipRefresh: true,
      });
      setSession(data.user, data.accessToken);
      toast.success(`Welcome back, ${data.user.name.split(' ')[0]}!`);
      router.push(searchParams.get('next') ?? '/');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <Label htmlFor="identifier">Phone</Label>
        <Input
          id="identifier"
          name="identifier"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+1 414 555 0100"
          error={errors.identifier}
          required
        />
        <p className="mt-1.5 text-[12px] text-[var(--color-ink-tertiary)]">
          Email still works for older accounts.
        </p>
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="mb-1.5 text-[13px] font-semibold text-[var(--color-accent)]"
          >
            Forgot?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          error={errors.password}
          required
        />
      </div>
      <Button type="submit" loading={loading} className="w-full" size="lg">
        Sign in
      </Button>
      <p className="pt-2 text-center text-[14px] text-[var(--color-ink-secondary)]">
        New to MKE Plays?{' '}
        <Link href="/signup" className="font-semibold text-[var(--color-accent)]">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthCard title="Welcome back" subtitle="Sign in with your phone to pick up where you left off.">
      <React.Suspense>
        <LoginForm />
      </React.Suspense>
    </AuthCard>
  );
}
