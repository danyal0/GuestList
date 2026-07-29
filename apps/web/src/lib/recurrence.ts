/** Apple Reminders–style recurrence presets → iCalendar RRULE fragments. */

export type RepeatFrequency =
  | 'never'
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'yearly'
  | 'custom';

export type EndRepeatMode = 'never' | 'date' | 'count';

export const REPEAT_OPTIONS: { value: RepeatFrequency; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Every 3 Months' },
  { value: 'semiannual', label: 'Every 6 Months' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom…' },
];

export const MAX_OCCURRENCES = 26;

function formatUntil(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}T235959Z`;
}

function frequencyBase(freq: RepeatFrequency): string | undefined {
  switch (freq) {
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekends':
      return 'FREQ=WEEKLY;BYDAY=SA,SU';
    case 'weekly':
      return 'FREQ=WEEKLY';
    case 'biweekly':
      return 'FREQ=WEEKLY;INTERVAL=2';
    case 'monthly':
      return 'FREQ=MONTHLY';
    case 'quarterly':
      return 'FREQ=MONTHLY;INTERVAL=3';
    case 'semiannual':
      return 'FREQ=MONTHLY;INTERVAL=6';
    case 'yearly':
      return 'FREQ=YEARLY';
    default:
      return undefined;
  }
}

/** Build an RRULE string from Apple-style frequency + end-repeat controls. */
export function buildAppleRecurrenceRule(opts: {
  frequency: RepeatFrequency;
  endMode: EndRepeatMode;
  endDate?: Date | null;
  endCount?: number;
  customRule?: string;
}): string | undefined {
  if (opts.frequency === 'never') return undefined;

  let base: string | undefined;
  if (opts.frequency === 'custom') {
    const rule = (opts.customRule ?? '').trim().replace(/^RRULE:/i, '');
    if (!rule) return undefined;
    // If custom already includes COUNT/UNTIL, respect it.
    if (/\b(COUNT|UNTIL)=/i.test(rule)) return rule;
    base = rule;
  } else {
    base = frequencyBase(opts.frequency);
  }
  if (!base) return undefined;

  if (opts.endMode === 'date' && opts.endDate) {
    return `${base};UNTIL=${formatUntil(opts.endDate)}`;
  }
  if (opts.endMode === 'count') {
    const count = Math.min(
      MAX_OCCURRENCES,
      Math.max(2, Math.floor(opts.endCount ?? 8)),
    );
    return `${base};COUNT=${count}`;
  }
  // End never → let the API horizon/count cap materialize occurrences.
  return `${base};COUNT=${MAX_OCCURRENCES}`;
}

/** Combine a calendar day + HH:MM local time into a datetime-local string. */
export function combineDateAndTime(date: Date, timeHm: string): string {
  const [hh = '09', mm = '00'] = timeHm.split(':');
  const local = new Date(date);
  local.setHours(Number(hh), Number(mm), 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
}

export function addMinutesToDateTimeLocal(value: string, minutes: number): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  d.setMinutes(d.getMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function friendlyDayLabel(date: Date): string {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, tomorrow)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date);
}
