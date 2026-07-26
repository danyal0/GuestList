import { Event } from '@prisma/client';

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Folds lines at 75 octets per RFC 5545 §3.1. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join('\r\n');
}

/** Renders an RFC 5545 iCalendar document for calendar export. */
export function eventToIcs(event: Event, url: string): string {
  const location =
    event.mode === 'ONLINE'
      ? event.onlineUrl ?? 'Online'
      : [event.locationName, event.address].filter(Boolean).join(', ') || 'TBD';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gatherly//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@gatherly.app`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(event.startTime)}`,
    `DTEND:${icsDate(event.endTime)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    `DESCRIPTION:${icsEscape(event.description.slice(0, 2000))}`,
    `LOCATION:${icsEscape(location)}`,
    `URL:${url}`,
    `STATUS:${event.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(event.recurrenceRule ? [`RRULE:${event.recurrenceRule}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join('\r\n') + '\r\n';
}
