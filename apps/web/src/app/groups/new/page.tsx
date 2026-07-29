'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { createGroupSchema } from '@/lib/schemas';
import type { Group, GroupCategory } from '@/lib/types';
import { CATEGORY_LABELS } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SuggestField, type SuggestOption } from '@/components/forms/suggest-field';

const PRIVACY_OPTIONS = [
  { value: 'PUBLIC', label: 'Public', hint: 'Anyone can find and join instantly' },
  { value: 'PRIVATE', label: 'Private', hint: 'Anyone can find it; joining requires approval' },
  { value: 'HIDDEN', label: 'Hidden', hint: 'Only members can see it exists' },
];

type GroupFields = {
  name?: string;
  description?: string;
  category?: GroupCategory;
  location?: string;
  rules?: string;
};

type GroupSuggestResponse = { items: SuggestOption<GroupFields>[] };

export default function NewGroupPage() {
  const router = useRouter();
  const { user, hydrated } = useAuthStore();
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [privacy, setPrivacy] = React.useState('PUBLIC');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [rules, setRules] = React.useState('');
  const [coverImage, setCoverImage] = React.useState('');
  const [autofillNote, setAutofillNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (hydrated && !user) router.replace('/login?next=/groups/new');
  }, [hydrated, user, router]);

  const loadNameSuggestions = React.useCallback(async (q: string) => {
    const res = await api<GroupSuggestResponse>(
      `/suggestions/groups?${new URLSearchParams({ q })}`,
    );
    return res.items;
  }, []);

  const applySuggestion = (fields: GroupFields, option: SuggestOption<GroupFields>) => {
    if (fields.name) setName(fields.name);
    if (fields.description) setDescription(fields.description);
    if (fields.category) setCategory(fields.category);
    if (fields.location) setLocation(fields.location);
    if (fields.rules) setRules(fields.rules);
    setAutofillNote(
      option.source === 'ai'
        ? 'Filled with an AI suggestion — tweak anything before creating.'
        : option.source === 'group'
          ? 'Filled from a similar community.'
          : 'Filled from venue / sport hints.',
    );
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = {
      name,
      description,
      category,
      privacy,
      location: location || undefined,
      rules: rules || undefined,
      coverImage: coverImage || undefined,
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
        Start typing a name — we&apos;ll autofill from similar communities, venues, or AI.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        <SuggestField<GroupFields>
          id="name"
          name="name"
          label="Community name"
          value={name}
          onChange={setName}
          onApply={applySuggestion}
          loadSuggestions={loadNameSuggestions}
          placeholder="e.g. Milwaukee Tennis Club"
          error={errors.name}
          required
        />

        {autofillNote && (
          <p className="rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] px-3 py-2 text-[13px] text-[var(--color-accent)]">
            {autofillNote}
          </p>
        )}

        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Who is this for? What do you do together? What makes it special?"
            error={errors.description}
            required
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="category">Category</Label>
            <Select
              id="category"
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              error={errors.category}
              required
            >
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
            <Input
              id="location"
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Milwaukee, WI"
            />
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
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            placeholder={'1. Be kind.\n2. Show up when you RSVP.\n3. …'}
            className="min-h-[90px]"
          />
        </div>
        <div>
          <Label htmlFor="coverImage">Cover image URL (optional)</Label>
          <Input
            id="coverImage"
            name="coverImage"
            type="url"
            value={coverImage}
            onChange={(e) => setCoverImage(e.target.value)}
            placeholder="https://…"
            error={errors.coverImage}
          />
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
