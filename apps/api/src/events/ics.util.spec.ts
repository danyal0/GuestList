import { Event, EventMode, EventStatus, EventVisibility } from '@prisma/client';
import { eventToIcs } from './ics.util';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt_1',
    groupId: 'grp_1',
    hostId: 'usr_1',
    parentEventId: null,
    title: 'Sunrise Hike',
    description: 'Meet at the trailhead; bring water.',
    coverImage: null,
    mode: EventMode.IN_PERSON,
    locationName: 'Lands End',
    address: '680 Point Lobos Ave',
    latitude: null,
    longitude: null,
    onlineUrl: null,
    timezone: 'America/Los_Angeles',
    startTime: new Date('2030-05-01T14:00:00.000Z'),
    endTime: new Date('2030-05-01T16:00:00.000Z'),
    capacity: null,
    allowWaitlist: true,
    rsvpDeadline: null,
    recurrenceRule: null,
    status: EventStatus.PUBLISHED,
    visibility: EventVisibility.PUBLIC,
    remindersSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Event;
}

describe('eventToIcs', () => {
  it('renders a valid VCALENDAR wrapper with CRLF line endings', () => {
    const ics = eventToIcs(makeEvent(), 'https://mkeplays.app/events/evt_1');
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('\r\n');
  });

  it('formats DTSTART/DTEND as UTC basic format', () => {
    const ics = eventToIcs(makeEvent(), 'https://x');
    expect(ics).toContain('DTSTART:20300501T140000Z');
    expect(ics).toContain('DTEND:20300501T160000Z');
  });

  it('escapes commas, semicolons and newlines in text fields', () => {
    const ics = eventToIcs(
      makeEvent({ title: 'Wine, cheese; fun', description: 'Line1\nLine2' }),
      'https://x',
    );
    expect(ics).toContain('SUMMARY:Wine\\, cheese\\; fun');
    expect(ics).toContain('DESCRIPTION:Line1\\nLine2');
  });

  it('uses the online URL as location for online events', () => {
    const ics = eventToIcs(
      makeEvent({ mode: EventMode.ONLINE, onlineUrl: 'https://meet.example.com/room' }),
      'https://x',
    );
    expect(ics).toContain('LOCATION:https://meet.example.com/room');
  });

  it('marks cancelled events with STATUS:CANCELLED', () => {
    const ics = eventToIcs(makeEvent({ status: EventStatus.CANCELLED }), 'https://x');
    expect(ics).toContain('STATUS:CANCELLED');
  });

  it('includes RRULE for recurring events', () => {
    const ics = eventToIcs(makeEvent({ recurrenceRule: 'FREQ=WEEKLY;COUNT=8' }), 'https://x');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;COUNT=8');
  });

  it('folds lines longer than 75 octets per RFC 5545', () => {
    const ics = eventToIcs(makeEvent({ description: 'x'.repeat(400) }), 'https://x');
    for (const line of ics.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });
});
