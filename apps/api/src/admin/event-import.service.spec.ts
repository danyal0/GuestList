import { EventImportService } from './event-import.service';
import { buildImportKey } from './event-import-match';

describe('EventImportService parsing', () => {
  const service = new EventImportService({} as never, { log: jest.fn() } as never);

  it('parses Meetup-style JSON', () => {
    const rows = service.parseUpload(
      Buffer.from(
        JSON.stringify([
          {
            Name: 'Friday Evening Beer Garden and McKinley Pier Walk',
            'Date and Time': 'Fri, Jul 31 · 6:30 PM CDT',
            Group: 'Fri, Jul 31 · 6:30 PM CDT',
            Attendees: '70',
            Link: 'https://www.meetup.com/new-friends-mke/events/315741974/',
          },
        ]),
      ),
      'events.json',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toContain('McKinley');
    expect(rows[0].link).toContain('new-friends-mke');
  });

  it('parses CSV with flexible headers', () => {
    const csv = `title,start,community,location
Board Game Night,"Sat, Aug 1 · 7:00 PM CDT",Milwaukee Game Night,Corner Street Bakery
`;
    const rows = service.parseUpload(Buffer.from(csv), 'events.csv');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Board Game Night');
    expect(rows[0].group).toBe('Milwaukee Game Night');
    expect(rows[0].location).toBe('Corner Street Bakery');
  });

  it('parses JSON wrapped in a data property', () => {
    const rows = service.parseUpload(
      Buffer.from(JSON.stringify({ data: [{ name: 'Milwaukee Hike', link: 'https://meetup.com/mke-hikers/events/1/' }] })),
      'events.json',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Milwaukee Hike');
  });

  it('reports importedEvents as created plus updated', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'host1' }) },
      group: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'g1', name: 'Hub' }),
        update: jest.fn(),
      },
      groupMember: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      event: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'e1' }),
        update: jest.fn(),
      },
    };
    const importSvc = new EventImportService(prisma as never, { log: jest.fn() } as never);
    const result = await importSvc.importRows('admin1', [
      {
        name: 'Fresh Milwaukee Meetup',
        dateTime: 'Fri, Jul 31 · 6:30 PM CDT',
        link: 'https://www.meetup.com/new-friends-mke/events/999999001/',
      },
    ]);
    expect(result.createdEvents).toBe(1);
    expect(result.importedEvents).toBe(1);
  });
});
