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
};

export const MILWAUKEE_TENNIS_VENUES = catalogJson as CatalogVenue[];

export type VenueMatch = {
  venue: CatalogVenue;
  score: number;
  matchedAlias: string;
};

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

export function buildEventDescription(parts: {
  messageBody?: string | null;
  instructions?: string | null;
  notes?: string | null;
  skillLevel?: string | null;
  courtInfo?: string | null;
  suggestedTime?: string | null;
  whatsappMessageId?: string | null;
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
    .map(
      (v) =>
        `- slug=${v.slug} name="${v.name}" address="${v.address}" aliases=[${v.aliases.join(', ')}] lat=${v.latitude} lng=${v.longitude}`,
    )
    .join('\n');
}
