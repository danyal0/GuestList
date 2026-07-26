'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { signupSchema } from '@/lib/schemas';
import type { User } from '@/lib/types';
import { useAuthStore } from '@/stores/auth-store';
import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignupPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values = {
      name: String(form.get('name')),
      email: String(form.get('email')),
      password: String(form.get('password')),
    };

    const parsed = signupSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const data = await api<{ user: User; accessToken: string }>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        skipRefresh: true,
      });
      setSession(data.user, data.accessToken);
      toast.success('Welcome to Gatherly! Check your inbox to verify your email.');
      router.push('/');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Join Gatherly" subtitle="Free forever. Find your people in minutes.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" autoComplete="name" placeholder="Alex Rivera" error={errors.name} required />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            error={errors.email}
            required
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="8+ characters, mixed case, a number"
            error={errors.password}
            required
          />
        </div>
        <Button type="submit" loading={loading} className="w-full" size="lg">
          Create account
        </Button>
        <p className="pt-2 text-center text-[13px] leading-relaxed text-[var(--color-ink-tertiary)]">
          By joining you agree to be kind, keep it constructive, and follow community guidelines.
        </p>
        <p className="text-center text-[14px] text-[var(--color-ink-secondary)]">
          Already a member?{' '}
          <Link href="/login" className="font-semibold text-[var(--color-accent)]">
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
