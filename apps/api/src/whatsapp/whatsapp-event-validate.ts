/**
 * Pre-create / pre-reschedule validation for WhatsApp → MKE Plays events.
 *
 * Goals:
 * 1. Time-only → reject (incomplete)
 * 2. Sport + time, no venue → reject (need a known court)
 * 3. Sport + known venue (± time) → accept when we are confident it makes sense
 * 4. Known venue + time outside hours → reject
 * 5. Unknown venue → reject
 * 6. Sport that cannot be played at the venue (e.g. swimming at courts) → reject
 * 7. Sense/confidence gate: "does this make sense? are we confident?"
 * 8. Reschedule: only apply stated time/venue changes; validate those changes
 *
 * All sports are supported. We only reject clear sport↔venue mismatches.
 * Cancel of an existing event bypasses these create rules.
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
  | 'OUTSIDE_HOURS'
  | 'LOW_CONFIDENCE'
  | 'NO_MATERIAL_CHANGE';

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

/** Default minimum self-confidence before create/reschedule is accepted. */
export const DEFAULT_SENSE_MIN_CONFIDENCE = 0.72;

export type EventSenseAssessment = {
  makesSense: boolean;
  confidence: number;
  reason: string;
  factors: string[];
};

/**
 * Local "does this make sense / am I confident?" gate.
 * Used always; optional live LLM check can further lower confidence.
 */
export function assessEventSense(input: {
  mode: 'create' | 'reschedule';
  messageBody?: string | null;
  title?: string | null;
  catalogVenue?: CatalogVenue | null;
  startTime: Date;
  timezone: string;
  timeWasExplicit?: boolean;
  /** True when the message/AI clearly pointed at a catalog or free-form place. */
  venueWasExplicit?: boolean;
  botConfidence?: number | null;
  venueConfidence?: number | null;
  timeConfidence?: number | null;
  changes?: { timeChanged: boolean; venueChanged: boolean };
}): EventSenseAssessment {
  const factors: string[] = [];
  let score = 0.15; // base skepticism — must earn confidence
  const catalog = input.catalogVenue ?? null;
  const timeExplicit = Boolean(input.timeWasExplicit);
  const venueExplicit = Boolean(input.venueWasExplicit || catalog);
  const sport = detectSportFromText(input.messageBody, input.title);

  if (catalog) {
    score += 0.35;
    factors.push(`known venue ${catalog.slug}`);
  } else {
    factors.push('no catalog venue');
  }

  if (timeExplicit) {
    score += 0.22;
    factors.push('explicit time');
  } else if (input.mode === 'create') {
    score += 0.08;
    factors.push('default time (weaker)');
  } else {
    factors.push('time unchanged or defaulted');
  }

  if (sport) {
    score += 0.12;
    factors.push(`sport ${sport.toLowerCase()}`);
  } else if (catalog) {
    score += 0.08;
    factors.push('sport inferred from court venue');
  }

  if (catalog && isWithinVenueHours(input.startTime, input.timezone, catalog)) {
    score += 0.1;
    factors.push('within court hours');
  }

  if (typeof input.venueConfidence === 'number' && input.venueConfidence >= 0.8) {
    score += 0.05;
    factors.push(`venueConfidence ${input.venueConfidence.toFixed(2)}`);
  }
  if (typeof input.timeConfidence === 'number' && input.timeConfidence >= 0.8) {
    score += 0.05;
    factors.push(`timeConfidence ${input.timeConfidence.toFixed(2)}`);
  }
  if (typeof input.botConfidence === 'number' && input.botConfidence >= 0.75) {
    score += 0.08;
    factors.push(`botConfidence ${input.botConfidence.toFixed(2)}`);
  } else if (typeof input.botConfidence === 'number' && input.botConfidence < 0.55) {
    score -= 0.15;
    factors.push(`low botConfidence ${input.botConfidence.toFixed(2)}`);
  }

  if (input.mode === 'reschedule') {
    const timeChanged = Boolean(input.changes?.timeChanged);
    const venueChanged = Boolean(input.changes?.venueChanged);
    if (!timeChanged && !venueChanged) {
      return {
        makesSense: false,
        confidence: 0.2,
        reason: 'Reschedule stated, but neither time nor venue actually changed.',
        factors: [...factors, 'no material change'],
      };
    }
    if (timeChanged && !timeExplicit) {
      score -= 0.25;
      factors.push('time changed without an explicit time cue (risky default)');
    }
    if (venueChanged && !venueExplicit && !catalog) {
      score -= 0.3;
      factors.push('venue changed without a known court');
    }
    if (timeChanged) factors.push('time change');
    if (venueChanged) factors.push('venue change');
    score += 0.05; // slight boost for intentional update
  }

  // Cap and floor.
  const confidence = Math.max(0, Math.min(0.99, score));
  const min = Number(process.env.WHATSAPP_SENSE_MIN_CONFIDENCE || DEFAULT_SENSE_MIN_CONFIDENCE);
  const makesSense = confidence >= min && Boolean(catalog);

  return {
    makesSense,
    confidence,
    reason: makesSense
      ? `Looks like a real meetup (confidence ${confidence.toFixed(2)}).`
      : `Not confident enough to save this (confidence ${confidence.toFixed(2)} < ${min}).`,
    factors,
  };
}

/**
 * Structural rules + sense/confidence gate for create or material reschedule.
 */
export function validateWhatsappEventProposal(input: {
  mode: 'create' | 'reschedule';
  messageBody?: string | null;
  title?: string | null;
  suggestedTime?: string | null;
  venue?: string | null;
  locationName?: string | null;
  address?: string | null;
  catalogVenue?: CatalogVenue | null;
  freeformLocation?: string | null;
  startTime: Date;
  timezone: string;
  timeWasExplicit?: boolean;
  venueWasExplicit?: boolean;
  botConfidence?: number | null;
  venueConfidence?: number | null;
  timeConfidence?: number | null;
  changes?: { timeChanged: boolean; venueChanged: boolean };
  /** Optional extra confidence from a live LLM self-check (0–1). */
  aiSenseConfidence?: number | null;
  aiSenseReason?: string | null;
}): WhatsappCreateValidationResult {
  if (input.mode === 'reschedule') {
    const timeChanged = Boolean(input.changes?.timeChanged);
    const venueChanged = Boolean(input.changes?.venueChanged);
    if (!timeChanged && !venueChanged) {
      return {
        ok: false,
        code: 'NO_MATERIAL_CHANGE',
        message:
          'Reschedule ignored — say what changed (new time and/or a known court).',
        hints: [
          'Example: “moved to 7pm” or “moved to Atwater at 6”.',
        ],
        details: { timeChanged, venueChanged },
      };
    }
  }

  const structural = validateWhatsappEventCreate({
    messageBody: input.messageBody,
    title: input.title,
    suggestedTime: input.suggestedTime,
    venue: input.venue,
    locationName: input.locationName,
    address: input.address,
    catalogVenue: input.catalogVenue,
    freeformLocation: input.freeformLocation,
    startTime: input.startTime,
    timezone: input.timezone,
    timeWasExplicit: input.timeWasExplicit,
  });
  if (!structural.ok) return structural;

  const sense = assessEventSense({
    mode: input.mode,
    messageBody: input.messageBody,
    title: input.title,
    catalogVenue: input.catalogVenue,
    startTime: input.startTime,
    timezone: input.timezone,
    timeWasExplicit: input.timeWasExplicit,
    venueWasExplicit: input.venueWasExplicit,
    botConfidence: input.botConfidence,
    venueConfidence: input.venueConfidence,
    timeConfidence: input.timeConfidence,
    changes: input.changes,
  });

  let confidence = sense.confidence;
  let reason = sense.reason;
  if (
    typeof input.aiSenseConfidence === 'number' &&
    Number.isFinite(input.aiSenseConfidence)
  ) {
    confidence = Math.min(confidence, input.aiSenseConfidence);
    if (input.aiSenseReason) {
      reason = `${reason} AI: ${input.aiSenseReason}`;
    }
  }

  const min = Number(
    process.env.WHATSAPP_SENSE_MIN_CONFIDENCE || DEFAULT_SENSE_MIN_CONFIDENCE,
  );
  if (!sense.makesSense || confidence < min) {
    return {
      ok: false,
      code: 'LOW_CONFIDENCE',
      message: reason,
      hints: [
        'Include a known court and a clear time so we are confident this is a real meetup.',
        'Example: “Tennis at Atwater tomorrow at 6pm”',
      ],
      details: {
        confidence,
        minConfidence: min,
        factors: sense.factors,
        aiSenseConfidence: input.aiSenseConfidence ?? null,
      },
    };
  }

  return { ok: true };
}
