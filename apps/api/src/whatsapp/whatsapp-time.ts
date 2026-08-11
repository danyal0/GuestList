/**
 * Casual tennis time parsing for WhatsApp invites (America/Chicago by default).
 * Dayparts like "evening" map to tennis-friendly clock times — never 23:00.
 */

import { preferPmForTennisHour } from './whatsapp-event-enrich';

/** Mirrors validate defaults — keep in sync with DEFAULT_VENUE_* in validate. */
const DEFAULT_OPEN_HOUR = 7;
const DEFAULT_CLOSE_HOUR = 22;

function localHourMinute(
  date: Date,
  timeZone: string,
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? '0'),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? '0'),
  };
}

/** Wall-clock hours for daypart words (local venue timezone). */
export const DAYPART_HOURS: Record<string, number> = {
  morning: 10,
  noon: 12,
  afternoon: 14,
  evening: 18,
  tonight: 18,
  night: 19,
};

const DAYPART_RE =
  /\b(this\s+)?(morning|afternoon|evening|tonight|noon|night)\b/i;

const NUMERIC_TIME_RE =
  /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;

export function hasDaypartCue(
  ...parts: Array<string | null | undefined>
): boolean {
  const hay = parts.filter(Boolean).join(' ').trim();
  if (!hay) return false;
  return DAYPART_RE.test(hay);
}

/** Daypart or numeric/ISO clock cue — used as "explicit enough" for tennis invites. */
export function hasTimeOrDaypartCue(
  ...parts: Array<string | null | undefined>
): boolean {
  const hay = parts.filter(Boolean).join(' ').trim();
  if (!hay) return false;
  if (DAYPART_RE.test(hay)) return true;
  if (NUMERIC_TIME_RE.test(hay)) return true;
  if (/\b\d{4}-\d{2}-\d{2}t\d{2}:/i.test(hay)) return true;
  return false;
}

export function daypartHourFromText(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const m = value.toLowerCase().match(DAYPART_RE);
  if (!m) return null;
  const key = m[2] || m[1];
  if (!key) return null;
  const hour = DAYPART_HOURS[key];
  return typeof hour === 'number' ? hour : null;
}

/**
 * Parse clues like "tomorrow evening", "Sat 6pm", "tomorrow at 6".
 * Bare hours 1–8 → PM for tennis unless am is explicit.
 * Dayparts without a numeric hour use DAYPART_HOURS.
 */
export function tryParseCasualTennisTime(
  value: string | null | undefined,
  timeZone: string,
): Date | null {
  if (!value) return null;
  // ISO datetimes belong to tryParseIso / coerce — don't treat "08" in 2026-08-11 as 8pm.
  if (/\d{4}-\d{2}-\d{2}t\d{2}:/i.test(value) || /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    return null;
  }
  const text = value.toLowerCase();

  const explicitAmPm = /\b(am|pm|a\.m\.|p\.m\.)\b/i.test(text);
  const timeMatch = text.match(NUMERIC_TIME_RE);
  const daypartHour = daypartHourFromText(text);

  let hour: number;
  let minute = 0;

  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
    const meridiem = (timeMatch[3] || '').toLowerCase().replace(/\./g, '');

    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
    if (minute < 0 || minute > 59) return null;

    if (meridiem === 'pm' && hour < 12) hour += 12;
    else if (meridiem === 'am' && hour === 12) hour = 0;
    else if (!meridiem) {
      hour = preferPmForTennisHour(hour, false);
    }
  } else if (daypartHour != null) {
    hour = daypartHour;
    minute = 0;
  } else {
    return null;
  }

  // Numeric time without am/pm already handled; unused flag kept for clarity.
  void explicitAmPm;

  let dayOffset = 0;
  if (/\btomorrow\b/.test(text)) dayOffset = 1;
  else if (/\btoday\b/.test(text) || /\btonight\b/.test(text)) dayOffset = 0;
  else {
    const weekdays = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    for (let i = 0; i < weekdays.length; i += 1) {
      if (text.includes(weekdays[i]!) || text.includes(weekdays[i]!.slice(0, 3))) {
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone,
          weekday: 'short',
        }).formatToParts(now);
        const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
        const map: Record<string, number> = {
          Sun: 0,
          Mon: 1,
          Tue: 2,
          Wed: 3,
          Thu: 4,
          Fri: 5,
          Sat: 6,
        };
        const current = map[wd] ?? now.getUTCDay();
        dayOffset = (i - current + 7) % 7 || 7;
        break;
      }
    }
    // "at 6" / "evening" with no day → if that hour already passed today, use tomorrow.
    if (dayOffset === 0 && !/\btoday\b/.test(text) && !/\btonight\b/.test(text)) {
      const candidate = zonedLocalDate(timeZone, { dayOffset: 0, hour, minute });
      if (candidate.getTime() < Date.now() - 5 * 60 * 1000) dayOffset = 1;
    }
  }

  return zonedLocalDate(timeZone, { dayOffset, hour, minute });
}

export function tryParseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/\d/.test(trimmed)) return null;
  // Only treat as ISO/Date.parse when it looks like a real datetime, not "at 6".
  if (!/\d{4}-\d{2}-\d{2}/.test(trimmed) && !/T\d{2}:/.test(trimmed)) {
    return null;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * If an AI ISO time lands outside court hours but the text has a daypart
 * (e.g. Grok maps "evening" → 23:00), prefer the daypart parse instead.
 */
export function coerceTennisStartTime(
  suggestedTime: string | null | undefined,
  messageBody: string | null | undefined,
  timeZone: string,
  opts?: { openHour?: number; closeHour?: number },
): Date | null {
  const openHour = opts?.openHour ?? DEFAULT_OPEN_HOUR;
  const closeHour = opts?.closeHour ?? DEFAULT_CLOSE_HOUR;

  const iso = tryParseIso(suggestedTime);
  const casual =
    tryParseCasualTennisTime(suggestedTime, timeZone) ||
    tryParseCasualTennisTime(messageBody, timeZone);

  if (iso) {
    const { hour } = localHourMinute(iso, timeZone);
    const within = hour >= openHour && hour < closeHour;
    const msgHasDaypart = hasDaypartCue(messageBody);
    // Strip ISO-looking tokens so "23:00" inside an AI timestamp doesn't count as a human clock cue.
    const humanText = String(messageBody || '')
      .replace(/\b\d{4}-\d{2}-\d{2}t[\d:.+-]+\b/gi, ' ')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
    const msgHasNumericClock = NUMERIC_TIME_RE.test(humanText);

    // Absurd late/early ISO from daypart mistranslation → prefer casual/daypart.
    if ((!within || hour >= 22) && casual && msgHasDaypart && !msgHasNumericClock) {
      return casual;
    }
    return iso;
  }

  return casual;
}

export function resolveSchedule(
  suggestedTime: string | null | undefined,
  opts: { timezone: string; durationMinutes: number; messageBody?: string },
): { startTime: Date; endTime: Date } {
  const durationMs =
    (Number.isFinite(opts.durationMinutes) ? opts.durationMinutes : 90) *
    60 *
    1000;

  let start =
    coerceTennisStartTime(suggestedTime, opts.messageBody, opts.timezone) ||
    null;

  if (!start) {
    // Default: tomorrow 6pm America/Chicago (tennis-friendly), not 10am UTC.
    start = zonedLocalDate(opts.timezone, {
      dayOffset: 1,
      hour: 18,
      minute: 0,
    });
  }

  return {
    startTime: start,
    endTime: new Date(start.getTime() + durationMs),
  };
}

/** Human + machine-local fields for LLM sense-check (avoid UTC hour confusion). */
export function formatStartForSenseCheck(
  date: Date,
  timeZone: string,
): {
  startTimeUtc: string;
  startTimeLocal: string;
  localHour: number;
  localMinute: number;
} {
  const { hour, minute } = localHourMinute(date, timeZone);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  });
  return {
    startTimeUtc: date.toISOString(),
    startTimeLocal: fmt.format(date),
    localHour: hour,
    localMinute: minute,
  };
}

export function zonedLocalDate(
  timeZone: string,
  parts: { dayOffset: number; hour: number; minute: number },
): Date {
  // Build "now" wall-clock in the target zone, then apply offsets.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bags = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const baseUtcGuess = Date.UTC(
    Number(bags.year),
    Number(bags.month) - 1,
    Number(bags.day) + parts.dayOffset,
    parts.hour,
    parts.minute,
    0,
  );

  // Correct for the zone offset at that instant.
  const asLocal = new Date(baseUtcGuess);
  const shiftedBags = Object.fromEntries(
    fmt.formatToParts(asLocal).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asLocalUtc = Date.UTC(
    Number(shiftedBags.year),
    Number(shiftedBags.month) - 1,
    Number(shiftedBags.day),
    Number(shiftedBags.hour),
    Number(shiftedBags.minute),
    Number(shiftedBags.second || '0'),
  );
  const offsetMs = asLocalUtc - baseUtcGuess;
  return new Date(baseUtcGuess - offsetMs);
}
