#!/usr/bin/env node
/**
 * Simulate partial WhatsApp create-event messages and report Nest outcomes.
 *
 * Cases:
 *  1) time only
 *  2) time + sport (tennis / pickleball)
 *  3) sport + venue (no time)
 *  4) sport + venue + unrealistic time (outside presumed opening hours)
 *  5) incorrect sport or venue (no tennis courts / unknown place)
 *
 * Usage:
 *   WHATSAPP_BOT_TOKEN=test-secret API_URL=http://127.0.0.1:4017 \
 *     node scripts/simulate-whatsapp-partial-events.mjs
 */
const BASE = process.env.API_URL || 'http://127.0.0.1:4017';
const BOT = process.env.WHATSAPP_BOT_TOKEN || 'test-secret';
const stamp = Date.now();

let passed = 0;
let failed = 0;
const results = [];

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-whatsapp-bot-token': BOT,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function fmtLocal(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function summarizeEvent(label, input, res) {
  const event = res.json?.event ?? null;
  const summary = {
    label,
    inputMessage: input.messageBody,
    suggestedTime: input.suggestedTime ?? null,
    venueHint: input.venue ?? input.locationName ?? null,
    venueConfidence: input.venueConfidence ?? null,
    httpStatus: res.status,
    ok: res.status < 400 && Boolean(event?.id),
    eventId: event?.id ?? null,
    title: event?.title ?? null,
    startTimeUtc: event?.startTime ?? null,
    startTimeChicago: fmtLocal(event?.startTime),
    endTimeChicago: fmtLocal(event?.endTime),
    venueId: event?.venueId ?? null,
    locationName: event?.locationName ?? null,
    address: event?.address ?? null,
    latitude: event?.latitude ?? null,
    longitude: event?.longitude ?? null,
    capacity: event?.capacity ?? null,
    status: event?.status ?? null,
    error: res.status >= 400 ? res.json : null,
  };
  results.push(summary);
  return summary;
}

function printCase(summary, notes) {
  console.log(`\n### ${summary.label}`);
  console.log(`  message: ${JSON.stringify(summary.inputMessage)}`);
  if (summary.suggestedTime) console.log(`  suggestedTime: ${summary.suggestedTime}`);
  if (summary.venueHint) {
    console.log(
      `  venue hint: ${summary.venueHint}` +
        (summary.venueConfidence != null ? ` (confidence ${summary.venueConfidence})` : ''),
    );
  }
  console.log(`  HTTP ${summary.httpStatus} → created=${summary.ok}`);
  if (summary.ok) {
    console.log(`  title: ${summary.title}`);
    console.log(`  start (Chicago): ${summary.startTimeChicago}`);
    console.log(`  end   (Chicago): ${summary.endTimeChicago}`);
    console.log(`  venueId: ${summary.venueId ?? '(none)'}`);
    console.log(`  locationName: ${summary.locationName ?? '(none)'}`);
    console.log(`  address: ${summary.address ?? '(none)'}`);
    console.log(`  capacity: ${summary.capacity ?? '(unlimited/null)'}`);
  } else {
    console.log(`  error: ${JSON.stringify(summary.error)}`);
  }
  for (const note of notes) console.log(`  → ${note}`);
}

async function create(partial) {
  const body = {
    senderPhone: '4145550777',
    senderLid: '700600500400300',
    senderName: 'Sim Host',
    timezone: 'America/Chicago',
    whatsappMessageId: `false_120363partial@g.us_${stamp}_${partial.id}`,
    ...partial.payload,
  };
  const res = await req('POST', '/api/whatsapp/create-event', body);
  return summarizeEvent(partial.label, body, res);
}

async function main() {
  console.log(`Partial WhatsApp event simulation @ ${BASE}`);
  const health = await req('GET', '/api/v1/health');
  assert('api health', health.status === 200, `status=${health.status}`);

  // 1) Time only
  {
    const s = await create({
      id: 'time-only',
      label: '1) Time only',
      payload: { messageBody: '6pm' },
    });
    assert('1 created', s.ok);
    assert('1 title from message', s.title === '6pm', `title=${s.title}`);
    assert('1 no venue', !s.venueId && !s.locationName);
    assert('1 evening hour', /6:00\s*PM/i.test(s.startTimeChicago || ''), `start=${s.startTimeChicago}`);
    printCase(s, [
      'Accepted. Title is the raw message. No venue attached.',
      'Time parsed as 6:00 PM America/Chicago (today if still upcoming, else tomorrow).',
      'Capacity left null (unlimited). Duration defaults to 90 minutes.',
    ]);
  }

  // 2a) Time + tennis
  {
    const s = await create({
      id: 'tennis-time',
      label: '2a) Time + tennis',
      payload: { messageBody: 'tennis at 6pm' },
    });
    assert('2a created', s.ok);
    assert('2a title keeps sport', /tennis/i.test(s.title || ''), `title=${s.title}`);
    assert('2a no venue', !s.venueId);
    assert('2a 6pm', /6:00\s*PM/i.test(s.startTimeChicago || ''), `start=${s.startTimeChicago}`);
    printCase(s, [
      'Accepted. Sport word stays in the title only — Event has no sport column.',
      'No catalog venue matched, so location stays empty.',
      'Same 6pm schedule parsing as time-only.',
    ]);
  }

  // 2b) Time + pickleball
  {
    const s = await create({
      id: 'pickleball-time',
      label: '2b) Time + pickleball',
      payload: { messageBody: 'pickleball at 6pm' },
    });
    assert('2b created', s.ok);
    assert('2b title keeps pickleball', /pickleball/i.test(s.title || ''), `title=${s.title}`);
    assert('2b no venue', !s.venueId);
    assert('2b 6pm', /6:00\s*PM/i.test(s.startTimeChicago || ''), `start=${s.startTimeChicago}`);
    printCase(s, [
      'Accepted the same way as tennis — pickleball is not validated or stored as a sport.',
      'No rejection; word only appears in title/description.',
    ]);
  }

  // 3a) Tennis + Atwater, no time
  {
    const s = await create({
      id: 'tennis-atwater',
      label: '3a) Tennis + venue (Atwater), no time',
      payload: { messageBody: 'tennis at Atwater' },
    });
    assert('3a created', s.ok);
    assert('3a catalog venue', Boolean(s.venueId), `venueId=${s.venueId}`);
    assert('3a Atwater name', /atwater/i.test(s.locationName || ''), `loc=${s.locationName}`);
    assert('3a default capacity 12', s.capacity === 12, `capacity=${s.capacity}`);
    assert(
      '3a default tomorrow 6pm',
      /6:00\s*PM/i.test(s.startTimeChicago || ''),
      `start=${s.startTimeChicago}`,
    );
    printCase(s, [
      'Catalog match: Atwater Elementary School (tennis courts).',
      'Missing time → default tomorrow 6:00 PM America/Chicago.',
      'Capacity defaults to 12 (3 courts × 4 players).',
    ]);
  }

  // 3b) Pickleball + Atwater (tennis venue)
  {
    const s = await create({
      id: 'pickleball-atwater',
      label: '3b) Pickleball + tennis venue (Atwater)',
      payload: { messageBody: 'pickleball at Atwater' },
    });
    assert('3b created', s.ok);
    assert('3b still attaches Atwater', /atwater/i.test(s.locationName || ''), `loc=${s.locationName}`);
    assert('3b capacity from tennis courts', s.capacity === 12, `capacity=${s.capacity}`);
    printCase(s, [
      'No sport mismatch check — pickleball + Atwater still links the TENNIS catalog venue.',
      'Capacity still uses tennis court default (12).',
    ]);
  }

  // 3c) Tennis + lakefront alias
  {
    const s = await create({
      id: 'tennis-lakefront',
      label: '3c) Tennis + venue alias (lakefront)',
      payload: { messageBody: 'tennis at the lakefront' },
    });
    assert('3c created', s.ok);
    assert('3c maps to McKinley', /mckinley/i.test(s.locationName || ''), `loc=${s.locationName}`);
    assert('3c capacity 24', s.capacity === 24, `capacity=${s.capacity}`);
    printCase(s, [
      '"lakefront" alias resolves to McKinley Tennis Courts (not Lake Park).',
      'Missing time → tomorrow 6:00 PM. Capacity 24 (6×4).',
    ]);
  }

  // 4) Unrealistic time + venue
  {
    const s = await create({
      id: 'unrealistic-hours',
      label: '4) Sport + venue + unrealistic time (2am)',
      payload: {
        messageBody: 'tennis at Atwater tomorrow at 2am',
        suggestedTime: '2026-07-30T02:00:00-05:00',
        timezone: 'America/Chicago',
      },
    });
    assert('4 created', s.ok);
    assert('4 Atwater kept', /atwater/i.test(s.locationName || ''), `loc=${s.locationName}`);
    assert('4 keeps 2am', /2:00\s*AM/i.test(s.startTimeChicago || ''), `start=${s.startTimeChicago}`);
    printCase(s, [
      'Accepted — opening hours are NOT enforced (catalog/Prisma have no hours field).',
      '2:00 AM event is published with Atwater venue and capacity 12.',
    ]);
  }

  // 5a) Unknown venue, low confidence → location dropped
  {
    const s = await create({
      id: 'bad-venue-low',
      label: '5a) Incorrect venue (Fiserv Forum), low confidence',
      payload: {
        messageBody: 'tennis at Fiserv Forum at 6pm',
        locationName: 'Fiserv Forum',
        venue: 'Fiserv Forum',
        venueConfidence: 0.4,
      },
    });
    assert('5a created', s.ok);
    assert('5a no catalog venueId', !s.venueId);
    assert('5a location discarded', !s.locationName, `loc=${s.locationName}`);
    assert('5a still has time', /6:00\s*PM/i.test(s.startTimeChicago || ''), `start=${s.startTimeChicago}`);
    printCase(s, [
      'Event still created (not rejected).',
      'Unknown place + venueConfidence < 0.85 → free-form location discarded.',
      'venueId stays null; title/time remain.',
    ]);
  }

  // 5b) Unknown venue, high confidence → free-form kept
  {
    const s = await create({
      id: 'bad-venue-high',
      label: '5b) Incorrect venue (Fiserv Forum), high confidence',
      payload: {
        messageBody: 'tennis at Fiserv Forum at 6pm',
        locationName: 'Fiserv Forum',
        venue: 'Fiserv Forum',
        venueConfidence: 0.9,
      },
    });
    assert('5b created', s.ok);
    assert('5b no catalog venueId', !s.venueId);
    assert('5b free-form kept', s.locationName === 'Fiserv Forum', `loc=${s.locationName}`);
    printCase(s, [
      'Still not rejected. High venueConfidence (≥0.85) keeps free-form location name.',
      'No check that Fiserv Forum has tennis courts — venueId remains null.',
    ]);
  }

  // 5c) Wrong sport word with a real tennis park name
  {
    const s = await create({
      id: 'basketball-washington',
      label: '5c) Incorrect sport (basketball) + tennis park name',
      payload: { messageBody: 'basketball at Washington Park at 6pm' },
    });
    assert('5c created', s.ok);
    assert(
      '5c attaches Washington tennis courts',
      /washington/i.test(s.locationName || ''),
      `loc=${s.locationName}`,
    );
    assert('5c capacity from tennis catalog', s.capacity === 16, `capacity=${s.capacity}`);
    printCase(s, [
      'Sport word "basketball" is ignored for matching.',
      'Alias "washington park" maps to Washington Park Tennis Courts anyway.',
      'No sport validation — tennis capacity (16) is applied.',
    ]);
  }

  // Write machine-readable report for the agent / CI.
  const reportPath = `/tmp/whatsapp-partial-events-${stamp}.json`;
  const fs = await import('fs');
  fs.writeFileSync(reportPath, JSON.stringify({ stamp, passed, failed, results }, null, 2));
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`Report: ${reportPath}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
