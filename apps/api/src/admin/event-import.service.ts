import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EventMode,
  EventStatus,
  EventVisibility,
  GroupCategory,
  GroupMemberRole,
  GroupMemberStatus,
  GroupPrivacy,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../common/utils/slug';
import { resolveCatalogVenue } from '../whatsapp/whatsapp-event-enrich';

export type ImportEventRow = {
  name: string;
  dateTime?: string;
  group?: string;
  attendees?: string | number;
  rating?: string | number;
  image?: string;
  link?: string;
  location?: string;
  description?: string;
  category?: string;
};

export type ImportEventsResult = {
  accepted: number;
  skippedRemote: number;
  skippedInvalid: number;
  createdGroups: number;
  reusedGroups: number;
  createdEvents: number;
  updatedEvents: number;
  samples: Array<{ title: string; group: string; location: string | null }>;
};

type CategoryRule = { category: GroupCategory; hostEmail: string; re: RegExp };

const CATEGORY_RULES: CategoryRule[] = [
  { category: GroupCategory.SPORTS, hostEmail: 'diego@example.com', re: /\b(tennis|pickleball|basketball|soccer|football|volleyball|running|run\b|5k|golf|chess|hockey|climbing|climb|archery|foam\s*fight|bike|cycling|swim|underwater|padel)\b/i },
  { category: GroupCategory.OUTDOORS, hostEmail: 'maya@example.com', re: /\b(hike|hiking|trail|kayak|paddle|camping|tubing|river\s*walk|pier\s*walk|outdoors?|nature)\b/i },
  { category: GroupCategory.TECHNOLOGY, hostEmail: 'priya@example.com', re: /\b(code|coding|software|python|javascript|data\s*science|machine\s*learning|\bml\b|ai\b|llm|bitcoin|hacker|cyber|sql|github|devops|engineer|tech|mitobyte|nscoder)\b/i },
  { category: GroupCategory.PHOTOGRAPHY, hostEmail: 'leo@example.com', re: /\b(photo|photography|sketch|drawing|paint|art\b|anime|film\b|cinema)\b/i },
  { category: GroupCategory.BOOKS, hostEmail: 'sam@example.com', re: /\b(book\s*club|reading|author\s*talk|nonfiction|novel|dune|write|writer|screenplay)\b/i },
  { category: GroupCategory.MUSIC, hostEmail: 'diego@example.com', re: /\b(music|choir|chorus|concert|songwrit|karaoke|sing)\b/i },
  { category: GroupCategory.FOOD, hostEmail: 'maya@example.com', re: /\b(beer|happy\s*hour|wine|dining|dinner|feast|coffee|cafe|ice\s*cream|brunch|food|brew)\b/i },
  { category: GroupCategory.HEALTH, hostEmail: 'priya@example.com', re: /\b(yoga|meditation|healing|hypnosis|wellness|therapy|mental\s*health|eq\b|emotional|cptsd|adhd|autism|neurodiversity|self[- ]?trust|anxiety)\b/i },
  { category: GroupCategory.LANGUAGE, hostEmail: 'diego@example.com', re: /\b(spanish|español|japanese|language\s*exchange|toastmasters|conversation\s*club)\b/i },
  { category: GroupCategory.GAMES, hostEmail: 'sam@example.com', re: /\b(board\s*game|dnd|dungeons|gaming|game\s*night|chess|improv)\b/i },
  { category: GroupCategory.BUSINESS, hostEmail: 'sam@example.com', re: /\b(network|career|job|recruiter|linkedin|professional|entrepreneur|founder|real\s*estate|reia)\b/i },
  { category: GroupCategory.EDUCATION, hostEmail: 'priya@example.com', re: /\b(workshop|class|learn|philosophy|lecture|study|channeling|tarot|psychic)\b/i },
  { category: GroupCategory.ARTS, hostEmail: 'leo@example.com', re: /\b(craft|crochet|knit|sew|dance|museum|gallery|creative)\b/i },
  { category: GroupCategory.COMMUNITY, hostEmail: 'maya@example.com', re: /\b(meetup|social|singles|friends|peer\s*support|community|christian|church)\b/i },
];

const HUBS: Partial<Record<GroupCategory, { name: string; description: string }>> = {
  [GroupCategory.SPORTS]: { name: 'MKE Sports & Fitness', description: 'Pickup games, leagues, and active meetups around Milwaukee.' },
  [GroupCategory.OUTDOORS]: { name: 'MKE Outdoors', description: 'Hikes, paddles, trails, and fresh-air adventures in and around Milwaukee.' },
  [GroupCategory.TECHNOLOGY]: { name: 'MKE Tech & Builders', description: 'Code nights, data, AI, and builder hangouts across Milwaukee.' },
  [GroupCategory.PHOTOGRAPHY]: { name: 'MKE Arts & Lens', description: 'Photo walks, sketch nights, and visual arts around the city.' },
  [GroupCategory.BOOKS]: { name: 'MKE Readers & Writers', description: 'Book clubs, author talks, and writing circles.' },
  [GroupCategory.MUSIC]: { name: 'MKE Music Scene', description: 'Choirs, songwriter nights, and live music socials.' },
  [GroupCategory.FOOD]: { name: 'MKE Food & Drink', description: 'Happy hours, beer gardens, tastings, and dinner meetups.' },
  [GroupCategory.HEALTH]: { name: 'MKE Wellness', description: 'Yoga, meditation, healing, and peer support.' },
  [GroupCategory.LANGUAGE]: { name: 'MKE Language Exchange', description: 'Practice Spanish, Japanese, Toastmasters, and conversation clubs.' },
  [GroupCategory.GAMES]: { name: 'MKE Games & Play', description: 'Board games, tabletop, and playful evenings.' },
  [GroupCategory.BUSINESS]: { name: 'MKE Professionals', description: 'Networking, careers, and professional communities.' },
  [GroupCategory.EDUCATION]: { name: 'MKE Learning Circle', description: 'Workshops, philosophy, and lifelong learning.' },
  [GroupCategory.ARTS]: { name: 'MKE Makers & Crafts', description: 'Crafts, dance, and creative meetups.' },
  [GroupCategory.COMMUNITY]: { name: 'MKE Social Meetup', description: 'New friends, socials, and community gatherings across Milwaukee.' },
  [GroupCategory.FILM]: { name: 'MKE Film Night', description: 'Screenings and film discussions.' },
  [GroupCategory.SCIENCE]: { name: 'MKE Science Curious', description: 'Science talks and curiosity meetups.' },
};

const PLACE_HINTS: Array<{
  re: RegExp;
  locationName?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  mode?: EventMode;
}> = [
  { re: /\bmckinley\b/i, locationName: 'McKinley Pier / Veterans Park', address: '1750 N Lincoln Memorial Dr, Milwaukee, WI', latitude: 43.0445, longitude: -87.8945 },
  { re: /\bestabrook\b/i, locationName: 'Estabrook Beer Garden', address: '4400 N Estabrook Dr, Milwaukee, WI', latitude: 43.0936, longitude: -87.9042 },
  { re: /\brawson\b/i, locationName: 'Rawson Pub', address: 'Rawson Ave, Milwaukee, WI', latitude: 42.9205, longitude: -87.934 },
  { re: /\bmilwaukee public museum\b/i, locationName: 'Milwaukee Public Museum', address: '800 W Wells St, Milwaukee, WI', latitude: 43.0407, longitude: -87.9202 },
  { re: /\bcorner street bakery\b/i, locationName: 'Corner Street Bakery', address: 'Milwaukee, WI', latitude: 43.0389, longitude: -87.9065 },
  { re: /\bhubbard park\b/i, locationName: 'Hubbard Park', address: '3565 N Morris Blvd, Shorewood, WI', latitude: 43.0895, longitude: -87.8905 },
  { re: /\bwarnimont\b/i, locationName: 'Warnimont Golf Course', address: 'Cudahy, WI', latitude: 42.948, longitude: -87.86 },
  { re: /\blake park\b/i, locationName: 'Lake Park', address: '3233 E Belleview Pl, Milwaukee, WI', latitude: 43.0667, longitude: -87.8701 },
  { re: /\batwater\b/i, locationName: 'Atwater Park', address: 'Shorewood, WI', latitude: 43.0892, longitude: -87.873 },
  { re: /\bhumboldt\b/i, locationName: 'Humboldt Park', address: 'Milwaukee, WI', latitude: 42.998, longitude: -87.898 },
  { re: /\bhart park\b/i, locationName: 'Hart Park', address: 'Wauwatosa, WI', latitude: 43.0495, longitude: -88.0076 },
  { re: /\bzoom\b|\bonline\b|\bvirtual\b/i, mode: EventMode.ONLINE },
];

const MKE_ALLOW =
  /milwaukee|mke|wauwatosa|shorewood|bay\s*view|whitefish|west\s*allis|brookfield|cudahy|brown\s*deer|wisconsin|\bwi\b|mckinley|estabrook|warnimont|hubbard|tosa\b|mitobyte|mkeclimbing|mkeuwh|new-friends-mke|heartandsoul|just-write|karma-yoga|toastmasters|milwaukee-|mke-|wis-/i;

const REMOTE_BLOCK =
  /\b(chicago|toronto|pittsburgh|nashville|minneapolis|minnesota|michigan|ohio|indiana|indy\b|pennsylvania|evanston|st[- ]?louis|columbus|gatewayjug|pynash|javascriptmn|rladies|fabric.?power|ohio-north|grants-professionals|quarantine_improv|iwanttodothatchicago|producttank|madison-fabric|cheaper-than-therapy|data-engineers-in-toronto|artsrecto|mirror-in-the-sky|high-pattern|learning-to-channel|citizens-climate|songwriters-cafe|pittsburgh-sketch|michigan-python|chicago-|toronto-|minneapolis-|minnesota-)/i;

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const FIELD_ALIASES: Record<keyof ImportEventRow, string[]> = {
  name: ['name', 'title', 'event', 'event name', 'event_title'],
  dateTime: ['date and time', 'datetime', 'date', 'start', 'starttime', 'start_time', 'when'],
  group: ['group', 'community', 'organizer', 'meetup group', 'group_name', 'community_name'],
  attendees: ['attendees', 'rsvps', 'going', 'capacity'],
  rating: ['rating', 'score'],
  image: ['image', 'cover', 'coverimage', 'cover_image', 'photo', 'image_url'],
  link: ['link', 'url', 'event_url', 'meetup_url'],
  location: ['location', 'venue', 'place', 'address', 'location_name'],
  description: ['description', 'details', 'about', 'desc'],
  category: ['category', 'type', 'topic'],
};

@Injectable()
export class EventImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  parseUpload(buffer: Buffer, filename: string): ImportEventRow[] {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lower = filename.toLowerCase();
    if (lower.endsWith('.json') || text.trim().startsWith('[') || text.trim().startsWith('{')) {
      return this.parseJson(text);
    }
    if (lower.endsWith('.csv') || text.includes(',')) {
      return this.parseCsv(text);
    }
    throw new BadRequestException('Upload a .json or .csv file');
  }

  async importFromUpload(
    adminId: string,
    buffer: Buffer,
    filename: string,
    options: { includeRemote?: boolean } = {},
  ): Promise<ImportEventsResult> {
    const rows = this.parseUpload(buffer, filename);
    if (rows.length === 0) throw new BadRequestException('No events found in file');
    if (rows.length > 1000) throw new BadRequestException('Limit is 1000 events per upload');

    const result = await this.importRows(adminId, rows, options);
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.events_import',
      metadata: { filename, ...result },
    });
    return result;
  }

  async importRows(
    adminId: string,
    rows: ImportEventRow[],
    options: { includeRemote?: boolean } = {},
  ): Promise<ImportEventsResult> {
    const includeRemote = Boolean(options.includeRemote);
    const hostCache = new Map<string, string>();
    const resolveHost = async (email: string): Promise<string> => {
      if (hostCache.has(email)) return hostCache.get(email)!;
      const user = await this.prisma.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true },
      });
      const id = user?.id ?? adminId;
      hostCache.set(email, id);
      return id;
    };

    const slugCounts = new Map<string, number>();
    const prepared: Array<{ row: ImportEventRow; slug: string }> = [];
    let skippedRemote = 0;
    let skippedInvalid = 0;

    for (const row of rows) {
      const name = row.name?.trim();
      if (!name) {
        skippedInvalid += 1;
        continue;
      }
      const slug = this.meetupSlug(row.link) || this.slugFromGroup(row.group) || slugify(name, false);
      if (!includeRemote && !this.isMilwaukeeRelevant(row, slug)) {
        skippedRemote += 1;
        continue;
      }
      prepared.push({ row, slug });
      slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
    }

    let createdGroups = 0;
    let reusedGroups = 0;
    let createdEvents = 0;
    let updatedEvents = 0;
    const samples: ImportEventsResult['samples'] = [];

    for (const { row, slug } of prepared) {
      const title = row.name.trim();
      const blob = `${title} ${slug} ${row.group ?? ''} ${row.location ?? ''} ${row.description ?? ''}`;
      const inferred = this.inferCategory(blob, row.category);
      const hostId = await resolveHost(inferred.hostEmail);
      const place = this.resolvePlace(blob + ` ${row.location ?? ''}`);
      const eventCount = slugCounts.get(slug) || 1;

      const community = await this.ensureCommunity({
        slug,
        title: this.titleFromSlug(slug, row.group),
        category: inferred.category,
        hostId,
        coverImage: row.image || null,
        eventCount,
      });
      if (community.created) createdGroups += 1;
      else reusedGroups += 1;

      await this.ensureModerator(community.id, hostId);

      const { start, end } = this.parseWhen(row.dateTime);
      const attendees = Number(row.attendees) || 0;
      const capacity =
        place.capacity ??
        (attendees > 0 ? Math.min(500, Math.max(12, Math.round(attendees * 1.15))) : 40);

      const importKey = createHash('sha1')
        .update(row.link || `${slug}:${title}:${row.dateTime || start.toISOString()}`)
        .digest('hex')
        .slice(0, 16);
      const description =
        row.description?.trim() ||
        this.buildDescription(row, place, community.name);

      const existing = await this.prisma.event.findFirst({
        where: {
          OR: [
            { whatsappMessageId: `import:${importKey}` },
            {
              title,
              groupId: community.id,
              startTime: start,
            },
          ],
        },
        select: { id: true },
      });

      const data = {
        groupId: community.id,
        hostId,
        venueId: place.venueId ?? null,
        title: title.slice(0, 120),
        description,
        coverImage: row.image || null,
        mode: place.mode,
        locationName: place.locationName,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        onlineUrl: place.onlineUrl,
        timezone: 'America/Chicago',
        startTime: start,
        endTime: end,
        capacity,
        status: EventStatus.PUBLISHED,
        visibility: EventVisibility.PUBLIC,
        allowWaitlist: true,
        whatsappMessageId: `import:${importKey}`,
      };

      if (existing) {
        await this.prisma.event.update({ where: { id: existing.id }, data });
        updatedEvents += 1;
      } else {
        await this.prisma.event.create({ data });
        createdEvents += 1;
      }

      if (samples.length < 8) {
        samples.push({
          title: data.title,
          group: community.name,
          location: data.locationName,
        });
      }
    }

    return {
      accepted: prepared.length,
      skippedRemote,
      skippedInvalid,
      createdGroups,
      reusedGroups,
      createdEvents,
      updatedEvents,
      samples,
    };
  }

  private parseJson(text: string): ImportEventRow[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BadRequestException('Invalid JSON');
    }
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { events?: unknown }).events)
        ? (parsed as { events: unknown[] }).events
        : Array.isArray((parsed as { items?: unknown }).items)
          ? (parsed as { items: unknown[] }).items
          : null;
    if (!list) throw new BadRequestException('JSON must be an array of events');
    return list.map((item) => this.normalizeObject(item as Record<string, unknown>));
  }

  private parseCsv(text: string): ImportEventRow[] {
    const rows = this.parseCsvRows(text);
    if (rows.length < 2) throw new BadRequestException('CSV needs a header row and at least one event');
    const headers = rows[0].map((h) => h.trim());
    return rows.slice(1).map((cols) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        obj[h] = cols[i] ?? '';
      });
      return this.normalizeObject(obj);
    });
  }

  private parseCsvRows(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          field += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\r') {
        // ignore
      } else {
        field += ch;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim().length > 0));
  }

  private normalizeObject(raw: Record<string, unknown>): ImportEventRow {
    const lower: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      lower[k.trim().toLowerCase()] = v;
    }
    const pick = (key: keyof ImportEventRow): string | undefined => {
      for (const alias of FIELD_ALIASES[key]) {
        const val = lower[alias];
        if (val != null && String(val).trim()) return String(val).trim();
      }
      // Meetup scraper keys
      if (key === 'name' && lower.name) return String(lower.name).trim();
      if (key === 'dateTime' && lower['date and time']) return String(lower['date and time']).trim();
      return undefined;
    };
    return {
      name: pick('name') || '',
      dateTime: pick('dateTime'),
      group: pick('group'),
      attendees: pick('attendees'),
      rating: pick('rating'),
      image: pick('image'),
      link: pick('link'),
      location: pick('location'),
      description: pick('description'),
      category: pick('category'),
    };
  }

  private meetupSlug(link?: string): string | null {
    const m = String(link || '').match(/meetup\.com\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  }

  private slugFromGroup(group?: string): string | null {
    if (!group?.trim()) return null;
    // Scraper sometimes duplicated the date into Group — ignore that.
    if (/^[A-Za-z]{3},?\s+[A-Za-z]{3}\s+\d/i.test(group)) return null;
    if (/\d{1,2}:\d{2}\s*(AM|PM)/i.test(group)) return null;
    return slugify(group, false);
  }

  private titleFromSlug(slug: string, group?: string): string {
    if (group && !/^[A-Za-z]{3},?\s+[A-Za-z]{3}\s+\d/i.test(group) && !/\d{1,2}:\d{2}\s*(AM|PM)/i.test(group)) {
      return group.trim().slice(0, 80);
    }
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

  private isMilwaukeeRelevant(row: ImportEventRow, slug: string): boolean {
    const blob = `${row.name} ${slug} ${row.link ?? ''} ${row.location ?? ''} ${row.group ?? ''}`;
    if (MKE_ALLOW.test(blob)) return true;
    if (REMOTE_BLOCK.test(blob)) return false;
    return !/\b(il|ny|ca|tx|fl|on\b|pa\b|oh\b|mn\b|tn\b|mi\b)\b/i.test(slug);
  }

  private inferCategory(text: string, explicit?: string): { category: GroupCategory; hostEmail: string } {
    if (explicit) {
      const key = explicit.trim().toUpperCase().replace(/\s+/g, '_');
      if ((Object.values(GroupCategory) as string[]).includes(key)) {
        const rule = CATEGORY_RULES.find((r) => r.category === key);
        return {
          category: key as GroupCategory,
          hostEmail: rule?.hostEmail ?? 'maya@example.com',
        };
      }
    }
    for (const rule of CATEGORY_RULES) {
      if (rule.re.test(text)) return { category: rule.category, hostEmail: rule.hostEmail };
    }
    return { category: GroupCategory.COMMUNITY, hostEmail: 'maya@example.com' };
  }

  private resolvePlace(text: string): {
    locationName: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    mode: EventMode;
    onlineUrl: string | null;
    venueId?: string | null;
    capacity?: number | null;
  } {
    for (const hint of PLACE_HINTS) {
      if (!hint.re.test(text)) continue;
      if (hint.mode === EventMode.ONLINE) {
        return {
          locationName: null,
          address: null,
          latitude: null,
          longitude: null,
          mode: EventMode.ONLINE,
          onlineUrl: 'https://meet.google.com/',
        };
      }
      return {
        locationName: hint.locationName ?? null,
        address: hint.address ?? null,
        latitude: hint.latitude ?? null,
        longitude: hint.longitude ?? null,
        mode: EventMode.IN_PERSON,
        onlineUrl: null,
      };
    }

    const catalogHit = resolveCatalogVenue(text);
    if (catalogHit) {
      const sportish = /\b(tennis|court|pickleball|racket)\b/i.test(text);
      const strongAlias = catalogHit.matchedAlias.length >= 10 || /tennis|court/i.test(catalogHit.matchedAlias);
      if (sportish || strongAlias) {
        const v = catalogHit.venue;
        return {
          locationName: v.name,
          address: v.address,
          latitude: v.latitude,
          longitude: v.longitude,
          mode: EventMode.IN_PERSON,
          onlineUrl: null,
          capacity: v.defaultCapacity ?? null,
        };
      }
    }

    // Prefer freeform location already on the row (embedded in text after " at ")
    return {
      locationName: 'Milwaukee, WI',
      address: 'Milwaukee, WI',
      latitude: 43.0389,
      longitude: -87.9065,
      mode: EventMode.IN_PERSON,
      onlineUrl: null,
    };
  }

  private parseWhen(raw?: string): { start: Date; end: Date } {
    const year = new Date().getFullYear();
    const s = String(raw || '');
    // ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const start = new Date(s);
      if (!Number.isNaN(start.getTime())) {
        return { start, end: new Date(start.getTime() + 2 * 3600_000) };
      }
    }
    const m = s.match(/([A-Za-z]+)\s+(\d{1,2}).*?(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) {
      const start = new Date(Date.now() + 7 * 86400_000);
      start.setMinutes(0, 0, 0);
      return { start, end: new Date(start.getTime() + 2 * 3600_000) };
    }
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    let hour = Number(m[3]) % 12;
    if (String(m[5]).toUpperCase() === 'PM') hour += 12;
    const minute = Number(m[4]);
    const iso = `${year}-${String((month ?? 0) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-05:00`;
    const start = new Date(iso);
    return { start, end: new Date(start.getTime() + 2 * 3600_000) };
  }

  private buildDescription(
    row: ImportEventRow,
    place: { mode: EventMode; locationName: string | null; address: string | null },
    groupName: string,
  ): string {
    const attendees = Number(row.attendees) || 0;
    const rating = row.rating ? ` Rating ${row.rating}.` : '';
    const crowd = attendees > 0 ? ` About ${attendees} people interested.` : '';
    const where =
      place.mode === EventMode.ONLINE
        ? 'This gathering is online.'
        : place.locationName
          ? `Meet at ${place.locationName}${place.address && place.address !== place.locationName ? ` (${place.address})` : ''}.`
          : 'Milwaukee area.';
    const link = row.link ? `\n\nSource: ${String(row.link).split('?')[0]}` : '';
    return `${row.name} — hosted with ${groupName}. ${where}${crowd}${rating} Details autofilled from import; confirm with the host.${link}`;
  }

  private async ensureCommunity(input: {
    slug: string;
    title: string;
    category: GroupCategory;
    hostId: string;
    coverImage: string | null;
    eventCount: number;
  }): Promise<{ id: string; name: string; created: boolean }> {
    // Tennis → existing local community by slug
    if (/\btennis\b/i.test(`${input.title} ${input.slug}`)) {
      const tennis = await this.prisma.group.findFirst({
        where: {
          deletedAt: null,
          OR: [{ slug: 'mke-tennis-group' }, { name: { contains: 'Tennis', mode: 'insensitive' } }],
        },
        select: { id: true, name: true },
      });
      if (tennis) return { ...tennis, created: false };
    }

    const dedicated =
      input.eventCount >= 2 ||
      /milwaukee|mke|friends|toastmasters|yoga|game|writers|chess|climbing/i.test(input.slug);

    if (dedicated) {
      const importSlug = `import-${slugify(input.slug, false)}`.slice(0, 60);
      const existing = await this.prisma.group.findFirst({
        where: { deletedAt: null, OR: [{ slug: importSlug }, { name: input.title }] },
        select: { id: true, name: true },
      });
      if (existing) return { ...existing, created: false };

      const created = await this.prisma.group.create({
        data: {
          slug: slugify(input.title),
          name: input.title.slice(0, 80),
          description: `${input.title} — community imported from Meetup/CSV. Open to newcomers; RSVP so hosts can plan.`,
          rules: '1. RSVP honestly.\n2. Be welcoming.\n3. Follow host guidance at the venue.',
          coverImage: input.coverImage,
          category: input.category,
          privacy: GroupPrivacy.PUBLIC,
          memberCount: 1,
          location: 'Milwaukee, WI',
          latitude: 43.0389,
          longitude: -87.9065,
          ownerId: input.hostId,
          members: {
            create: {
              userId: input.hostId,
              role: GroupMemberRole.OWNER,
              status: GroupMemberStatus.ACTIVE,
            },
          },
        },
        select: { id: true, name: true },
      });
      return { ...created, created: true };
    }

    const hub = HUBS[input.category] ?? HUBS[GroupCategory.COMMUNITY]!;
    const existingHub = await this.prisma.group.findFirst({
      where: { deletedAt: null, name: hub.name },
      select: { id: true, name: true },
    });
    if (existingHub) return { ...existingHub, created: false };

    const createdHub = await this.prisma.group.create({
      data: {
        slug: slugify(hub.name),
        name: hub.name,
        description: hub.description,
        rules: '1. RSVP honestly.\n2. Be kind.\n3. Share the space.',
        coverImage: input.coverImage,
        category: input.category,
        privacy: GroupPrivacy.PUBLIC,
        memberCount: 1,
        location: 'Milwaukee, WI',
        latitude: 43.0389,
        longitude: -87.9065,
        ownerId: input.hostId,
        members: {
          create: {
            userId: input.hostId,
            role: GroupMemberRole.OWNER,
            status: GroupMemberStatus.ACTIVE,
          },
        },
      },
      select: { id: true, name: true },
    });
    return { ...createdHub, created: true };
  }

  private async ensureModerator(groupId: string, userId: string): Promise<void> {
    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (existing) {
      if (
        existing.role === GroupMemberRole.MEMBER ||
        existing.status !== GroupMemberStatus.ACTIVE
      ) {
        await this.prisma.groupMember.update({
          where: { id: existing.id },
          data: { role: GroupMemberRole.MODERATOR, status: GroupMemberStatus.ACTIVE },
        });
      }
      return;
    }
    await this.prisma.groupMember.create({
      data: {
        groupId,
        userId,
        role: GroupMemberRole.MODERATOR,
        status: GroupMemberStatus.ACTIVE,
      },
    });
    await this.prisma.group.update({
      where: { id: groupId },
      data: { memberCount: { increment: 1 } },
    });
  }
}
