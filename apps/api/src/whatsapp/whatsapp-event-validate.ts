/**
 * Pre-create validation for WhatsApp → MKE Plays events.
 *
 * Goals (from partial-message scenarios):
 * 1. Time-only → reject (incomplete)
 * 2. Sport + time, no venue → reject (need a known court)
 * 3. Sport + known venue (± time) → accept (time may default)
 * 4. Known venue + time outside hours → reject
 * 5. Unknown venue → reject
 * 6. Sport that cannot be played at the venue (e.g. swimming at courts) → reject
 *
 * All sports are supported. We only reject clear sport↔venue mismatches.
 * Cancel / reschedule of an existing event bypasses these create rules.
 */

import type { CatalogVenue, SportCode } from './whatsapp-event-enrich';

export type DetectedSport =
  | 'TENNIS'
  | 'PICKLEBALL'
  | 'BASKETBALL'
  | 'SOCCER'
  | 'VOLLEYBALL'
  | 'SWIMMING'
  | 'OTHER';

export type WhatsappCreateValidationCode =
  | 'INCOMPLETE'
  | 'MISSING_VENUE'
  | 'UNKNOWN_VENUE'
  | 'SPORT_VENUE_MISMATCH'
  | 'OUTSIDE_HOURS';

export type WhatsappCreateValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: WhatsappCreateValidationCode;
      message: string;
      hints: string[];
      details?: Record<string, unknown>;
    };

/** Default outdoor / lighted court window (local venue timezone). */
export const DEFAULT_VENUE_OPEN_HOUR = 7;
export const DEFAULT_VENUE_CLOSE_HOUR = 22; // last allowed start hour is 21:59

const SPORT_PATTERNS: Array<{ sport: DetectedSport; re: RegExp }> = [
  { sport: 'TENNIS', re: /\btennis\b/i },
  { sport: 'PICKLEBALL', re: /\bpickle\s*-?\s*ball\b/i },
  { sport: 'BASKETBALL', re: /\bbasket\s*-?\s*ball\b|\bhoops?\b/i },
  { sport: 'SOCCER', re: /\bsoccer\b|\bfootball\b/i },
  { sport: 'VOLLEYBALL', re: /\bvolley\s*-?\s*ball\b/i },
  { sport: 'SWIMMING', re: /\bswim(?:ming)?\b|\bpool\s+party\b/i },
];

/**
 * Sports that can reasonably use a hard-court / racket-court venue (catalog TENNIS).
 * Field / water sports are not compatible — e.g. swimming at pickleball/tennis courts.
 */
const COURT_COMPATIBLE_SPORTS = new Set<DetectedSport>([
  'TENNIS',
  'PICKLEBALL',
  'BASKETBALL',
  'VOLLEYBALL',
]);

const TIME_CUE_RE =
  /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b|\b\d{4}-\d{2}-\d{2}t\d{2}:/i;

/** Places that look like a venue mention but are not tennis-court catalog hits. */
const NON_COURT_PLACE_RE =
  /\b(?:fiserv|forum|bradley\s+center|american\s+family|stadium|arena|gym|ymca|church|mall|restaurant|bar|cafe|coffee|brewery)\b/i;

export function detectSportFromText(
  ...parts: Array<string | null | undefined>
): DetectedSport | null {
  const hay = parts.filter(Boolean).join(' ').trim();
  if (!hay) return null;
  for (const { sport, re } of SPORT_PATTERNS) {
    if (re.test(hay)) return sport;
  }
  return null;
}

/** Whether this sport can be played at a catalog venue of the given sport code. */
export function isSportCompatibleWithVenue(
  sport: DetectedSport | null,
  venueSport: SportCode | string | null | undefined,
): boolean {
  if (!sport) return true; // no sport stated → allow (venue implies court play)
  const facility = String(venueSport || 'TENNIS').toUpperCase();
  if (facility === 'TENNIS' || facility === 'PICKLEBALL') {
    return COURT_COMPATIBLE_SPORTS.has(sport);
  }
  // Unknown future venue types: only exact sport match.
  return sport === facility;
}

export function hasExplicitTimeCue(
  ...parts: Array<string | null | undefined>
): boolean {
  const hay = parts.filter(Boolean).join(' ').trim();
  if (!hay) return false;
  return TIME_CUE_RE.test(hay);
}

export function venueOpenCloseHours(venue: CatalogVenue | null | undefined): {
  openHour: number;
  closeHour: number;
} {
  const open =
    typeof venue?.openHour === 'number' && Number.isFinite(venue.openHour)
      ? venue.openHour
      : DEFAULT_VENUE_OPEN_HOUR;
  const close =
    typeof venue?.closeHour === 'number' && Number.isFinite(venue.closeHour)
      ? venue.closeHour
      : DEFAULT_VENUE_CLOSE_HOUR;
  return {
    openHour: Math.min(23, Math.max(0, open)),
    closeHour: Math.min(24, Math.max(1, close)),
  };
}

/** Local hour (0–23) + minute in the event timezone. */
export function localTimeParts(
  date: Date,
  timeZone: string,
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

export function isWithinVenueHours(
  startTime: Date,
  timeZone: string,
  venue: CatalogVenue | null | undefined,
): boolean {
  const { openHour, closeHour } = venueOpenCloseHours(venue);
  const { hour, minute } = localTimeParts(startTime, timeZone);
  const minutes = hour * 60 + minute;
  const openMin = openHour * 60;
  const closeMin = closeHour * 60;
  return minutes >= openMin && minutes < closeMin;
}

export function formatHourLabel(hour24: number): string {
  const h = ((Math.floor(hour24) % 24) + 24) % 24;
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

function facilityLabel(venue: CatalogVenue): string {
  const sport = String(venue.sport || 'TENNIS').toLowerCase();
  if (sport === 'tennis' || sport === 'pickleball') return 'courts';
  return `${sport} venue`;
}

/**
 * Validate a prospective WhatsApp create (not cancel/reschedule).
 */
export function validateWhatsappEventCreate(input: {
  messageBody?: string | null;
  title?: string | null;
  suggestedTime?: string | null;
  venue?: string | null;
  locationName?: string | null;
  address?: string | null;
  /** Resolved catalog venue, if any. */
  catalogVenue?: CatalogVenue | null;
  /** Free-form location the service would otherwise keep. */
  freeformLocation?: string | null;
  startTime: Date;
  timezone: string;
  /** True when suggestedTime or message clearly stated a clock time. */
  timeWasExplicit?: boolean;
}): WhatsappCreateValidationResult {
  const textParts = [
    input.messageBody,
    input.title,
    input.venue,
    input.locationName,
    input.address,
  ];
  const sport = detectSportFromText(...textParts);
  const catalog = input.catalogVenue ?? null;
  const freeform = (input.freeformLocation || '').trim() || null;
  const timeExplicit =
    input.timeWasExplicit ??
    hasExplicitTimeCue(input.messageBody, input.suggestedTime, input.title);

  // Clear mismatch only — e.g. swimming at tennis/pickleball courts.
  // Tennis, pickleball, basketball, etc. on hard courts are all allowed.
  if (sport && catalog && !isSportCompatibleWithVenue(sport, catalog.sport)) {
    return {
      ok: false,
      code: 'SPORT_VENUE_MISMATCH',
      message: `You can’t play ${sport.toLowerCase()} at ${catalog.name} (${facilityLabel(catalog)}).`,
      hints: [
        `Pick a sport that fits these ${facilityLabel(catalog)} (tennis, pickleball, …), or use a venue meant for ${sport.toLowerCase()}.`,
      ],
      details: { sport, venueSport: catalog.sport, venue: catalog.slug },
    };
  }

  if (!catalog) {
    const mentionedNonCourt = textParts.some((p) =>
      p ? NON_COURT_PLACE_RE.test(p) : false,
    );
    if (freeform || mentionedNonCourt) {
      return {
        ok: false,
        code: 'UNKNOWN_VENUE',
        message:
          'That place is not a known court in our Milwaukee catalog, so no event was created.',
        hints: [
          'Use a known court name: Atwater, McKinley / lakefront, Lake Park, Humboldt Park, Washington Park, Wilson Park, or Hart Park.',
          freeform ? `Ignored location: ${freeform}` : undefined,
        ].filter(Boolean) as string[],
        details: { freeformLocation: freeform },
      };
    }

    if (timeExplicit && !sport) {
      return {
        ok: false,
        code: 'INCOMPLETE',
        message:
          'Need a sport and a known court — a time alone is not enough to create an event.',
        hints: ['Example: “Tennis at Atwater at 6pm” or “Pickleball at the lakefront at 6”'],
      };
    }

    if (sport && timeExplicit) {
      return {
        ok: false,
        code: 'MISSING_VENUE',
        message: `Got ${sport.toLowerCase()} and a time, but no known court. Event not created.`,
        hints: [
          'Add a catalog venue, e.g. “Tennis at Atwater at 6pm” or “Pickleball at the lakefront at 6”.',
        ],
        details: { sport },
      };
    }

    if (sport) {
      return {
        ok: false,
        code: 'MISSING_VENUE',
        message: `Got ${sport.toLowerCase()}, but no known court. Event not created.`,
        hints: ['Example: “Pickleball at Atwater tomorrow at 6pm”'],
        details: { sport },
      };
    }

    return {
      ok: false,
      code: 'INCOMPLETE',
      message:
        'Could not create an event — include a sport and a known Milwaukee court (time optional).',
      hints: ['Example: “Tennis at Atwater at 6pm”'],
    };
  }

  // Known venue — require time inside opening hours (defaults apply when time omitted).
  if (!isWithinVenueHours(input.startTime, input.timezone, catalog)) {
    const { openHour, closeHour } = venueOpenCloseHours(catalog);
    const { hour, minute } = localTimeParts(input.startTime, input.timezone);
    const hh = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
    return {
      ok: false,
      code: 'OUTSIDE_HOURS',
      message: `${hh} is outside hours for ${catalog.name} (${formatHourLabel(openHour)}–${formatHourLabel(closeHour)}).`,
      hints: [
        'Pick a time during court hours (default outdoor/lighted window is 7:00 AM–10:00 PM).',
        'Example: “Tennis at Atwater tomorrow at 6pm”',
      ],
      details: {
        startLocal: hh,
        openHour,
        closeHour,
        venue: catalog.slug,
        timeWasExplicit: timeExplicit,
      },
    };
  }

  return { ok: true };
}
