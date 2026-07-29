'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { createEventSchema } from '@/lib/schemas';
import type { EventSummary, Group } from '@/lib/types';
import {
  addMinutesToDateTimeLocal,
  buildAppleRecurrenceRule,
  combineDateAndTime,
} from '@/lib/recurrence';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SuggestField, type SuggestOption } from '@/components/forms/suggest-field';
import {
  AppleSchedulePicker,
  type ScheduleState,
} from '@/components/forms/apple-schedule-picker';

type EventFields = {
  title?: string;
  description?: string;
  mode?: 'IN_PERSON' | 'ONLINE' | 'HYBRID';
  locationName?: string;
  address?: string;
  capacity?: number;
  onlineUrl?: string;
  durationMinutes?: number;
};

type EventSuggestResponse = { items: SuggestOption<EventFields>[] };

function defaultSchedule(): ScheduleState {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setMonth(end.getMonth() + 3);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    dateEnabled: true,
    selectedDate: tomorrow,
    timeEnabled: true,
    startTimeHm: '18:00',
    endTimeHm: '19:30',
    frequency: 'never',
    endMode: 'never',
    endDate: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
    endCount: 8,
    customRule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10',
  };
}

function NewEventForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedGroup = searchParams.get('groupId') ?? '';
  const { user, hydrated } = useAuthStore();
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [groupId, setGroupId] = React.useState(preselectedGroup);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [mode, setMode] = React.useState<'IN_PERSON' | 'ONLINE' | 'HYBRID'>('IN_PERSON');
  const [locationName, setLocationName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [onlineUrl, setOnlineUrl] = React.useState('');
  const [capacity, setCapacity] = React.useState('');
  const [schedule, setSchedule] = React.useState<ScheduleState>(defaultSchedule);
  const [autofillNote, setAutofillNote] = React.useState<string | null>(null);

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

  const loadTitleSuggestions = React.useCallback(
    async (q: string) => {
      const qs = new URLSearchParams({ q });
      if (groupId) qs.set('groupId', groupId);
      const res = await api<EventSuggestResponse>(`/suggestions/events?${qs}`);
      return res.items;
    },
    [groupId],
  );

  const loadVenueSuggestions = React.useCallback(async (q: string) => {
    const res = await api<EventSuggestResponse>(
      `/suggestions/events?${new URLSearchParams({ q })}`,
    );
    return res.items.filter((i) => i.source === 'venue' || i.fields.locationName);
  }, []);

  const applySuggestion = (fields: EventFields, option: SuggestOption<EventFields>) => {
    if (fields.title) setTitle(fields.title);
    if (fields.description) setDescription(fields.description);
    if (fields.mode) setMode(fields.mode);
    if (fields.locationName) setLocationName(fields.locationName);
    if (fields.address) setAddress(fields.address);
    if (fields.onlineUrl) setOnlineUrl(fields.onlineUrl);
    if (fields.capacity) setCapacity(String(fields.capacity));
    if (fields.durationMinutes && schedule.timeEnabled) {
      const start = combineDateAndTime(schedule.selectedDate, schedule.startTimeHm);
      const endLocal = addMinutesToDateTimeLocal(start, fields.durationMinutes);
      const hm = endLocal.slice(11, 16);
      setSchedule((s) => ({ ...s, endTimeHm: hm }));
    }
    setAutofillNote(
      option.source === 'ai'
        ? 'Filled with an AI suggestion — review before publishing.'
        : `Filled from ${option.source === 'event' ? 'a past event' : option.source === 'venue' ? 'the venue catalog' : 'a smart suggestion'}.`,
    );
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!schedule.dateEnabled) {
      setErrors({ startTime: 'Pick a date for the event' });
      return;
    }

    const startLocal = combineDateAndTime(
      schedule.selectedDate,
      schedule.timeEnabled ? schedule.startTimeHm : '09:00',
    );
    const endLocal = schedule.timeEnabled
      ? combineDateAndTime(schedule.selectedDate, schedule.endTimeHm)
      : addMinutesToDateTimeLocal(startLocal, 90);

    // If end time is earlier than start (overnight), push end to next day.
    let endIsoLocal = endLocal;
    if (new Date(endLocal) <= new Date(startLocal)) {
      endIsoLocal = addMinutesToDateTimeLocal(endLocal, 24 * 60);
    }

    const recurrenceRule = buildAppleRecurrenceRule({
      frequency: schedule.frequency,
      endMode: schedule.endMode,
      endDate: schedule.endDate ? new Date(`${schedule.endDate}T00:00:00`) : null,
      endCount: schedule.endCount,
      customRule: schedule.customRule,
    });

    const values = {
      title,
      description,
      mode,
      locationName: locationName || undefined,
      address: address || undefined,
      onlineUrl: onlineUrl || undefined,
      startTime: startLocal,
      endTime: endIsoLocal,
      capacity: capacity ? Number(capacity) : undefined,
      recurrenceRule,
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
    if (schedule.frequency === 'custom' && !recurrenceRule) {
      setErrors({ recurrenceRule: 'Enter a custom recurrence rule' });
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
      toast.success(recurrenceRule ? 'Recurring event published!' : 'Event published!');
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
        Pick a date, choose how it repeats, and type a title to autofill the rest.
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
            <Select
              id="groupId"
              name="groupId"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              error={errors.groupId}
              required
            >
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

          <SuggestField<EventFields>
            id="title"
            name="title"
            label="Event title"
            value={title}
            onChange={setTitle}
            onApply={applySuggestion}
            loadSuggestions={loadTitleSuggestions}
            placeholder="e.g. Tennis at McKinley"
            error={errors.title}
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
              placeholder="What's the plan? What should people bring? Where exactly do you meet?"
              error={errors.description}
              required
            />
          </div>

          <AppleSchedulePicker
            value={schedule}
            onChange={setSchedule}
            error={errors.startTime || errors.endTime || errors.recurrenceRule}
          />

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
              <SuggestField<EventFields>
                id="locationName"
                name="locationName"
                label="Venue name"
                value={locationName}
                onChange={setLocationName}
                onApply={applySuggestion}
                loadSuggestions={loadVenueSuggestions}
                placeholder="McKinley Tennis Courts"
                error={errors.locationName}
              />
              <div>
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  name="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="1750 N Lincoln Memorial Dr"
                />
              </div>
            </div>
          )}
          {mode !== 'IN_PERSON' && (
            <div>
              <Label htmlFor="onlineUrl">Meeting link</Label>
              <Input
                id="onlineUrl"
                name="onlineUrl"
                type="url"
                value={onlineUrl}
                onChange={(e) => setOnlineUrl(e.target.value)}
                placeholder="https://meet.example.com/…"
                error={errors.onlineUrl}
              />
            </div>
          )}

          <div>
            <Label htmlFor="capacity">Capacity (optional)</Label>
            <Input
              id="capacity"
              name="capacity"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Unlimited"
              error={errors.capacity}
            />
            <p className="mt-1.5 text-[13px] text-[var(--color-ink-tertiary)]">
              When full, additional RSVPs join the waitlist automatically.
            </p>
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
