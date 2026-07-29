import { createHash } from 'crypto';
import { EventImportService } from './event-import.service';

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
    const key = createHash('sha1').update('https://meetup.com/x/events/1').digest('hex').slice(0, 16);
    expect(key).toHaveLength(16);
  });
});
