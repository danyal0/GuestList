import {
  buildImportKey,
  extractMeetupEventId,
  findBestImportMatch,
  normalizeEventTitle,
  scoreImportDuplicate,
  startTimesClose,
  titleTokenJaccard,
} from './event-import-match';

describe('event-import-match', () => {
  it('extracts Meetup event ids from URLs', () => {
    expect(extractMeetupEventId('https://www.meetup.com/new-friends-mke/events/315741974/')).toBe(
      '315741974',
    );
    expect(extractMeetupEventId('https://meetup.com/x/events/315741974?eventId=x')).toBe(
      '315741974',
    );
  });

  it('uses Meetup id as stable import key', () => {
    const keyA = buildImportKey({
      link: 'https://www.meetup.com/group/events/315741974/',
      slug: 'group',
      title: 'Beer Garden',
      start: new Date('2026-07-31T18:30:00-05:00'),
    });
    const keyB = buildImportKey({
      link: 'https://www.meetup.com/group/events/315741974?foo=bar',
      slug: 'other',
      title: 'Different title',
      start: new Date('2026-08-01T10:00:00-05:00'),
    });
    expect(keyA).toBe('315741974');
    expect(keyB).toBe('315741974');
  });

  it('normalizes titles for comparison', () => {
    expect(normalizeEventTitle('Friday Evening Beer Garden & McKinley Pier Walk!')).toBe(
      'friday evening beer garden mckinley pier walk',
    );
  });

  it('scores similar titles highly', () => {
    const sim = titleTokenJaccard(
      'Friday Evening Beer Garden and McKinley Pier Walk',
      'Beer Garden & McKinley Pier Walk (Friday)',
    );
    expect(sim).toBeGreaterThan(0.7);
  });

  it('matches near-duplicate events by Meetup id across communities', () => {
    const score = scoreImportDuplicate(
      {
        id: 'e1',
        title: 'Board Game Night',
        startTime: new Date('2026-08-01T19:00:00-05:00'),
        groupId: 'group-a',
        description: 'Source: https://www.meetup.com/milwaukee-game-night/events/123456789/',
        whatsappMessageId: null,
      },
      {
        title: 'Board Game Night at Corner Street Bakery',
        start: new Date('2026-08-01T19:00:00-05:00'),
        link: 'https://www.meetup.com/milwaukee-game-night/events/123456789/',
        groupId: 'group-b',
        importKey: '123456789',
      },
    );
    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  it('matches fuzzy title and close start time', () => {
    const candidates = [
      {
        id: 'e2',
        title: 'Friday Evening Beer Garden and McKinley Pier Walk',
        startTime: new Date('2026-07-31T18:30:00-05:00'),
        groupId: 'g1',
        description: 'Meet at McKinley Pier',
        whatsappMessageId: null,
      },
    ];
    const match = findBestImportMatch(candidates, {
      title: 'Beer Garden & McKinley Pier Walk',
      start: new Date('2026-07-31T18:35:00-05:00'),
      groupId: 'g1',
      importKey: 'abc',
    });
    expect(match?.id).toBe('e2');
  });

  it('does not match unrelated events on the same day', () => {
    const score = scoreImportDuplicate(
      {
        id: 'e3',
        title: 'Morning Yoga in the Park',
        startTime: new Date('2026-08-01T09:00:00-05:00'),
        groupId: 'g1',
        description: '',
        whatsappMessageId: null,
      },
      {
        title: 'Evening Board Games',
        start: new Date('2026-08-01T19:00:00-05:00'),
        groupId: 'g1',
        importKey: 'xyz',
      },
    );
    expect(score).toBeLessThan(0.85);
  });

  it('treats start times within two hours as close', () => {
    const a = new Date('2026-08-01T18:30:00-05:00');
    const b = new Date('2026-08-01T19:45:00-05:00');
    expect(startTimesClose(a, b, 120)).toBe(true);
    expect(startTimesClose(a, b, 30)).toBe(false);
  });
});
