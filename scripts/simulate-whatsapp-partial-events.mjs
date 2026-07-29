#!/usr/bin/env node
/**
 * Partial WhatsApp create-event outcomes AFTER intelligent validation.
 * Incomplete / unrealistic / wrong-sport invites are rejected (422).
 * Valid tennis + known court invites are created.
 */
const BASE = process.env.API_URL || 'http://127.0.0.1:4017';
const BOT = process.env.WHATSAPP_BOT_TOKEN || 'test-secret';
const stamp = Date.now();

let passed = 0;
let failed = 0;

async function create(id, payload) {
  const res = await fetch(`${BASE}/api/whatsapp/create-event`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-whatsapp-bot-token': BOT,
    },
    body: JSON.stringify({
      senderPhone: '4145550777',
      senderLid: '700600500400300',
      senderName: 'Sim Host',
      timezone: 'America/Chicago',
      whatsappMessageId: `false_120363partial@g.us_${stamp}_${id}`,
      ...payload,
    }),
  });
  const json = await res.json().catch(() => null);
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

function line(label, res) {
  console.log(
    `\n### ${label}\n  HTTP ${res.status} code=${res.json?.code ?? 'ok'} ` +
      (res.status < 400
        ? `venue=${res.json?.event?.locationName}`
        : `msg=${res.json?.message}`),
  );
}

async function main() {
  console.log(`Partial events (with validation) @ ${BASE}`);
  assert('health', (await fetch(`${BASE}/api/v1/health`)).ok);

  let res = await create('time-only', { messageBody: '6pm' });
  line('1) time only → reject', res);
  assert('1 reject', res.status === 422 && res.json?.code === 'INCOMPLETE');

  res = await create('tennis-time', { messageBody: 'tennis at 6pm' });
  line('2) tennis + time → reject', res);
  assert('2 reject', res.status === 422 && res.json?.code === 'MISSING_VENUE');

  res = await create('tennis-atwater', { messageBody: 'tennis at Atwater' });
  line('3) tennis + Atwater → accept (default time)', res);
  assert('3 accept', res.status < 400 && /atwater/i.test(res.json?.event?.locationName || ''));

  res = await create('two-am', {
    messageBody: 'tennis at Atwater tomorrow at 2am',
    suggestedTime: '2026-07-30T02:00:00-05:00',
  });
  line('4) 2am at Atwater → reject', res);
  assert('4 reject', res.status === 422 && res.json?.code === 'OUTSIDE_HOURS');

  res = await create('fiserv', {
    messageBody: 'tennis at Fiserv Forum at 6pm',
    locationName: 'Fiserv Forum',
    venue: 'Fiserv Forum',
    venueConfidence: 0.9,
  });
  line('5) Fiserv Forum → reject', res);
  assert('5 reject', res.status === 422 && res.json?.code === 'UNKNOWN_VENUE');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
