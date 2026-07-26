'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { createGroupSchema } from '@/lib/schemas';
import type { Group } from '@/lib/types';
import { CATEGORY_LABELS } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const PRIVACY_OPTIONS = [
  { value: 'PUBLIC', label: 'Public', hint: 'Anyone can find and join instantly' },
  { value: 'PRIVATE', label: 'Private', hint: 'Anyone can find it; joining requires approval' },
  { value: 'HIDDEN', label: 'Hidden', hint: 'Only members can see it exists' },
];

export default function NewGroupPage() {
  const router = useRouter();
  const { user, hydrated } = useAuthStore();
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [privacy, setPrivacy] = React.useState('PUBLIC');

  React.useEffect(() => {
    if (hydrated && !user) router.replace('/login?next=/groups/new');
  }, [hydrated, user, router]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values = {
      name: String(form.get('name')),
      description: String(form.get('description')),
      category: String(form.get('category')),
      privacy,
      location: String(form.get('location') || '') || undefined,
      rules: String(form.get('rules') || '') || undefined,
      coverImage: String(form.get('coverImage') || '') || undefined,
    };

    const parsed = createGroupSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const body = { ...parsed.data, coverImage: parsed.data.coverImage || undefined };
      const group = await api<Group>('/groups', { method: 'POST', body: JSON.stringify(body) });
      toast.success(`${group.name} is live!`);
      router.push(`/groups/${group.slug}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the community');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[28px] font-extrabold tracking-tight">Create a community</h1>
      <p className="mt-1 text-[15px] text-[var(--color-ink-secondary)]">
        Every great community starts with one person who cares. Today, that&apos;s you.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        <div>
          <Label htmlFor="name">Community name</Label>
          <Input id="name" name="name" placeholder="e.g. Bay Area Trail Collective" error={errors.name} required />
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            placeholder="Who is this for? What do you do together? What makes it special?"
            error={errors.description}
            required
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="category">Category</Label>
            <Select id="category" name="category" error={errors.category} defaultValue="" required>
              <option value="" disabled>
                Pick one…
              </option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="location">Location (optional)</Label>
            <Input id="location" name="location" placeholder="San Francisco, CA" />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-secondary)]">
            Privacy
          </legend>
          <div className="space-y-2">
            {PRIVACY_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-4 transition-colors ${
                  privacy === option.value
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-hairline)] bg-[var(--color-surface)]'
                }`}
              >
                <input
                  type="radio"
                  name="privacy"
                  value={option.value}
                  checked={privacy === option.value}
                  onChange={() => setPrivacy(option.value)}
                  className="mt-1 accent-[var(--color-accent)]"
                />
                <span>
                  <span className="block text-[15px] font-semibold">{option.label}</span>
                  <span className="block text-[13px] text-[var(--color-ink-secondary)]">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <Label htmlFor="rules">Community rules (optional)</Label>
          <Textarea
            id="rules"
            name="rules"
            placeholder={'1. Be kind.\n2. Show up when you RSVP.\n3. …'}
            className="min-h-[90px]"
          />
        </div>
        <div>
          <Label htmlFor="coverImage">Cover image URL (optional)</Label>
          <Input id="coverImage" name="coverImage" type="url" placeholder="https://…" error={errors.coverImage} />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={loading} size="lg">
            Create community
          </Button>
          <Button type="button" variant="secondary" size="lg" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
