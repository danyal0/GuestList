import { createHash } from 'crypto';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

export type ImportMatchCandidate = {
  id: string;
  title: string;
  startTime: Date;
  groupId: string;
  description: string;
  whatsappMessageId: string | null;
};

export type ImportMatchInput = {
  title: string;
  start: Date;
  link?: string;
  groupId: string;
  importKey: string;
};

/** Meetup event id from `/events/123456789/` URLs. */
export function extractMeetupEventId(link?: string | null): string | null {
  const m = String(link || '').match(/\/events\/(\d{6,})/i);
  return m ? m[1] : null;
}

export function buildImportKey(input: {
  link?: string;
  slug: string;
  title: string;
  dateTime?: string;
  start: Date;
}): string {
  const meetupId = extractMeetupEventId(input.link);
  if (meetupId) return meetupId;
  const base =
    input.link ||
    `${input.slug}:${input.title}:${input.dateTime || input.start.toISOString()}`;
  return createHash('sha1').update(base).digest('hex').slice(0, 16);
}

export function normalizeEventTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
    .join(' ')
    .trim();
}

export function titleTokenJaccard(a: string, b: string): number {
  const tokensA = new Set(normalizeEventTitle(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeEventTitle(b).split(' ').filter(Boolean));
  if (!tokensA.size && !tokensB.size) return 1;
  if (!tokensA.size || !tokensB.size) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }
  return intersection / (tokensA.size + tokensB.size - intersection);
}

export function titleContainsOther(a: string, b: string): boolean {
  const left = normalizeEventTitle(a);
  const right = normalizeEventTitle(b);
  if (!left || !right) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 12 && longer.includes(shorter);
}

export function startTimesClose(a: Date, b: Date, maxMinutes = 120): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= maxMinutes * 60_000;
}

/** Same calendar day in America/Chicago (import timezone). */
export function sameCalendarDayChicago(a: Date, b: Date): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(a) === fmt.format(b);
}

function meetupIdFromCandidate(candidate: ImportMatchCandidate): string | null {
  const fromMessage = candidate.whatsappMessageId?.match(/^import:(\d{6,})$/);
  if (fromMessage) return fromMessage[1];
  const fromDescription = candidate.description.match(/\/events\/(\d{6,})/i);
  if (fromDescription) return fromDescription[1];
  return null;
}

const MATCH_THRESHOLD = 0.85;

export function scoreImportDuplicate(
  candidate: ImportMatchCandidate,
  incoming: ImportMatchInput,
): number {
  const incomingMeetupId = extractMeetupEventId(incoming.link);
  const candidateMeetupId = meetupIdFromCandidate(candidate);

  if (incomingMeetupId && candidateMeetupId && incomingMeetupId === candidateMeetupId) {
    return 1;
  }
  if (candidate.whatsappMessageId === `import:${incoming.importKey}`) {
    return 1;
  }

  const titleSim = titleTokenJaccard(candidate.title, incoming.title);
  const sameGroup = candidate.groupId === incoming.groupId;
  const close90 = startTimesClose(candidate.startTime, incoming.start, 90);
  const close180 = startTimesClose(candidate.startTime, incoming.start, 180);
  const close240 = startTimesClose(candidate.startTime, incoming.start, 240);
  const sameDay = sameCalendarDayChicago(candidate.startTime, incoming.start);

  if (titleSim >= 0.88 && close90) return 0.96;
  if (titleSim >= 0.92 && sameDay) return 0.93;
  if (titleSim >= 0.75 && sameGroup && close180) return 0.9;
  if (titleContainsOther(candidate.title, incoming.title) && close180) return 0.88;

  const linkStem = incoming.link?.split('?')[0];
  if (linkStem && candidate.description.includes(linkStem)) return 0.92;
  if (incomingMeetupId && candidate.description.includes(incomingMeetupId)) return 0.9;

  return (
    titleSim * 0.55 +
    (close90 ? 0.3 : close240 ? 0.15 : sameDay ? 0.1 : 0) +
    (sameGroup ? 0.1 : 0)
  );
}

export function findBestImportMatch(
  candidates: ImportMatchCandidate[],
  incoming: ImportMatchInput,
): ImportMatchCandidate | null {
  let best: { candidate: ImportMatchCandidate; score: number } | null = null;
  for (const candidate of candidates) {
    const score = scoreImportDuplicate(candidate, incoming);
    if (score < MATCH_THRESHOLD) continue;
    if (!best || score > best.score) best = { candidate, score };
  }
  return best?.candidate ?? null;
}
