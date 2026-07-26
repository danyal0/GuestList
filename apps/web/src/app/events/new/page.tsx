'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { createEventSchema } from '@/lib/schemas';
import type { EventSummary, Group } from '@/lib/types';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const RECURRENCE_PRESETS = [
  { value: '', label: 'Does not repeat' },
  { value: 'FREQ=WEEKLY;COUNT=8', label: 'Weekly · 8 times' },
  { value: 'FREQ=WEEKLY;INTERVAL=2;COUNT=6', label: 'Every 2 weeks · 6 times' },
  { value: 'FREQ=MONTHLY;COUNT=6', label: 'Monthly · 6 times' },
];

function NewEventForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedGroup = searchParams.get('groupId') ?? '';
  const { user, hydrated } = useAuthStore();
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [mode, setMode] = React.useState<'IN_PERSON' | 'ONLINE' | 'HYBRID'>('IN_PERSON');

  React.useEffect(() => {
    if (hydrated && !user) router.replace('/login?next=/events/new');
  }, [hydrated, user, router]);

  const myGroups = useQuery({
    queryKey: ['my-groups'],
    queryFn: () => api<Array<Group & { memberRole: string }>>('/groups/mine'),
    enabled: !!user,
  });

  const hostableGroups =
    myGroups.data?.filter((g) => ['OWNER', 'ADMIN', 'MODERATOR'].includes(g.memberRole)) ?? [];

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const groupId = String(form.get('groupId'));
    const values = {
      title: String(form.get('title')),
      description: String(form.get('description')),
      mode,
      locationName: String(form.get('locationName') || '') || undefined,
      address: String(form.get('address') || '') || undefined,
      onlineUrl: String(form.get('onlineUrl') || '') || undefined,
      startTime: String(form.get('startTime')),
      endTime: String(form.get('endTime')),
      capacity: form.get('capacity') ? Number(form.get('capacity')) : undefined,
      recurrenceRule: String(form.get('recurrenceRule') || '') || undefined,
    };

    const parsed = createEventSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
      setErrors(fieldErrors);
      return;
    }
    if (!groupId) {
      setErrors({ groupId: 'Pick a community' });
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const event = await api<EventSummary>('/events', {
        method: 'POST',
        body: JSON.stringify({
          ...parsed.data,
          groupId,
          onlineUrl: parsed.data.onlineUrl || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          startTime: new Date(parsed.data.startTime).toISOString(),
          endTime: new Date(parsed.data.endTime).toISOString(),
        }),
      });
      toast.success('Event published!');
      router.push(`/events/${event.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the event');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[28px] font-extrabold tracking-tight">Host an event</h1>
      <p className="mt-1 text-[15px] text-[var(--color-ink-secondary)]">
        You can host events in communities where you&apos;re a moderator or above.
      </p>

      {myGroups.isSuccess && hostableGroups.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-[15px] text-[var(--color-ink-secondary)]">
          You don&apos;t have hosting permissions in any community yet. Create your own community to
          start hosting.
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
          <div>
            <Label htmlFor="groupId">Community</Label>
            <Select id="groupId" name="groupId" defaultValue={preselectedGroup} error={errors.groupId} required>
              <option value="" disabled>
                Choose a community…
              </option>
              {hostableGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="title">Event title</Label>
            <Input id="title" name="title" placeholder="e.g. Sunrise Hike at Lands End" error={errors.title} required />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="What's the plan? What should people bring? Where exactly do you meet?"
              error={errors.description}
              required
            />
          </div>

          <fieldset>
            <legend className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-secondary)]">
              Format
            </legend>
            <div className="flex gap-2" role="radiogroup">
              {(['IN_PERSON', 'ONLINE', 'HYBRID'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-[var(--radius-md)] border px-4 py-3 text-[14px] font-semibold transition-colors ${
                    mode === m
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-hairline)] bg-[var(--color-surface)]'
                  }`}
                >
                  {m === 'IN_PERSON' ? 'In person' : m === 'ONLINE' ? 'Online' : 'Hybrid'}
                </button>
              ))}
            </div>
          </fieldset>

          {mode !== 'ONLINE' && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="locationName">Venue name</Label>
                <Input id="locationName" name="locationName" placeholder="Lands End Lookout" error={errors.locationName} />
              </div>
              <div>
                <Label htmlFor="address">Address</Label>
                <Input id="address" name="address" placeholder="680 Point Lobos Ave, SF" />
              </div>
            </div>
          )}
          {mode !== 'IN_PERSON' && (
            <div>
              <Label htmlFor="onlineUrl">Meeting link</Label>
              <Input id="onlineUrl" name="onlineUrl" type="url" placeholder="https://meet.example.com/…" error={errors.onlineUrl} />
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="startTime">Starts</Label>
              <Input id="startTime" name="startTime" type="datetime-local" error={errors.startTime} required />
            </div>
            <div>
              <Label htmlFor="endTime">Ends</Label>
              <Input id="endTime" name="endTime" type="datetime-local" error={errors.endTime} required />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="capacity">Capacity (optional)</Label>
              <Input
                id="capacity"
                name="capacity"
                type="number"
                min={1}
                placeholder="Unlimited"
                error={errors.capacity}
              />
              <p className="mt-1.5 text-[13px] text-[var(--color-ink-tertiary)]">
                When full, additional RSVPs join the waitlist automatically.
              </p>
            </div>
            <div>
              <Label htmlFor="recurrenceRule">Repeats</Label>
              <Select id="recurrenceRule" name="recurrenceRule" defaultValue="">
                {RECURRENCE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" loading={loading} size="lg">
              Publish event
            </Button>
            <Button type="button" variant="secondary" size="lg" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function NewEventPage() {
  return (
    <React.Suspense>
      <NewEventForm />
    </React.Suspense>
  );
}
