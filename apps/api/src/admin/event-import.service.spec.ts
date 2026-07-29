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

  it('builds stable import keys', () => {
    const key = buildImportKey({
      link: 'https://meetup.com/x/events/123456789',
      slug: 'x',
      title: 'Event',
      start: new Date('2026-07-31T18:30:00-05:00'),
    });
    expect(key).toBe('123456789');
  });
});
