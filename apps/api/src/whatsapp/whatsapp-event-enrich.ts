/**
 * Milwaukee-area tennis venue catalog + helpers.
 * Source of truth: apps/api/data/venues-catalog.json (also seeded into Venue table).
 */

import catalogJson from '../../data/venues-catalog.json';

export type SportCode = 'TENNIS';

export type CatalogVenue = {
  slug: string;
  name: string;
  sport: SportCode;
  city: string;
  region: string;
  country: string;
  address: string;
  latitude: number;
  longitude: number;
  aliases: string[];
  notes?: string | null;
  /** Number of playable courts at the venue (when known). */
  courtCount?: number | null;
  /** Suggested event capacity (typically courtCount × 4 for tennis). */
  defaultCapacity?: number | null;
};

export const MILWAUKEE_TENNIS_VENUES = catalogJson as CatalogVenue[];

export type VenueMatch = {
  venue: CatalogVenue;
  score: number;
  matchedAlias: string;
};

const NAME_STOPWORDS = new Set(
  [
    'i',
    'im',
    'i’m',
    'me',
    'my',
    'we',
    'us',
    'you',
    'he',
    'she',
    'they',
    'anyone',
    'someone',
    'everybody',
    'everyone',
    'tomorrow',
    'today',
    'tonight',
    'morning',
    'afternoon',
    'evening',
    'tennis',
    'court',
    'courts',
    'park',
    'lake',
    'front',
    'lakefront',
    'doubles',
    'singles',
    'open',
    'play',
    'playing',
    'lets',
    'let’s',
    'please',
    'thanks',
    'who',
    'what',
    'when',
    'where',
    'need',
    'also',
    'going',
    'down',
    'around',
    'after',
    'before',
    'pm',
    'am',
  ].map((s) => s.toLowerCase()),
);

export function resolveCatalogVenue(
  clue: string | null | undefined,
  opts: { sport?: SportCode; minAliasLength?: number } = {},
): VenueMatch | null {
  if (!clue) return null;
  const hay = clue.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!hay) return null;
  const sport = opts.sport ?? 'TENNIS';
  const minAliasLength = opts.minAliasLength ?? 4;

  let best: VenueMatch | null = null;
  for (const venue of MILWAUKEE_TENNIS_VENUES) {
    if (venue.sport !== sport) continue;
    for (const alias of venue.aliases) {
      if (alias.length < minAliasLength) continue;
      if (hay.includes(alias)) {
        const score = alias.length + (alias === hay ? 10 : 0);
        if (!best || score > best.score) {
          best = { venue, score, matchedAlias: alias };
        }
      }
    }
    const name = venue.name.toLowerCase();
    if (hay.includes(name)) {
      const score = name.length + 5;
      if (!best || score > best.score) {
        best = { venue, score, matchedAlias: name };
      }
    }
  }
  return best;
}

/** @deprecated use resolveCatalogVenue */
export function resolveMilwaukeeVenue(clue: string | null | undefined) {
  return resolveCatalogVenue(clue)?.venue ?? null;
}

export function preferPmForTennisHour(hour24: number, explicitlyAmPm: boolean): number {
  if (explicitlyAmPm) return hour24;
  if (hour24 >= 1 && hour24 <= 8) return hour24 + 12;
  return hour24;
}

/**
 * Infer event capacity from AI extraction, message cues, then venue courts.
 * Prefer explicit party size / format; fall back to venue defaultCapacity
 * (or courtCount × 4 for tennis open play).
 */
export function inferEventCapacity(input: {
  aiCapacity?: number | null;
  capacityConfidence?: number | null;
  courtInfo?: string | null;
  messageBody?: string | null;
  venue?: CatalogVenue | null;
  minConfidence?: number;
}): number | null {
  const minConfidence = input.minConfidence ?? 0.7;
  if (
    typeof input.aiCapacity === 'number' &&
    Number.isFinite(input.aiCapacity) &&
    input.aiCapacity >= 1 &&
    (input.capacityConfidence == null || input.capacityConfidence >= minConfidence)
  ) {
    return Math.min(100_000, Math.floor(input.aiCapacity));
  }

  const text = `${input.courtInfo ?? ''} ${input.messageBody ?? ''}`
    .toLowerCase()
    .replace(/\s+/g, ' ');

  const explicit =
    text.match(
      /\b(?:need|for|max|capacity|spots?(?:\s*(?:for|left|open))?|only)\s+(\d{1,3})\b/,
    ) ||
    text.match(/\b(\d{1,3})\s*(?:spots?|players?|people|ppl|guys|girls)\b/) ||
    text.match(/\bparty\s*(?:of|size)?\s*(\d{1,3})\b/);
  if (explicit?.[1]) {
    const n = Number(explicit[1]);
    if (n >= 1 && n <= 1000) return n;
  }

  const courts =
    text.match(/\b(\d{1,2})\s*courts?\b/) ||
    text.match(/\bcourts?\s*[:=]?\s*(\d{1,2})\b/);
  if (courts?.[1]) {
    const n = Number(courts[1]);
    if (n >= 1 && n <= 40) return n * 4;
  }

  if (/\bsingles?\b/.test(text)) return 2;
  if (/\bdoubles?\b/.test(text)) return 4;

  const venue = input.venue;
  if (venue) {
    if (
      typeof venue.defaultCapacity === 'number' &&
      Number.isFinite(venue.defaultCapacity) &&
      venue.defaultCapacity >= 1
    ) {
      return Math.floor(venue.defaultCapacity);
    }
    if (
      typeof venue.courtCount === 'number' &&
      Number.isFinite(venue.courtCount) &&
      venue.courtCount >= 1
    ) {
      return Math.floor(venue.courtCount) * 4;
    }
    const fromNotes = venue.notes?.match(/\b(\d{1,2})\s+(?:lighted\s+)?(?:outdoor\s+)?(?:hard\s+)?courts?\b/i);
    if (fromNotes?.[1]) {
      const n = Number(fromNotes[1]);
      if (n >= 1 && n <= 40) return n * 4;
    }
  }

  return null;
}

/**
 * Extract first names of people the message says are going / playing
 * (beyond the sender). Local fallback when AI omits namedAttendees.
 */
export function extractNamedAttendeesFromMessage(
  messageBody: string | null | undefined,
  opts: { excludeNames?: string[] } = {},
): string[] {
  if (!messageBody?.trim()) return [];
  const exclude = new Set(
    (opts.excludeNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  const found: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    const name = raw.replace(/[^A-Za-zÀ-ÿ'’\-]/g, '').trim();
    if (name.length < 2 || name.length > 40) return;
    const key = name.toLowerCase();
    if (NAME_STOPWORDS.has(key) || exclude.has(key)) return;
    if (found.some((f) => f.toLowerCase() === key)) return;
    found.push(name.charAt(0).toUpperCase() + name.slice(1));
  };

  const patterns = [
    /\b([A-Za-zÀ-ÿ'’\-]{2,40})\s+is\s+(?:also\s+)?(?:going|in|down|coming|joining|playing)\b/gi,
    /\b(?:also)\s+([A-Za-zÀ-ÿ'’\-]{2,40})\s+(?:is\s+)?(?:going|in|down|coming|joining)\b/gi,
    /\b(?:with|plus|\+)\s+([A-Za-zÀ-ÿ'’\-]{2,40})\b/gi,
    /\b([A-Za-zÀ-ÿ'’\-]{2,40})\s+(?:and\s+i|&?\s*i)\s+(?:are|will\s+be)?\s*(?:going|playing|in)?\b/gi,
    /\bme\s+and\s+([A-Za-zÀ-ÿ'’\-]{2,40})\b/gi,
    /\b([A-Za-zÀ-ÿ'’\-]{2,40})\s+and\s+(?:me|i)\b/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(messageBody)) !== null) {
      push(m[1]);
    }
  }

  return found;
}

export function mergeNamedAttendees(
  aiNames: Array<string | null | undefined> | null | undefined,
  messageBody: string | null | undefined,
  excludeNames?: string[],
): string[] {
  const fromAi = (aiNames ?? [])
    .map((n) => (n ?? '').trim())
    .filter((n) => n.length >= 2 && n.length <= 40);
  const fromMsg = extractNamedAttendeesFromMessage(messageBody, { excludeNames });
  const out: string[] = [];
  for (const name of [...fromAi, ...fromMsg]) {
    const key = name.toLowerCase();
    if (NAME_STOPWORDS.has(key)) continue;
    if (excludeNames?.some((e) => e.toLowerCase() === key)) continue;
    if (out.some((o) => o.toLowerCase() === key)) continue;
    out.push(name);
  }
  return out;
}

export function buildEventDescription(parts: {
  messageBody?: string | null;
  instructions?: string | null;
  notes?: string | null;
  skillLevel?: string | null;
  courtInfo?: string | null;
  suggestedTime?: string | null;
  whatsappMessageId?: string | null;
  capacity?: number | null;
  namedAttendees?: string[] | null;
}): string {
  const blocks: string[] = [];
  if (parts.messageBody?.trim()) {
    blocks.push(parts.messageBody.trim());
  } else {
    blocks.push('Match proposed via WhatsApp.');
  }
  if (parts.instructions?.trim()) {
    blocks.push(`Instructions:\n${parts.instructions.trim()}`);
  }
  if (parts.notes?.trim()) {
    blocks.push(`Notes:\n${parts.notes.trim()}`);
  }
  if (parts.skillLevel?.trim()) {
    blocks.push(`Level: ${parts.skillLevel.trim()}`);
  }
  if (parts.courtInfo?.trim()) {
    blocks.push(`Courts: ${parts.courtInfo.trim()}`);
  }
  if (typeof parts.capacity === 'number' && parts.capacity >= 1) {
    blocks.push(`Capacity: ${parts.capacity} spots`);
  }
  if (parts.namedAttendees && parts.namedAttendees.length > 0) {
    blocks.push(`Mentioned going: ${parts.namedAttendees.join(', ')}`);
  }
  if (parts.suggestedTime?.trim()) {
    blocks.push(`Time clue: ${parts.suggestedTime.trim()}`);
  }
  if (parts.whatsappMessageId?.trim()) {
    blocks.push(`Source: WhatsApp message ${parts.whatsappMessageId.trim()}`);
  }
  return blocks.join('\n\n');
}

export function catalogVenuesForPrompt(sport: SportCode = 'TENNIS'): string {
  return MILWAUKEE_TENNIS_VENUES.filter((v) => v.sport === sport)
    .map((v) => {
      const courts =
        typeof v.courtCount === 'number' ? ` courts=${v.courtCount}` : '';
      const cap =
        typeof v.defaultCapacity === 'number'
          ? ` defaultCapacity=${v.defaultCapacity}`
          : '';
      return `- slug=${v.slug} name="${v.name}" address="${v.address}" aliases=[${v.aliases.join(', ')}] lat=${v.latitude} lng=${v.longitude}${courts}${cap}`;
    })
    .join('\n');
}
