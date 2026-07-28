import { Prisma } from '@prisma/client';
import { fileStore, type JsonRow } from './file-store';

type Where = Record<string, unknown> | undefined;
type OrderBy = Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>> | undefined;

function notFound(model: string): never {
  throw new Prisma.PrismaClientKnownRequestError(`No ${model} record was found.`, {
    code: 'P2025',
    clientVersion: 'file',
    meta: { modelName: model },
  });
}

function getPath(obj: JsonRow, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as JsonRow)[key];
    return undefined;
  }, obj);
}

function compareValues(a: unknown, b: unknown): number {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return String(a).localeCompare(String(b));
}

function matchCondition(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition === undefined) return true;
  if (typeof condition !== 'object' || condition instanceof Date || Array.isArray(condition)) {
    if (value instanceof Date && typeof condition === 'string') return value.getTime() === new Date(condition).getTime();
    if (typeof value === 'string' && condition instanceof Date) return new Date(value).getTime() === condition.getTime();
    return value === condition;
  }

  const c = condition as Record<string, unknown>;

  if ('equals' in c) {
    if (c.mode === 'insensitive' && typeof value === 'string' && typeof c.equals === 'string') {
      return value.toLowerCase() === c.equals.toLowerCase();
    }
    return matchCondition(value, c.equals);
  }
  if ('in' in c && Array.isArray(c.in)) return c.in.some((item) => matchCondition(value, item));
  if ('notIn' in c && Array.isArray(c.notIn)) return !c.notIn.some((item) => matchCondition(value, item));
  if ('not' in c) {
    if (typeof c.not === 'object' && c.not && !Array.isArray(c.not) && !(c.not instanceof Date)) {
      return !matchCondition(value, c.not);
    }
    return !matchCondition(value, c.not);
  }
  if ('contains' in c && typeof c.contains === 'string') {
    const hay = String(value ?? '');
    const needle = c.contains;
    return c.mode === 'insensitive'
      ? hay.toLowerCase().includes(needle.toLowerCase())
      : hay.includes(needle);
  }
  if ('startsWith' in c && typeof c.startsWith === 'string') {
    const hay = String(value ?? '');
    return c.mode === 'insensitive'
      ? hay.toLowerCase().startsWith(c.startsWith.toLowerCase())
      : hay.startsWith(c.startsWith);
  }
  if ('endsWith' in c && typeof c.endsWith === 'string') {
    const hay = String(value ?? '');
    return c.mode === 'insensitive'
      ? hay.toLowerCase().endsWith(c.endsWith.toLowerCase())
      : hay.endsWith(c.endsWith);
  }
  if ('gt' in c) return compareValues(value, c.gt) > 0;
  if ('gte' in c) return compareValues(value, c.gte) >= 0;
  if ('lt' in c) return compareValues(value, c.lt) < 0;
  if ('lte' in c) return compareValues(value, c.lte) <= 0;

  // Nested plain-object equality (non-relation).
  return Object.entries(c).every(([k, v]) => matchCondition((value as JsonRow)?.[k], v));
}

function relatedRowsFor(model: string, row: JsonRow, relName: string): JsonRow[] {
  const rel = RELATION_MAP[`${model}.${relName}`];
  if (!rel) return [];
  const localValue = row[rel.local];
  if (localValue == null) return [];
  return fileStore
    .collection(rel.model)
    .map((r) => fileStore.hydrate(r)!)
    .filter((r) => r[rel.foreign] === localValue);
}

function matchRelationFilter(model: string, row: JsonRow, relName: string, condition: unknown): boolean {
  const rel = RELATION_MAP[`${model}.${relName}`];
  if (!rel) return false;
  const related = relatedRowsFor(model, row, relName);
  if (!condition || typeof condition !== 'object') return related.length > 0;

  const c = condition as Record<string, unknown>;
  if ('some' in c) return related.some((r) => matchesWhere(rel.model, r, c.some as Where));
  if ('every' in c) return related.length > 0 && related.every((r) => matchesWhere(rel.model, r, c.every as Where));
  if ('none' in c) return !related.some((r) => matchesWhere(rel.model, r, c.none as Where));
  if ('is' in c) {
    if (c.is === null) return related[0] == null;
    return related[0] != null && matchesWhere(rel.model, related[0]!, c.is as Where);
  }
  if ('isNot' in c) {
    if (c.isNot === null) return related[0] != null;
    return related[0] == null || !matchesWhere(rel.model, related[0]!, c.isNot as Where);
  }
  // Shorthand: treat as `is` / `some` filter body.
  if (rel.many) return related.some((r) => matchesWhere(rel.model, r, c as Where));
  return related[0] != null && matchesWhere(rel.model, related[0]!, c as Where);
}

function matchesWhere(model: string, row: JsonRow, where: Where): boolean {
  if (!where) return true;

  if (Array.isArray(where.AND)) {
    if (!where.AND.every((part) => matchesWhere(model, row, part as Where))) return false;
  }
  if (Array.isArray(where.OR)) {
    if (!where.OR.some((part) => matchesWhere(model, row, part as Where))) return false;
  }
  if (where.NOT) {
    const not = where.NOT;
    if (Array.isArray(not)) {
      if (not.some((part) => matchesWhere(model, row, part as Where))) return false;
    } else if (matchesWhere(model, row, not as Where)) {
      return false;
    }
  }

  for (const [key, condition] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') continue;

    const compound = fileStore.resolveCompound({ [key]: condition });
    if (compound && key.includes('_')) {
      if (!Object.entries(compound).every(([ck, cv]) => matchCondition(row[ck], cv))) return false;
      continue;
    }

    if (RELATION_MAP[`${model}.${key}`]) {
      if (!matchRelationFilter(model, row, key, condition)) return false;
      continue;
    }

    if (!matchCondition(row[key], condition)) return false;
  }
  return true;
}

const UNIQUE_FIELDS: Record<string, string[][]> = {
  user: [['id'], ['email'], ['phone'], ['whatsappLid'], ['googleId'], ['appleId']],
  group: [['id'], ['slug']],
  groupMember: [['id'], ['groupId', 'userId']],
  follow: [['id'], ['userId', 'groupId']],
  rsvp: [['id'], ['eventId', 'userId']],
  conversationParticipant: [['id'], ['conversationId', 'userId']],
  friendship: [['id'], ['requesterId', 'addresseeId']],
  userBlock: [['id'], ['blockerId', 'blockedId']],
  refreshToken: [['id'], ['tokenHash']],
  emailToken: [['id'], ['tokenHash']],
  event: [['id'], ['whatsappMessageId']],
  venue: [['id'], ['slug']],
  conversation: [['id']],
  message: [['id']],
  notification: [['id']],
  report: [['id']],
  auditLog: [['id']],
  payment: [['id']],
  activityLog: [['id']],
};

function uniqueConflict(model: string, data: JsonRow, excludingId?: unknown): void {
  const uniques = UNIQUE_FIELDS[model] ?? [['id']];
  const collection = fileStore.collection(model);
  for (const fields of uniques) {
    if (!fields.every((f) => data[f] !== undefined && data[f] !== null)) continue;
    const hit = collection
      .map((r) => fileStore.hydrate(r)!)
      .find(
        (r) =>
          r.id !== excludingId && fields.every((f) => matchCondition(r[f], data[f])),
      );
    if (hit) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'file',
        meta: { modelName: model, target: fields },
      });
    }
  }
}

function sortRows(rows: JsonRow[], orderBy: OrderBy): JsonRow[] {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      const [field, dir] = Object.entries(clause)[0] ?? [];
      if (!field) continue;
      const cmp = compareValues(a[field], b[field]);
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function pickSelect(row: JsonRow, select: Record<string, unknown> | undefined): JsonRow {
  if (!select) return { ...row };
  const out: JsonRow = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (key === '_count') continue;
    if (enabled) out[key] = row[key];
  }
  // Legacy WhatsApp rows may omit these; callers treat them as required arrays.
  if ('interests' in out && !Array.isArray(out.interests)) out.interests = [];
  if ('skills' in out && !Array.isArray(out.skills)) out.skills = [];
  return out;
}

function applyCount(
  model: string,
  row: JsonRow,
  countSelect: Record<string, unknown> | true | undefined,
): Record<string, number> | number {
  if (!countSelect || countSelect === true) {
    // Prisma rarely uses bare _count: true on findMany rows; default 0.
    return {};
  }
  const out: Record<string, number> = {};
  for (const [relName, relOpts] of Object.entries(countSelect)) {
    const rel = RELATION_MAP[`${model}.${relName}`];
    if (!rel) {
      out[relName] = 0;
      continue;
    }
    const localValue = row[rel.local];
    let related = fileStore
      .collection(rel.model)
      .map((r) => fileStore.hydrate(r)!)
      .filter((r) => r[rel.foreign] === localValue);
    if (relOpts && typeof relOpts === 'object' && 'where' in (relOpts as object)) {
      related = related.filter((r) =>
        matchesWhere(rel.model, r, (relOpts as { where?: Where }).where),
      );
    }
    out[relName] = related.length;
  }
  return out;
}

const RELATION_MAP: Record<string, { model: string; local: string; foreign: string; many: boolean }> = {
  // user relations
  'user.refreshTokens': { model: 'refreshToken', local: 'id', foreign: 'userId', many: true },
  'user.groupMembers': { model: 'groupMember', local: 'id', foreign: 'userId', many: true },
  'user.rsvps': { model: 'rsvp', local: 'id', foreign: 'userId', many: true },
  // group
  'group.owner': { model: 'user', local: 'ownerId', foreign: 'id', many: false },
  'group.members': { model: 'groupMember', local: 'id', foreign: 'groupId', many: true },
  'group.events': { model: 'event', local: 'id', foreign: 'groupId', many: true },
  'group.follows': { model: 'follow', local: 'id', foreign: 'groupId', many: true },
  // groupMember
  'groupMember.user': { model: 'user', local: 'userId', foreign: 'id', many: false },
  'groupMember.group': { model: 'group', local: 'groupId', foreign: 'id', many: false },
  // event
  'event.group': { model: 'group', local: 'groupId', foreign: 'id', many: false },
  'event.host': { model: 'user', local: 'hostId', foreign: 'id', many: false },
  'event.venue': { model: 'venue', local: 'venueId', foreign: 'id', many: false },
  'event.rsvps': { model: 'rsvp', local: 'id', foreign: 'eventId', many: true },
  'event.parentEvent': { model: 'event', local: 'parentEventId', foreign: 'id', many: false },
  'event.occurrences': { model: 'event', local: 'id', foreign: 'parentEventId', many: true },
  'venue.events': { model: 'event', local: 'id', foreign: 'venueId', many: true },
  // rsvp
  'rsvp.user': { model: 'user', local: 'userId', foreign: 'id', many: false },
  'rsvp.event': { model: 'event', local: 'eventId', foreign: 'id', many: false },
  // follow
  'follow.user': { model: 'user', local: 'userId', foreign: 'id', many: false },
  'follow.group': { model: 'group', local: 'groupId', foreign: 'id', many: false },
  // conversation
  'conversation.participants': {
    model: 'conversationParticipant',
    local: 'id',
    foreign: 'conversationId',
    many: true,
  },
  'conversation.messages': { model: 'message', local: 'id', foreign: 'conversationId', many: true },
  'conversation.group': { model: 'group', local: 'groupId', foreign: 'id', many: false },
  // conversationParticipant
  'conversationParticipant.user': { model: 'user', local: 'userId', foreign: 'id', many: false },
  'conversationParticipant.conversation': {
    model: 'conversation',
    local: 'conversationId',
    foreign: 'id',
    many: false,
  },
  // message
  'message.sender': { model: 'user', local: 'senderId', foreign: 'id', many: false },
  'message.conversation': { model: 'conversation', local: 'conversationId', foreign: 'id', many: false },
  // friendship
  'friendship.requester': { model: 'user', local: 'requesterId', foreign: 'id', many: false },
  'friendship.addressee': { model: 'user', local: 'addresseeId', foreign: 'id', many: false },
  // userBlock
  'userBlock.blocker': { model: 'user', local: 'blockerId', foreign: 'id', many: false },
  'userBlock.blocked': { model: 'user', local: 'blockedId', foreign: 'id', many: false },
  // refreshToken
  'refreshToken.user': { model: 'user', local: 'userId', foreign: 'id', many: false },
  // notification
  'notification.user': { model: 'user', local: 'userId', foreign: 'id', many: false },
};

function applyRelationFilter(
  relatedModel: string,
  relatedRows: JsonRow[],
  includeOpts: unknown,
): JsonRow[] {
  if (!includeOpts || includeOpts === true) return relatedRows;
  const opts = includeOpts as {
    where?: Where;
    orderBy?: OrderBy;
    take?: number;
  };
  let rows = relatedRows.filter((r) => matchesWhere(relatedModel, r, opts.where));
  rows = sortRows(rows, opts.orderBy);
  if (typeof opts.take === 'number') rows = rows.slice(0, opts.take);
  return rows;
}

function shapeRow(
  model: string,
  row: JsonRow,
  args: { select?: Record<string, unknown>; include?: Record<string, unknown> } = {},
): JsonRow {
  const hydrated = fileStore.hydrate(row)!;
  let base = args.select ? pickSelect(hydrated, args.select) : { ...hydrated };

  const countArg = args.select?._count ?? args.include?._count;
  if (countArg) {
    base._count = applyCount(
      model,
      hydrated,
      (countArg as { select?: Record<string, unknown> }).select ??
        (countArg as Record<string, unknown>),
    );
  }

  const include = args.include ?? {};
  // select can also nest includes via select: { group: { select: ... } }
  const nestedFromSelect = args.select
    ? Object.fromEntries(
        Object.entries(args.select).filter(
          ([key, v]) => key !== '_count' && v && typeof v === 'object' && !Array.isArray(v),
        ),
      )
    : {};

  const relations = { ...include, ...nestedFromSelect };

  for (const [relName, relOpts] of Object.entries(relations)) {
    if (!relOpts || relName === '_count') continue;
    const key = `${model}.${relName}`;
    const rel = RELATION_MAP[key];
    if (!rel) continue;

    const localValue = row[rel.local];
    if (localValue == null && !rel.many) {
      base[relName] = null;
      continue;
    }

    const relatedCollection = fileStore.collection(rel.model);
    let related = relatedCollection
      .map((r) => fileStore.hydrate(r)!)
      .filter((r) => r[rel.foreign] === localValue);

    const nestedArgs =
      relOpts === true
        ? {}
        : (relOpts as { select?: Record<string, unknown>; include?: Record<string, unknown>; where?: Where });

    related = applyRelationFilter(rel.model, related, relOpts);

    if (rel.many) {
      base[relName] = related.map((r) => shapeRow(rel.model, r, nestedArgs));
    } else {
      const one = related[0] ?? null;
      base[relName] = one ? shapeRow(rel.model, one, nestedArgs) : null;
    }
  }

  // When using select with nested objects, strip non-selected scalars already handled;
  // ensure relation keys requested via select object form are kept.
  if (args.select) {
    const selected: JsonRow = {};
    for (const [key, enabled] of Object.entries(args.select)) {
      if (!enabled) continue;
      selected[key] = base[key];
    }
    return selected;
  }

  return base;
}

function createNested(
  model: string,
  parentId: string,
  parentField: string,
  createArg: unknown,
): void {
  if (!createArg) return;
  const items = Array.isArray(createArg) ? createArg : [createArg];
  const collection = fileStore.collection(model);
  const now = new Date().toISOString();
  for (const item of items) {
    const data = { ...(item as JsonRow) };
    data[parentField] = parentId;
    if (!data.id) data.id = fileStore.newId(model);
    if (!data.createdAt) data.createdAt = now;
    if (!data.updatedAt) data.updatedAt = now;
    if (model === 'groupMember' && !data.joinedAt) data.joinedAt = now;
    if (model === 'conversationParticipant' && !data.joinedAt) data.joinedAt = now;
    if (model === 'groupMember' && !data.status) data.status = 'ACTIVE';
    collection.push(fileStore.dehydrate(data));
  }
}

function flattenWhereForCreate(where: Record<string, unknown>): JsonRow {
  const compound = fileStore.resolveCompound(where);
  if (compound) return { ...compound };
  const out: JsonRow = {};
  for (const [key, value] of Object.entries(where)) {
    if (key.includes('_') && value && typeof value === 'object' && !(value instanceof Date)) continue;
    out[key] = value;
  }
  return out;
}

function delegate(model: string) {
  return {
    async findMany(args: Record<string, unknown> = {}) {
      let rows = fileStore
        .collection(model)
        .map((r) => fileStore.hydrate(r)!)
        .filter((r) => matchesWhere(model, r, args.where as Where));
      rows = sortRows(rows, args.orderBy as OrderBy);

      // Cursor pagination (messaging): skip the cursor row itself when skip: 1.
      if (args.cursor && typeof args.cursor === 'object') {
        const cursor = args.cursor as Record<string, unknown>;
        const idx = rows.findIndex((r) =>
          Object.entries(cursor).every(([k, v]) => matchCondition(r[k], v)),
        );
        if (idx >= 0) {
          const skipCursor = typeof args.skip === 'number' ? args.skip : 0;
          rows = rows.slice(idx + skipCursor);
        }
      } else {
        const skip = typeof args.skip === 'number' ? args.skip : 0;
        rows = rows.slice(skip);
      }

      const take = typeof args.take === 'number' ? args.take : undefined;
      if (take !== undefined) rows = rows.slice(0, take);

      return rows.map((r) =>
        shapeRow(model, r, {
          select: args.select as Record<string, unknown> | undefined,
          include: args.include as Record<string, unknown> | undefined,
        }),
      );
    },

    async findFirst(args: Record<string, unknown> = {}) {
      const rows = await this.findMany({ ...args, take: 1 });
      return rows[0] ?? null;
    },

    async findFirstOrThrow(args: Record<string, unknown> = {}) {
      const row = await this.findFirst(args);
      if (!row) notFound(model);
      return row;
    },

    async findUnique(args: Record<string, unknown> = {}) {
      const where = { ...(args.where as Record<string, unknown>) };
      const compound = fileStore.resolveCompound(where);
      const effectiveWhere = compound ?? where;
      const row = fileStore
        .collection(model)
        .map((r) => fileStore.hydrate(r)!)
        .find((r) => matchesWhere(model, r, effectiveWhere));
      if (!row) return null;
      return shapeRow(model, row, {
        select: args.select as Record<string, unknown> | undefined,
        include: args.include as Record<string, unknown> | undefined,
      });
    },

    async findUniqueOrThrow(args: Record<string, unknown> = {}) {
      const row = await this.findUnique(args);
      if (!row) notFound(model);
      return row;
    },

    async count(args: Record<string, unknown> = {}) {
      return fileStore
        .collection(model)
        .map((r) => fileStore.hydrate(r)!)
        .filter((r) => matchesWhere(model, r, args.where as Where)).length;
    },

    async groupBy(args: Record<string, unknown> = {}) {
      const by = (args.by as string[]) ?? [];
      const rows = fileStore
        .collection(model)
        .map((r) => fileStore.hydrate(r)!)
        .filter((r) => matchesWhere(model, r, args.where as Where));
      const buckets = new Map<string, { key: JsonRow; rows: JsonRow[] }>();
      for (const row of rows) {
        const key: JsonRow = {};
        for (const field of by) key[field] = row[field];
        const sig = JSON.stringify(key);
        const bucket = buckets.get(sig) ?? { key, rows: [] };
        bucket.rows.push(row);
        buckets.set(sig, bucket);
      }
      return [...buckets.values()].map(({ key, rows: groupRows }) => {
        const out: JsonRow = { ...key };
        if (args._count === true) out._count = groupRows.length;
        else if (args._count && typeof args._count === 'object') {
          out._count = Object.fromEntries(
            Object.keys(args._count as object).map((k) => [k, groupRows.length]),
          );
        }
        return out;
      });
    },

    async create(args: Record<string, unknown> = {}) {
      const data = { ...((args.data as JsonRow) ?? {}) };
      const now = new Date().toISOString();
      if (!data.id) data.id = fileStore.newId(model);
      if (!data.createdAt) data.createdAt = now;
      if (!data.updatedAt) data.updatedAt = now;
      if (model === 'groupMember' && !data.status) data.status = 'ACTIVE';
      if (model === 'groupMember' && !data.joinedAt) data.joinedAt = now;
      if (model === 'groupMember' && !data.role) data.role = 'MEMBER';
      if (model === 'conversationParticipant' && !data.joinedAt) data.joinedAt = now;
      if (model === 'notification' && data.read === undefined) data.read = false;
      if (model === 'rsvp' && !data.status) data.status = 'GOING';
      if (model === 'event' && data.capacity === undefined) data.capacity = null;
      if (model === 'event' && data.allowWaitlist === undefined) data.allowWaitlist = true;
      if (model === 'user') {
        if (data.interests === undefined) data.interests = [];
        if (data.skills === undefined) data.skills = [];
        if (data.role === undefined) data.role = 'USER';
      }
      // Mirror Prisma @default on Group — production often runs DATA_SOURCE=file.
      if (model === 'group') {
        if (data.memberCount === undefined) data.memberCount = 1;
        if (data.isVerified === undefined) data.isVerified = false;
        if (data.privacy === undefined) data.privacy = 'PUBLIC';
      }
      // Nested creates used by messaging / groups
      const participants = data.participants as { create?: unknown } | undefined;
      delete data.participants;

      uniqueConflict(model, data);

      const collection = fileStore.collection(model);
      collection.push(fileStore.dehydrate(data));

      if (participants?.create) {
        createNested('conversationParticipant', String(data.id), 'conversationId', participants.create);
      }

      fileStore.persist();
      return this.findUnique({
        where: { id: data.id },
        include: args.include,
        select: args.select,
      });
    },

    async createMany(args: Record<string, unknown> = {}) {
      const rows = (args.data as JsonRow[]) ?? [];
      const now = new Date().toISOString();
      const collection = fileStore.collection(model);
      for (const row of rows) {
        const data = { ...row };
        if (!data.id) data.id = fileStore.newId(model);
        if (!data.createdAt) data.createdAt = now;
        if (!data.updatedAt) data.updatedAt = now;
        if (!args.skipDuplicates) uniqueConflict(model, data);
        else {
          try {
            uniqueConflict(model, data);
          } catch {
            continue;
          }
        }
        collection.push(fileStore.dehydrate(data));
      }
      fileStore.persist();
      return { count: rows.length };
    },

    async update(args: Record<string, unknown> = {}) {
      const where = args.where as Record<string, unknown>;
      const compound = fileStore.resolveCompound(where);
      const effectiveWhere = compound ?? where;
      const collection = fileStore.collection(model);
      const idx = collection.findIndex((r) =>
        matchesWhere(model, fileStore.hydrate(r)!, effectiveWhere),
      );
      if (idx < 0) notFound(model);
      const current = fileStore.hydrate(collection[idx])!;
      const data = { ...((args.data as JsonRow) ?? {}) };
      // Prisma update shorthand: { field: { set / increment } } — handle set/increment lightly
      const next: JsonRow = { ...current };
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue; // Nest DTOs often spread undefined fields
        if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
          const op = value as Record<string, unknown>;
          if ('set' in op) next[key] = op.set;
          else if ('increment' in op) next[key] = Number(next[key] ?? 0) + Number(op.increment);
          else if ('decrement' in op) next[key] = Number(next[key] ?? 0) - Number(op.decrement);
          else next[key] = value;
        } else {
          next[key] = value;
        }
      }
      next.updatedAt = new Date().toISOString();
      uniqueConflict(model, next, next.id);
      collection[idx] = fileStore.dehydrate(next);
      fileStore.persist();
      return this.findUnique({
        where: { id: next.id },
        include: args.include,
        select: args.select,
      });
    },

    async updateMany(args: Record<string, unknown> = {}) {
      const collection = fileStore.collection(model);
      let count = 0;
      const patch = { ...((args.data as JsonRow) ?? {}) };
      for (let i = 0; i < collection.length; i += 1) {
        const row = fileStore.hydrate(collection[i])!;
        if (!matchesWhere(model, row, args.where as Where)) continue;
        const next: JsonRow = { ...row };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
            const op = value as Record<string, unknown>;
            if ('set' in op) next[key] = op.set;
            else if ('increment' in op) next[key] = Number(next[key] ?? 0) + Number(op.increment);
            else if ('decrement' in op) next[key] = Number(next[key] ?? 0) - Number(op.decrement);
            else next[key] = value;
          } else {
            next[key] = value;
          }
        }
        next.updatedAt = new Date().toISOString();
        collection[i] = fileStore.dehydrate(next);
        count += 1;
      }
      if (count) fileStore.persist();
      return { count };
    },

    async delete(args: Record<string, unknown> = {}) {
      const where = args.where as Record<string, unknown>;
      const compound = fileStore.resolveCompound(where);
      const effectiveWhere = compound ?? where;
      const collection = fileStore.collection(model);
      const idx = collection.findIndex((r) =>
        matchesWhere(model, fileStore.hydrate(r)!, effectiveWhere),
      );
      if (idx < 0) notFound(model);
      const [removed] = collection.splice(idx, 1);
      fileStore.persist();
      return fileStore.hydrate(removed);
    },

    async deleteMany(args: Record<string, unknown> = {}) {
      const collection = fileStore.collection(model);
      const keep: JsonRow[] = [];
      let count = 0;
      for (const row of collection) {
        if (matchesWhere(model, fileStore.hydrate(row)!, args.where as Where)) count += 1;
        else keep.push(row);
      }
      collection.length = 0;
      collection.push(...keep);
      if (count) fileStore.persist();
      return { count };
    },

    async upsert(args: Record<string, unknown> = {}) {
      const existing = await this.findUnique({ where: args.where });
      if (existing) {
        return this.update({
          where: args.where,
          data: args.update,
          include: args.include,
          select: args.select,
        });
      }
      const createData = {
        ...flattenWhereForCreate((args.where as Record<string, unknown>) ?? {}),
        ...((args.create as JsonRow) ?? {}),
      };
      return this.create({ data: createData, include: args.include, select: args.select });
    },
  };
}

export function createFilePrismaClient() {
  fileStore.load();

  const models = [
    'user',
    'refreshToken',
    'emailToken',
    'group',
    'groupMember',
    'follow',
    'venue',
    'event',
    'rsvp',
    'conversation',
    'conversationParticipant',
    'message',
    'friendship',
    'userBlock',
    'notification',
    'report',
    'auditLog',
    'payment',
    'activityLog',
  ] as const;

  const client: Record<string, unknown> = {
    async $connect() {
      /* no-op */
    },
    async $disconnect() {
      /* no-op */
    },
    async $queryRaw(query: unknown) {
      const text =
        query && typeof query === 'object' && 'strings' in (query as object)
          ? ((query as { strings: string[] }).strings ?? []).join(' ')
          : String(query ?? '');
      if (/select\s+1/i.test(text)) return [{ ok: 1 }];
      // Analytics / FTS are Postgres-specific — return empty in file mode.
      return [];
    },
    async $executeRaw() {
      return 0;
    },
    async $transaction(arg: unknown, _opts?: unknown) {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => unknown)(client);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg;
    },
  };

  for (const model of models) {
    client[model] = delegate(model);
  }

  // Suppress unused warning for getPath helper reserved for nested where.
  void getPath;

  return client;
}
