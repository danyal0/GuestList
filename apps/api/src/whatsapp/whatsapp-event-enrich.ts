/**
 * Milwaukee-area tennis venue hints for WhatsApp create-event enrichment.
 * Used when the model (or message) only gives a casual place clue.
 */

export type MilwaukeeVenue = {
  aliases: string[];
  locationName: string;
  address: string;
  latitude: number;
  longitude: number;
  notes?: string;
};

export const MILWAUKEE_TENNIS_VENUES: MilwaukeeVenue[] = [
  {
    aliases: [
      'lake front',
      'lakefront',
      'lake park',
      'bradford',
      'bradford beach',
      'lake drive',
    ],
    locationName: 'Lake Park Tennis Courts',
    address: '3233 N Lake Dr, Milwaukee, WI 53211',
    latitude: 43.0665,
    longitude: -87.8708,
    notes: 'Public courts near Bradford Beach / Lake Park on Milwaukee’s lakefront.',
  },
  {
    aliases: ['veterans park', "veteran's park", 'mckinley', 'mckinley marina'],
    locationName: 'Veterans Park / McKinley Marina area',
    address: '1010 N Lincoln Memorial Dr, Milwaukee, WI 53202',
    latitude: 43.0442,
    longitude: -87.8945,
    notes: 'Lakefront park courts / meetup area near McKinley Marina.',
  },
  {
    aliases: ['humboldt', 'humboldt park'],
    locationName: 'Humboldt Park Tennis Courts',
    address: '3000 S Howell Ave, Milwaukee, WI 53207',
    latitude: 42.9995,
    longitude: -87.8942,
  },
  {
    aliases: ['washington park'],
    locationName: 'Washington Park Tennis Courts',
    address: '1858 N 40th St, Milwaukee, WI 53208',
    latitude: 43.0545,
    longitude: -87.9615,
  },
  {
    aliases: ['wilson park'],
    locationName: 'Wilson Park Tennis Courts',
    address: '4001 S 20th St, Milwaukee, WI 53221',
    latitude: 42.9588,
    longitude: -87.9395,
  },
  {
    aliases: ['oak creek', 'carrington'],
    locationName: 'Oak Creek Tennis Courts',
    address: '215 W Drexel Ave, Oak Creek, WI 53154',
    latitude: 42.8805,
    longitude: -87.9285,
  },
  {
    aliases: ['wauwatosa', 'hart park'],
    locationName: 'Hart Park Tennis Courts',
    address: '7300 Chestnut St, Wauwatosa, WI 53213',
    latitude: 43.0496,
    longitude: -88.0076,
  },
];

export function resolveMilwaukeeVenue(clue: string | null | undefined): MilwaukeeVenue | null {
  if (!clue) return null;
  const hay = clue.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!hay) return null;

  let best: { venue: MilwaukeeVenue; score: number } | null = null;
  for (const venue of MILWAUKEE_TENNIS_VENUES) {
    for (const alias of venue.aliases) {
      if (hay.includes(alias)) {
        const score = alias.length;
        if (!best || score > best.score) best = { venue, score };
      }
    }
    if (hay.includes(venue.locationName.toLowerCase())) {
      const score = venue.locationName.length;
      if (!best || score > best.score) best = { venue, score };
    }
  }
  return best?.venue ?? null;
}

/**
 * Prefer PM for casual tennis hours when AM/PM is omitted.
 * Bare "6" / "at 6" / "6 tomorrow" → 6pm local, not 6am.
 */
export function preferPmForTennisHour(hour24: number, explicitlyAmPm: boolean): number {
  if (explicitlyAmPm) return hour24;
  // 1–8 without am/pm → treat as PM (13–20). 9–11 stay morning-ish; 12 noon.
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
