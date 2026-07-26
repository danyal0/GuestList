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
  if (condition === null) return value === null;
  if (typeof condition !== 'object' || condition instanceof Date || Array.isArray(condition)) {
    if (value instanceof Date && typeof condition === 'string') return value.getTime() === new Date(condition).getTime();
    if (typeof value === 'string' && condition instanceof Date) return new Date(value).getTime() === condition.getTime();
    return value === condition;
  }

  const c = condition as Record<string, unknown>;

  if ('equals' in c) return matchCondition(value, c.equals);
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

  // Nested relation filter: { is: {...} } / { some: {...} } — not fully supported;
  // treat unknown object equality as field match against nested plain values.
  return Object.entries(c).every(([k, v]) => matchCondition((value as JsonRow)?.[k], v));
}

function matchesWhere(row: JsonRow, where: Where): boolean {
  if (!where) return true;

  if (Array.isArray(where.AND)) {
    if (!where.AND.every((part) => matchesWhere(row, part as Where))) return false;
  }
  if (Array.isArray(where.OR)) {
    if (!where.OR.some((part) => matchesWhere(row, part as Where))) return false;
  }
  if (where.NOT) {
    const not = where.NOT;
    if (Array.isArray(not)) {
      if (not.some((part) => matchesWhere(row, part as Where))) return false;
    } else if (matchesWhere(row, not as Where)) {
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

    if (!matchCondition(row[key], condition)) return false;
  }
  return true;
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
      related = related.filter((r) => matchesWhere(r, (relOpts as { where?: Where }).where));
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
  'event.rsvps': { model: 'rsvp', local: 'id', foreign: 'eventId', many: true },
  'event.parentEvent': { model: 'event', local: 'parentEventId', foreign: 'id', many: false },
  'event.occurrences': { model: 'event', local: 'id', foreign: 'parentEventId', many: true },
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
  // refreshToken
  'refreshToken.user': { model: 'user', local: 'userId', foreign: 'id', many: false },
  // notification
  'notification.user': { model: 'user', local: 'userId', foreign: 'id', many: false },
};

function applyRelationFilter(relatedRows: JsonRow[], includeOpts: unknown): JsonRow[] {
  if (!includeOpts || includeOpts === true) return relatedRows;
  const opts = includeOpts as {
    where?: Where;
    orderBy?: OrderBy;
    take?: number;
  };
  let rows = relatedRows.filter((r) => matchesWhere(r, opts.where));
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

  if (args.select?._count) {
    base._count = applyCount(
      model,
      hydrated,
      (args.select._count as { select?: Record<string, unknown> }).select ??
        (args.select._count as Record<string, unknown>),
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

    related = applyRelationFilter(related, relOpts);

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

function delegate(model: string) {
  return {
    async findMany(args: Record<string, unknown> = {}) {
      let rows = fileStore
        .collection(model)
        .map((r) => fileStore.hydrate(r)!)
        .filter((r) => matchesWhere(r, args.where as Where));
      rows = sortRows(rows, args.orderBy as OrderBy);
      const skip = typeof args.skip === 'number' ? args.skip : 0;
      const take = typeof args.take === 'number' ? args.take : undefined;
      rows = rows.slice(skip, take === undefined ? undefined : skip + take);
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
        .find((r) => matchesWhere(r, effectiveWhere));
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
        .filter((r) => matchesWhere(r, args.where as Where)).length;
    },

    async create(args: Record<string, unknown> = {}) {
      const data = { ...((args.data as JsonRow) ?? {}) };
      const now = new Date().toISOString();
      if (!data.id) data.id = fileStore.newId(model);
      if (!data.createdAt) data.createdAt = now;
      if (!data.updatedAt) data.updatedAt = now;

      // Nested creates used by messaging / groups
      const participants = data.participants as { create?: unknown } | undefined;
      delete data.participants;

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
      const idx = collection.findIndex((r) => matchesWhere(fileStore.hydrate(r)!, effectiveWhere));
      if (idx < 0) notFound(model);
      const current = fileStore.hydrate(collection[idx])!;
      const data = { ...((args.data as JsonRow) ?? {}) };
      // Prisma update shorthand: { field: { set / increment } } — handle set/increment lightly
      const next: JsonRow = { ...current };
      for (const [key, value] of Object.entries(data)) {
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
      const data = { ...((args.data as JsonRow) ?? {}), updatedAt: new Date().toISOString() };
      for (let i = 0; i < collection.length; i += 1) {
        const row = fileStore.hydrate(collection[i])!;
        if (!matchesWhere(row, args.where as Where)) continue;
        collection[i] = fileStore.dehydrate({ ...row, ...data });
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
      const idx = collection.findIndex((r) => matchesWhere(fileStore.hydrate(r)!, effectiveWhere));
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
        if (matchesWhere(fileStore.hydrate(row)!, args.where as Where)) count += 1;
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
        return this.update({ where: args.where, data: args.update, include: args.include, select: args.select });
      }
      const createData = { ...((args.create as JsonRow) ?? {}), ...((args.where as JsonRow) ?? {}) };
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
    'event',
    'rsvp',
    'conversation',
    'conversationParticipant',
    'message',
    'friendship',
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
