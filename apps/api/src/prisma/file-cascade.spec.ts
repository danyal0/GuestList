import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('file mode group delete cascade', () => {
  async function clientWithCopy() {
    const dbPath = path.join(os.tmpdir(), `hd-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    fs.copyFileSync(path.join(__dirname, '../../data/mock-db.json'), dbPath);
    process.env.DATA_SOURCE = 'file';
    process.env.MOCK_DB_PATH = dbPath;
    jest.resetModules();
    const { createFilePrismaClient } = await import('./file-prisma');
    return createFilePrismaClient() as {
      event: {
        findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
        count: (args?: unknown) => Promise<number>;
      };
      group: { delete: (args: unknown) => Promise<unknown> };
      groupMember: { findMany: (args?: unknown) => Promise<unknown[]>; count: (args?: unknown) => Promise<number> };
      rsvp: { count: (args?: unknown) => Promise<number> };
    };
  }

  it('cascades events and members when deleting a community', async () => {
    const prisma = await clientWithCopy();
    const withEvents = (await prisma.event.findMany({ take: 1 }))[0];
    expect(withEvents).toBeTruthy();
    const groupId = withEvents.groupId as string;
    const eventIds = (await prisma.event.findMany({ where: { groupId } })).map((e) => e.id as string);
    expect(eventIds.length).toBeGreaterThan(0);

    await prisma.group.delete({ where: { id: groupId } });

    const events = await prisma.event.findMany({
      include: {
        group: { select: { id: true, name: true, slug: true } },
        host: { select: { id: true, name: true } },
      },
    });
    expect(events.every((e) => e.group != null)).toBe(true);
    expect(events.some((e) => eventIds.includes(e.id as string))).toBe(false);
    expect(await prisma.groupMember.count({ where: { groupId } })).toBe(0);
    expect(await prisma.rsvp.count({ where: { eventId: { in: eventIds } } })).toBe(0);
  });

  it('repairs orphan events left by older non-cascade deletes on load', async () => {
    const dbPath = path.join(os.tmpdir(), `orphan-${Date.now()}.json`);
    const db = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../data/mock-db.json'), 'utf8'),
    ) as {
      groups: Array<{ id: string }>;
      events: Array<{ groupId: string }>;
    };
    const victim = db.groups.find((g) => db.events.some((e) => e.groupId === g.id));
    expect(victim).toBeTruthy();
    db.groups = db.groups.filter((g) => g.id !== victim!.id);
    fs.writeFileSync(dbPath, JSON.stringify(db));

    process.env.DATA_SOURCE = 'file';
    process.env.MOCK_DB_PATH = dbPath;
    jest.resetModules();
    const { createFilePrismaClient } = await import('./file-prisma');
    const prisma = createFilePrismaClient() as {
      event: {
        findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
      };
    };
    const events = await prisma.event.findMany({
      include: { group: true },
    });
    expect(events.every((e) => e.group != null)).toBe(true);
    expect(events.some((e) => e.groupId === victim!.id)).toBe(false);
  });
});
