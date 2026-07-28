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
import {
  NamedProfileLinkCard,
  type LinkSuggestion,
} from '@/components/auth/named-profile-link-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignupPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [linkSuggestions, setLinkSuggestions] = React.useState<LinkSuggestion[] | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values = {
      name: String(form.get('name')),
      phone: String(form.get('phone')),
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
      const data = await api<{
        user: User;
        accessToken: string;
        linkSuggestions?: LinkSuggestion[];
      }>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        skipRefresh: true,
      });
      setSession(data.user, data.accessToken);
      if (data.linkSuggestions && data.linkSuggestions.length > 0) {
        setLinkSuggestions(data.linkSuggestions);
        toast.success('Account created — check if this WhatsApp activity is yours.');
        return;
      }
      toast.success('Welcome to MKE Plays! Message your WhatsApp tennis group to link your account.');
      router.push('/');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  if (linkSuggestions) {
    return (
      <AuthCard
        title="Link prior activity?"
        subtitle="We found WhatsApp RSVPs under a matching name. Confirm to keep that history."
      >
        <div className="space-y-4">
          <NamedProfileLinkCard
            suggestions={linkSuggestions}
            onDismiss={() => {
              setLinkSuggestions([]);
              router.push('/');
              router.refresh();
            }}
            onLinked={() => {
              /* stay so they can link more if listed */
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              router.push('/');
              router.refresh();
            }}
          >
            Continue to MKE Plays
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Join MKE Plays" subtitle="Name, phone, password — then link WhatsApp from your tennis group.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" autoComplete="name" placeholder="Alex Rivera" error={errors.name} required />
          <p className="mt-1.5 text-[12px] text-[var(--color-ink-tertiary)]">
            Use the same first name friends use in WhatsApp (e.g. Khatera) so we can offer to link prior RSVPs.
          </p>
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+1 414 555 0100"
            error={errors.phone}
            required
          />
          <p className="mt-1.5 text-[12px] text-[var(--color-ink-tertiary)]">
            Use the same number as WhatsApp so we can link your LID automatically.
          </p>
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
