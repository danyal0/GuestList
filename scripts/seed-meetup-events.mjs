#!/usr/bin/env node
/**
 * Intelligently seed Meetup-scraped events into the file-mode mock DB.
 *
 * - Infers Milwaukee relevance (keeps local + ambiguous; drops clear out-of-market)
 * - Maps events into existing communities when keywords fit, else creates
 *   dedicated Meetup communities or category hubs
 * - Autofills venue/location via catalog aliases + known MKE place heuristics
 * - Parses "Fri, Jul 31 · 6:30 PM CDT" into America/Chicago start/end
 * - Idempotent: removes prior meetup_* rows then re-imports
 *
 * Usage:
 *   node scripts/seed-meetup-events.mjs
 *   MOCK_DB_PATH=/data/mock-db.json node scripts/seed-meetup-events.mjs
 *   MEETUP_JSON=./path.json INCLUDE_REMOTE=1 node scripts/seed-meetup-events.mjs
 */
import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_JSON = join(ROOT, 'apps/api/data/meetup-events-captured.json');
const DEFAULT_SEED = join(ROOT, 'apps/api/data/mock-db.json');
const VENUES_CATALOG = join(ROOT, 'apps/api/src/data/venues-catalog.json');

const YEAR = 2026;
const TZ = 'America/Chicago';
const INCLUDE_REMOTE = process.env.INCLUDE_REMOTE === '1';

const CATEGORY_RULES = [
  { category: 'SPORTS', host: 'user_diego', re: /\b(tennis|pickleball|basketball|soccer|football|volleyball|running|run\b|5k|golf|chess|hockey|climbing|climb|archery|foam\s*fight|bike|cycling|swim|underwater|padel)\b/i },
  { category: 'OUTDOORS', host: 'user_maya', re: /\b(hike|hiking|trail|kayak|paddle|camping|tubing|river\s*walk|pier\s*walk|outdoors?|nature)\b/i },
  { category: 'TECHNOLOGY', host: 'user_priya', re: /\b(code|coding|software|python|javascript|data\s*science|machine\s*learning|\bml\b|ai\b|llm|bitcoin|hacker|cyber|sql|github|devops|engineer|tech|mitobyte|nscoder)\b/i },
  { category: 'PHOTOGRAPHY', host: 'user_leo', re: /\b(photo|photography|sketch|drawing|paint|art\b|anime|film\b|cinema)\b/i },
  { category: 'BOOKS', host: 'user_sam', re: /\b(book\s*club|reading|author\s*talk|nonfiction|novel|dune|write|writer|screenplay)\b/i },
  { category: 'MUSIC', host: 'user_diego', re: /\b(music|choir|chorus|concert|songwrit|karaoke|sing)\b/i },
  { category: 'FOOD', host: 'user_maya', re: /\b(beer|happy\s*hour|wine|dining|dinner|feast|coffee|cafe|ice\s*cream|brunch|food|brew)\b/i },
  { category: 'HEALTH', host: 'user_priya', re: /\b(yoga|meditation|healing|hypnosis|wellness|therapy|mental\s*health|eq\b|emotional|cptsd|adhd|autism|neurodiversity|self[- ]?trust|anxiety)\b/i },
  { category: 'LANGUAGE', host: 'user_diego', re: /\b(spanish|español|japanese|language\s*exchange|toastmasters|conversation\s*club)\b/i },
  { category: 'GAMES', host: 'user_sam', re: /\b(board\s*game|dnd|dungeons|gaming|game\s*night|chess|improv)\b/i },
  { category: 'BUSINESS', host: 'user_sam', re: /\b(network|career|job|recruiter|linkedin|professional|entrepreneur|founder|real\s*estate|reia)\b/i },
  { category: 'EDUCATION', host: 'user_priya', re: /\b(workshop|class|learn|philosophy|lecture|study|channeling|tarot|psychic)\b/i },
  { category: 'ARTS', host: 'user_leo', re: /\b(craft|crochet|knit|sew|dance|museum|gallery|creative)\b/i },
  { category: 'COMMUNITY', host: 'user_maya', re: /\b(meetup|social|singles|friends|peer\s*support|community|christian|church)\b/i },
];

/** Only reuse clearly local communities — never SF demo groups. */
const EXISTING_GROUP_MATCHERS = [
  { id: 'group_mke_tennis', re: /\btennis\b/i },
];

const HUBS = {
  SPORTS: { name: 'MKE Sports & Fitness', description: 'Pickup games, leagues, and active meetups around Milwaukee.' },
  OUTDOORS: { name: 'MKE Outdoors', description: 'Hikes, paddles, trails, and fresh-air adventures in and around Milwaukee.' },
  TECHNOLOGY: { name: 'MKE Tech & Builders', description: 'Code nights, data, AI, and builder hangouts across Milwaukee.' },
  PHOTOGRAPHY: { name: 'MKE Arts & Lens', description: 'Photo walks, sketch nights, and visual arts around the city.' },
  BOOKS: { name: 'MKE Readers & Writers', description: 'Book clubs, author talks, and writing circles.' },
  MUSIC: { name: 'MKE Music Scene', description: 'Choirs, songwriter nights, and live music socials.' },
  FOOD: { name: 'MKE Food & Drink', description: 'Happy hours, beer gardens, tastings, and dinner meetups.' },
  HEALTH: { name: 'MKE Wellness', description: 'Yoga, meditation, healing, and peer support.' },
  LANGUAGE: { name: 'MKE Language Exchange', description: 'Practice Spanish, Japanese, Toastmasters, and conversation clubs.' },
  GAMES: { name: 'MKE Games & Play', description: 'Board games, tabletop, and playful evenings.' },
  BUSINESS: { name: 'MKE Professionals', description: 'Networking, careers, and professional communities.' },
  EDUCATION: { name: 'MKE Learning Circle', description: 'Workshops, philosophy, and lifelong learning.' },
  ARTS: { name: 'MKE Makers & Crafts', description: 'Crafts, dance, and creative meetups.' },
  COMMUNITY: { name: 'MKE Social Meetup', description: 'New friends, socials, and community gatherings across Milwaukee.' },
  FILM: { name: 'MKE Film Night', description: 'Screenings and film discussions.' },
  SCIENCE: { name: 'MKE Science Curious', description: 'Science talks and curiosity meetups.' },
};

/** Known Milwaukee places extracted from titles → autofill location. */
const PLACE_HINTS = [
  { re: /\bmckinley\b/i, locationName: 'McKinley Pier / Veterans Park', address: '1750 N Lincoln Memorial Dr, Milwaukee, WI', latitude: 43.0445, longitude: -87.8945 },
  { re: /\bestabrook\b/i, locationName: 'Estabrook Beer Garden', address: '4400 N Estabrook Dr, Milwaukee, WI', latitude: 43.0936, longitude: -87.9042 },
  { re: /\brawson\b/i, locationName: 'Rawson Pub', address: 'Rawson Ave, Milwaukee, WI', latitude: 42.9205, longitude: -87.934 },
  { re: /\bmilwaukee public museum\b|\bmuseum\b/i, locationName: 'Milwaukee Public Museum', address: '800 W Wells St, Milwaukee, WI', latitude: 43.0407, longitude: -87.9202 },
  { re: /\bcorner street bakery\b/i, locationName: 'Corner Street Bakery', address: 'Milwaukee, WI', latitude: 43.0389, longitude: -87.9065 },
  { re: /\bhuhbard\b|\bhubbard park\b/i, locationName: 'Hubbard Park', address: '3565 N Morris Blvd, Shorewood, WI', latitude: 43.0895, longitude: -87.8905 },
  { re: /\bwarnimont\b/i, locationName: 'Warnimont Golf Course', address: 'Cudahy, WI', latitude: 42.948, longitude: -87.86 },
  { re: /\bmilwaukee yards\b/i, locationName: 'Milwaukee Yards Complex', address: 'Milwaukee, WI', latitude: 43.0389, longitude: -87.9065 },
  { re: /\bwalter schroeder\b/i, locationName: 'Walter Schroeder Aquatic Center', address: 'Brown Deer, WI', latitude: 43.164, longitude: -87.976 },
  { re: /\bnorth point\b/i, locationName: 'North Point', address: 'Milwaukee, WI', latitude: 43.062, longitude: -87.875 },
  { re: /\bbevvy garden\b/i, locationName: 'Bevvy Garden', address: 'Milwaukee, WI', latitude: 43.0389, longitude: -87.9065 },
  { re: /\bcolectivo\b/i, locationName: 'Colectivo Coffee', address: 'Milwaukee, WI', latitude: 43.048, longitude: -87.895 },
  { re: /\blake park\b/i, locationName: 'Lake Park', address: '3233 E Belleview Pl, Milwaukee, WI', latitude: 43.0667, longitude: -87.8701 },
  { re: /\batwater\b/i, locationName: 'Atwater Park', address: 'Shorewood, WI', latitude: 43.0892, longitude: -87.873 },
  { re: /\bhumboldt\b/i, locationName: 'Humboldt Park', address: 'Milwaukee, WI', latitude: 42.998, longitude: -87.898 },
  { re: /\bhart park\b/i, locationName: 'Hart Park', address: 'Wauwatosa, WI', latitude: 43.0495, longitude: -88.0076 },
  { re: /\bzoom\b|\bonline\b|\bvirtual\b|\bhybrid\b/i, mode: 'ONLINE' },
];

const MKE_ALLOW =
  /milwaukee|mke|wauwatosa|shorewood|bay\s*view|whitefish|west\s*allis|brookfield|cudahy|brown\s*deer|wisconsin|\bwi\b|mckinley|estabrook|warnimont|hubbard|tosa\b|mitobyte|mkeclimbing|mkeuwh|new-friends-mke|heartandsoul|just-write|karma-yoga|toastmasters|milwaukee-|mke-|wis-/i;

const REMOTE_BLOCK =
  /\b(chicago|toronto|pittsburgh|nashville|minneapolis|minnesota|michigan|ohio|indiana|indy\b|pennsylvania|evanston|st[- ]?louis|columbus|gatewayjug|pynash|javascriptmn|rladies|fabric.?power|ohio-north|grants-professionals|quarantine_improv|iwanttodothatchicago|producttank|madison-fabric|cheaper-than-therapy|data-engineers-in-toronto|artsrecto|mirror-in-the-sky|high-pattern|learning-to-channel|citizens-climate|songwriters-cafe|pittsburgh-sketch|michigan-python|chicago-|toronto-|minneapolis-|minnesota-)/i;

function slugify(input, withSuffix = false) {
  const base = String(input)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const safe = base || 'item';
  return withSuffix ? `${safe}-${randomBytes(3).toString('hex')}` : safe;
}

function titleFromSlug(slug) {
  return slug
    .replace(/^meetup-group-[a-z0-9]+$/i, 'Milwaukee Meetup')
    .replace(/[-_]+/g, ' ')
    .replace(/\bwww\b/gi, '')
    .replace(/\bmke\b/gi, 'MKE')
    .replace(/\bwi\b/gi, 'WI')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function meetupSlug(link) {
  const m = String(link || '').match(/meetup\.com\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function stableId(prefix, key) {
  const h = createHash('sha1').update(String(key)).digest('hex').slice(0, 12);
  return `${prefix}_${h}`;
}

function inferCategory(text) {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(text)) return { category: rule.category, hostId: rule.host };
  }
  return { category: 'COMMUNITY', hostId: 'user_maya' };
}

function isMilwaukeeRelevant(row, slug) {
  const blob = `${row.Name} ${slug || ''} ${row.Link || ''}`;
  if (MKE_ALLOW.test(blob)) return true;
  if (REMOTE_BLOCK.test(blob)) return false;
  // Ambiguous local-looking meetups without a remote city → keep for MKE demo
  return !/\b(il|ny|ca|tx|fl|on\b|pa\b|oh\b|mn\b|tn\b|mi\b)\b/i.test(slug || '');
}

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/** Parse Meetup list date like "Fri, Jul 31 · 6:30 PM CDT" → Date in local Chicago wall time as UTC ISO via offset approx. */
function parseMeetupWhen(raw, year = YEAR) {
  const s = String(raw || '');
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}).*?(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) {
    // fallback: next Saturday noon CT
    const d = new Date(`${year}-08-01T17:00:00.000Z`);
    return { start: d, end: new Date(d.getTime() + 2 * 3600_000) };
  }
  const month = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  let hour = Number(m[3]) % 12;
  if (String(m[5]).toUpperCase() === 'PM') hour += 12;
  const minute = Number(m[4]);
  // CDT = UTC-5 in summer
  const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-05:00`;
  const start = new Date(iso);
  const end = new Date(start.getTime() + 2 * 3600_000);
  return { start, end };
}

function loadCatalog() {
  if (!existsSync(VENUES_CATALOG)) return [];
  return JSON.parse(readFileSync(VENUES_CATALOG, 'utf8'));
}

function resolveCatalogVenue(text, catalog) {
  const hay = String(text || '').toLowerCase();
  let best = null;
  for (const venue of catalog) {
    const aliases = [venue.name, ...(venue.aliases || [])].map((a) => String(a).toLowerCase());
    for (const alias of aliases) {
      if (alias.length < 3) continue;
      if (hay.includes(alias)) {
        const score = alias.length;
        if (!best || score > best.score) best = { venue, score, alias };
      }
    }
  }
  return best;
}

function resolvePlace(text, catalog) {
  // Prefer specific local place hints before tennis catalog aliases
  // (e.g. "McKinley Pier Walk" must not become McKinley Tennis Courts).
  for (const hint of PLACE_HINTS) {
    if (hint.re.test(text)) {
      if (hint.mode === 'ONLINE') {
        return {
          locationName: null,
          address: null,
          latitude: null,
          longitude: null,
          mode: 'ONLINE',
          onlineUrl: 'https://meet.google.com/',
          source: 'online-hint',
        };
      }
      return {
        locationName: hint.locationName,
        address: hint.address,
        latitude: hint.latitude,
        longitude: hint.longitude,
        mode: 'IN_PERSON',
        source: 'place-hint',
      };
    }
  }

  const catalogHit = resolveCatalogVenue(text, catalog);
  if (catalogHit) {
    const v = catalogHit.venue;
    const sportish = /\b(tennis|court|pickleball|racket)\b/i.test(text);
    const strongAlias = catalogHit.alias.length >= 10 || /tennis|court/i.test(catalogHit.alias);
    if (sportish || strongAlias) {
      return {
        locationName: v.name,
        address: v.address,
        latitude: v.latitude,
        longitude: v.longitude,
        venueSlug: v.slug,
        capacity: v.defaultCapacity ?? null,
        mode: 'IN_PERSON',
        source: 'catalog',
      };
    }
  }

  return {
    locationName: 'Milwaukee, WI',
    address: 'Milwaukee, WI',
    latitude: 43.0389,
    longitude: -87.9065,
    mode: 'IN_PERSON',
    source: 'default-mke',
  };
}

function buildDescription(row, place, groupName) {
  const attendees = Number(row.Attendees) || 0;
  const rating = row.Rating ? ` Meetup rating ${row.Rating}.` : '';
  const crowd = attendees > 0 ? ` About ${attendees} people interested on Meetup.` : '';
  const where =
    place.mode === 'ONLINE'
      ? 'This gathering is online.'
      : place.locationName
        ? `Meet at ${place.locationName}${place.address && place.address !== place.locationName ? ` (${place.address})` : ''}.`
        : 'Milwaukee area.';
  const link = row.Link ? `\n\nOriginally listed on Meetup: ${row.Link.split('?')[0]}` : '';
  return `${row.Name} — hosted with ${groupName}. ${where}${crowd}${rating} Times and details autofilled from the Meetup listing; confirm on arrival.${link}`;
}

function ensureOwnerMember(db, groupId, userId, now) {
  const exists = db.groupMembers.some((m) => m.groupId === groupId && m.userId === userId);
  if (exists) return;
  db.groupMembers.push({
    id: stableId('gm', `${groupId}:${userId}`),
    groupId,
    userId,
    role: 'OWNER',
    status: 'ACTIVE',
    joinedAt: now,
  });
}

function pickCommunity(db, { slug, title, category, hostId, coverImage, now, eventCount }) {
  const blob = `${title} ${slug}`;

  for (const matcher of EXISTING_GROUP_MATCHERS) {
    if (matcher.re.test(blob)) {
      const g = db.groups.find((x) => x.id === matcher.id && !x.deletedAt);
      if (g) return { group: g, created: false, reason: 'existing-keyword' };
    }
  }

  // Dedicated community for recurring Meetup brands (2+ events) or strong local names
  const dedicated = eventCount >= 2 || /milwaukee|mke|friends|toastmasters|yoga|game|writers|chess|climbing/i.test(slug);
  if (dedicated) {
    const id = stableId('group_meetup', slug);
    let group = db.groups.find((g) => g.id === id);
    if (!group) {
      const name = titleFromSlug(slug);
      const baseSlug = slugify(name, false);
      let finalSlug = baseSlug;
      let n = 2;
      while (db.groups.some((g) => g.slug === finalSlug)) {
        finalSlug = `${baseSlug}-${n++}`;
      }
      group = {
        id,
        slug: finalSlug,
        name,
        description: `${name} — community imported from Meetup listings around Milwaukee. Open to newcomers; RSVP so hosts can plan.`,
        rules: '1. RSVP honestly.\n2. Be welcoming.\n3. Follow host guidance at the venue.',
        coverImage: coverImage || null,
        category,
        ownerId: hostId,
        privacy: 'PUBLIC',
        memberCount: 1,
        location: 'Milwaukee, WI',
        latitude: 43.0389,
        longitude: -87.9065,
        isVerified: false,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      db.groups.push(group);
      ensureOwnerMember(db, group.id, hostId, now);
      return { group, created: true, reason: 'dedicated-meetup' };
    }
    return { group, created: false, reason: 'dedicated-existing' };
  }

  // Category hub
  const hub = HUBS[category] || HUBS.COMMUNITY;
  const hubId = stableId('group_hub', category);
  let group = db.groups.find((g) => g.id === hubId);
  if (!group) {
    const baseSlug = slugify(hub.name, false);
    let finalSlug = baseSlug;
    let n = 2;
    while (db.groups.some((g) => g.slug === finalSlug)) finalSlug = `${baseSlug}-${n++}`;
    group = {
      id: hubId,
      slug: finalSlug,
      name: hub.name,
      description: hub.description,
      rules: '1. RSVP honestly.\n2. Be kind.\n3. Share the space.',
      coverImage: coverImage || null,
      category,
      ownerId: hostId,
      privacy: 'PUBLIC',
      memberCount: 1,
      location: 'Milwaukee, WI',
      latitude: 43.0389,
      longitude: -87.9065,
      isVerified: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    db.groups.push(group);
    ensureOwnerMember(db, group.id, hostId, now);
    return { group, created: true, reason: 'hub' };
  }
  return { group, created: false, reason: 'hub-existing' };
}

function resolveDbPath() {
  if (process.env.MOCK_DB_PATH) return process.env.MOCK_DB_PATH;
  if (existsSync('/data') || process.env.RAILWAY_ENVIRONMENT) return join('/data', 'mock-db.json');
  return DEFAULT_SEED;
}

async function main() {
  const jsonPath = process.env.MEETUP_JSON || DEFAULT_JSON;
  const dbPath = resolveDbPath();
  if (!existsSync(jsonPath)) throw new Error(`Meetup JSON not found: ${jsonPath}`);
  if (!existsSync(dbPath)) {
    mkdirSync(dirname(dbPath), { recursive: true });
    copyFileSync(DEFAULT_SEED, dbPath);
  }

  const rows = JSON.parse(readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('Expected Meetup JSON array');
  const catalog = loadCatalog();
  const db = JSON.parse(readFileSync(dbPath, 'utf8'));
  const now = new Date().toISOString();

  // Idempotent cleanup of prior meetup import
  const removeGroupIds = new Set(
    db.groups.filter((g) => String(g.id).startsWith('group_meetup_') || String(g.id).startsWith('group_hub_')).map((g) => g.id),
  );
  const removeEventIds = new Set(
    db.events.filter((e) => String(e.id).startsWith('event_meetup_')).map((e) => e.id),
  );
  db.events = db.events.filter((e) => !removeEventIds.has(e.id) && !removeGroupIds.has(e.groupId));
  db.rsvps = (db.rsvps || []).filter((r) => !removeEventIds.has(r.eventId));
  db.groupMembers = (db.groupMembers || []).filter((m) => !removeGroupIds.has(m.groupId));
  db.follows = (db.follows || []).filter((f) => !removeGroupIds.has(f.groupId));
  db.groups = db.groups.filter((g) => !removeGroupIds.has(g.id));

  // Ensure venue rows exist for catalog hits used later
  if (!Array.isArray(db.venues)) db.venues = [];
  const venueBySlug = new Map(db.venues.map((v) => [v.slug, v]));

  // Count events per meetup slug (for dedicated community decision)
  const bySlug = new Map();
  const accepted = [];
  for (const row of rows) {
    const slug = meetupSlug(row.Link) || slugify(row.Name || 'event', false);
    if (!INCLUDE_REMOTE && !isMilwaukeeRelevant(row, slug)) continue;
    accepted.push({ row, slug });
    bySlug.set(slug, (bySlug.get(slug) || 0) + 1);
  }

  let createdGroups = 0;
  let createdEvents = 0;
  const stats = { catalog: 0, placeHint: 0, default: 0, online: 0, skippedRemote: rows.length - accepted.length };

  for (const { row, slug } of accepted) {
    const title = String(row.Name || 'Meetup event').trim();
    const blob = `${title} ${slug}`;
    const { category, hostId } = inferCategory(blob);
    const place = resolvePlace(blob, catalog);
    if (place.source === 'catalog') stats.catalog += 1;
    else if (place.source === 'place-hint') stats.placeHint += 1;
    else if (place.source === 'online-hint') stats.online += 1;
    else stats.default += 1;

    let venueId = null;
    if (place.venueSlug) {
      let venue = venueBySlug.get(place.venueSlug);
      if (!venue) {
        const cat = catalog.find((v) => v.slug === place.venueSlug);
        if (cat) {
          venue = {
            id: `venue_${cat.slug.replace(/-/g, '').slice(0, 16)}`,
            slug: cat.slug,
            name: cat.name,
            sport: cat.sport,
            city: cat.city,
            region: cat.region,
            country: cat.country,
            address: cat.address,
            latitude: cat.latitude,
            longitude: cat.longitude,
            aliases: cat.aliases || [],
            notes: cat.notes ?? null,
            courtCount: cat.courtCount ?? null,
            defaultCapacity: cat.defaultCapacity ?? null,
            source: 'catalog',
            verifiedAt: now,
            createdAt: now,
            updatedAt: now,
          };
          db.venues.push(venue);
          venueBySlug.set(venue.slug, venue);
        }
      }
      venueId = venue?.id ?? null;
    }

    const { group, created } = pickCommunity(db, {
      slug,
      title: titleFromSlug(slug),
      category,
      hostId,
      coverImage: row.Image || null,
      now,
      eventCount: bySlug.get(slug) || 1,
    });
    if (created) createdGroups += 1;

    // Ensure host can create events (OWNER/ADMIN/MODERATOR)
    ensureOwnerMember(db, group.id, hostId, now);
    if (group.ownerId !== hostId && !db.groupMembers.some((m) => m.groupId === group.id && m.userId === hostId)) {
      db.groupMembers.push({
        id: stableId('gm', `${group.id}:${hostId}:mod`),
        groupId: group.id,
        userId: hostId,
        role: 'MODERATOR',
        status: 'ACTIVE',
        joinedAt: now,
      });
    }

    const { start, end } = parseMeetupWhen(row['Date and Time']);
    const attendees = Number(row.Attendees) || 0;
    const capacity =
      place.capacity ??
      (attendees > 0 ? Math.min(500, Math.max(12, Math.round(attendees * 1.15))) : 40);

    const eventId = stableId('event_meetup', row.Link || `${slug}:${title}:${row['Date and Time']}`);
    if (db.events.some((e) => e.id === eventId)) continue;

    db.events.push({
      id: eventId,
      groupId: group.id,
      hostId,
      venueId,
      title: title.slice(0, 120),
      description: buildDescription(row, place, group.name),
      coverImage: row.Image || null,
      mode: place.mode || 'IN_PERSON',
      locationName: place.locationName ?? null,
      address: place.address ?? null,
      latitude: place.latitude ?? null,
      longitude: place.longitude ?? null,
      onlineUrl: place.onlineUrl ?? null,
      timezone: TZ,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      previousStartTime: null,
      rescheduledAt: null,
      capacity,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      allowWaitlist: true,
      rsvpDeadline: null,
      recurrenceRule: null,
      parentEventId: null,
      whatsappMessageId: null,
      remindersSentAt: null,
      createdAt: now,
      updatedAt: now,
      // Keep relative rebasing off for fixed Meetup calendar dates
      _startOffsetDays: undefined,
      _durationHours: undefined,
    });
    createdEvents += 1;
  }

  // Refresh memberCount for imported groups
  for (const g of db.groups) {
    if (!String(g.id).startsWith('group_meetup_') && !String(g.id).startsWith('group_hub_')) continue;
    g.memberCount = Math.max(
      1,
      db.groupMembers.filter((m) => m.groupId === g.id && (m.status === 'ACTIVE' || m.status == null)).length,
    );
  }

  db.meta = {
    ...(db.meta || {}),
    meetupImportAt: now,
    meetupImport: {
      source: jsonPath,
      accepted: accepted.length,
      createdGroups,
      createdEvents,
      skippedRemote: stats.skippedRemote,
      venueFill: stats,
    },
  };

  writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`);

  if ((process.env.XAI_API_KEY || '').trim()) {
    await enrichWithAi(db, dbPath);
  }

  console.log(
    JSON.stringify(
      {
        dbPath,
        accepted: accepted.length,
        createdGroups,
        createdEvents,
        totalGroups: db.groups.length,
        totalEvents: db.events.length,
        venueFill: stats,
        ai: Boolean((process.env.XAI_API_KEY || '').trim()),
      },
      null,
      2,
    ),
  );
}

async function enrichWithAi(db, dbPath) {
  const targets = db.events.filter(
    (e) =>
      String(e.id).startsWith('event_meetup_') &&
      e.locationName === 'Milwaukee, WI' &&
      e.mode === 'IN_PERSON',
  );
  if (!targets.length) return;

  const apiKey = process.env.XAI_API_KEY.trim();
  const apiUrl = process.env.XAI_API_URL || 'https://api.x.ai/v1/chat/completions';
  const model = process.env.XAI_MODEL || 'grok-4-1-fast-non-reasoning-latest';
  let updated = 0;

  for (let i = 0; i < targets.length; i += 15) {
    const batch = targets.slice(i, i + 15);
    const payload = batch.map((e) => ({ id: e.id, title: e.title }));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You enrich Milwaukee Meetup events. For each event guess a real Milwaukee-area venue if the title implies one. Return JSON {"items":[{"id":"...","locationName":"...","address":"...","latitude":43.0,"longitude":-87.9}]} . If unknown, omit the item. Only Milwaukee / SE Wisconsin.',
            },
            { role: 'user', content: JSON.stringify({ events: payload }) },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content ?? '';
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      for (const item of items) {
        const event = db.events.find((e) => e.id === item.id);
        if (!event || !item.locationName) continue;
        event.locationName = String(item.locationName).slice(0, 120);
        if (item.address) event.address = String(item.address).slice(0, 200);
        if (typeof item.latitude === 'number') event.latitude = item.latitude;
        if (typeof item.longitude === 'number') event.longitude = item.longitude;
        event.updatedAt = new Date().toISOString();
        updated += 1;
      }
    } catch {
      // best-effort
    }
  }

  if (updated) {
    db.meta.meetupImport = { ...(db.meta.meetupImport || {}), aiEnriched: updated };
    writeFileSync(dbPath, `${JSON.stringify(db, null, 2)}\n`);
    console.log(`AI enriched ${updated} event locations`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
