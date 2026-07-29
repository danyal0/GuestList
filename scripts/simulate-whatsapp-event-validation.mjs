#!/usr/bin/env node
/**
 * Live checks for intelligent WhatsApp create-event validation.
 *
 * Expects rejections for incomplete / bad invites and acceptance for
 * tennis + known court (± sensible time).
 */
const BASE = process.env.API_URL || 'http://127.0.0.1:4017';
const BOT = process.env.WHATSAPP_BOT_TOKEN || 'test-secret';
const stamp = Date.now();

let passed = 0;
let failed = 0;

async function req(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-whatsapp-bot-token': BOT,
    },
    body: JSON.stringify(body),
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

async function create(id, payload) {
  return req('/api/whatsapp/create-event', {
    senderPhone: '4145550666',
    senderLid: '600500400300200',
    senderName: 'Validation Host',
    timezone: 'America/Chicago',
    whatsappMessageId: `false_120363validate@g.us_${stamp}_${id}`,
    ...payload,
  });
}

function print(label, res) {
  const code = res.json?.code || res.json?.message || res.json?.error;
  console.log(
    `\n### ${label}\n  HTTP ${res.status}` +
      (res.status < 400
        ? ` created id=${res.json?.event?.id} venue=${res.json?.event?.locationName}`
        : ` code=${res.json?.code ?? '?'} msg=${res.json?.message ?? JSON.stringify(code)}`),
  );
}

async function main() {
  console.log(`WhatsApp create validation @ ${BASE}`);
  const health = await fetch(`${BASE}/api/v1/health`);
  assert('api up', health.status === 200);

  // 1 time only → reject
  {
    const res = await create('time-only', { messageBody: '6pm' });
    print('1) time only', res);
    assert('1 status 422', res.status === 422, `status=${res.status}`);
    assert('1 code INCOMPLETE', res.json?.code === 'INCOMPLETE', `code=${res.json?.code}`);
  }

  // 2 tennis + time, no venue → reject
  {
    const res = await create('tennis-time', { messageBody: 'tennis at 6pm' });
    print('2) tennis + time, no venue', res);
    assert('2 status 422', res.status === 422, `status=${res.status}`);
    assert('2 code MISSING_VENUE', res.json?.code === 'MISSING_VENUE', `code=${res.json?.code}`);
  }

  // 2b pickleball + time, no venue → still need a court (sport itself is fine)
  {
    const res = await create('pickle-time', { messageBody: 'pickleball at 6pm' });
    print('2b) pickleball + time, no venue', res);
    assert('2b rejected', res.status === 422, `status=${res.status}`);
    assert('2b MISSING_VENUE', res.json?.code === 'MISSING_VENUE', `code=${res.json?.code}`);
  }

  // 3 tennis + Atwater → accept
  {
    const res = await create('tennis-atwater', { messageBody: 'tennis at Atwater tomorrow at 6pm' });
    print('3) tennis + Atwater + 6pm', res);
    assert('3 created', res.status < 400 && res.json?.event?.id, `status=${res.status}`);
    assert(
      '3 Atwater',
      /atwater/i.test(res.json?.event?.locationName || ''),
      `loc=${res.json?.event?.locationName}`,
    );
  }

  // 3b pickleball + Atwater → accept (court-compatible)
  {
    const res = await create('pickle-atwater', {
      messageBody: 'pickleball at Atwater tomorrow at 6pm',
    });
    print('3b) pickleball + Atwater + 6pm', res);
    assert('3b created', res.status < 400 && res.json?.event?.id, `status=${res.status}`);
  }

  // 4 unrealistic hours → reject
  {
    const res = await create('two-am', {
      messageBody: 'tennis at Atwater tomorrow at 2am',
      suggestedTime: '2026-07-30T02:00:00-05:00',
    });
    print('4) tennis + Atwater + 2am', res);
    assert('4 status 422', res.status === 422, `status=${res.status}`);
    assert('4 code OUTSIDE_HOURS', res.json?.code === 'OUTSIDE_HOURS', `code=${res.json?.code}`);
  }

  // 5a Fiserv low confidence → reject
  {
    const res = await create('fiserv-low', {
      messageBody: 'tennis at Fiserv Forum at 6pm',
      locationName: 'Fiserv Forum',
      venue: 'Fiserv Forum',
      venueConfidence: 0.4,
    });
    print('5a) Fiserv low confidence', res);
    assert('5a rejected', res.status === 422, `status=${res.status}`);
    assert(
      '5a unknown/incomplete',
      res.json?.code === 'UNKNOWN_VENUE' || res.json?.code === 'MISSING_VENUE' || res.json?.code === 'INCOMPLETE',
      `code=${res.json?.code}`,
    );
  }

  // 5b Fiserv high confidence → still reject (no catalog courts)
  {
    const res = await create('fiserv-high', {
      messageBody: 'tennis at Fiserv Forum at 6pm',
      locationName: 'Fiserv Forum',
      venue: 'Fiserv Forum',
      venueConfidence: 0.9,
    });
    print('5b) Fiserv high confidence', res);
    assert('5b rejected', res.status === 422, `status=${res.status}`);
    assert('5b UNKNOWN_VENUE', res.json?.code === 'UNKNOWN_VENUE', `code=${res.json?.code}`);
  }

  // 5c basketball at Washington Park → accept (court sport)
  {
    const res = await create('bball-wash', {
      messageBody: 'basketball at Washington Park at 6pm',
    });
    print('5c) basketball at Washington Park', res);
    assert('5c created', res.status < 400 && res.json?.event?.id, `status=${res.status}`);
  }

  // 5d swimming at Atwater courts → reject mismatch
  {
    const res = await create('swim-atwater', {
      messageBody: 'swimming at Atwater at 6pm',
    });
    print('5d) swimming at Atwater courts', res);
    assert('5d rejected', res.status === 422, `status=${res.status}`);
    assert(
      '5d SPORT_VENUE_MISMATCH',
      res.json?.code === 'SPORT_VENUE_MISMATCH',
      `code=${res.json?.code}`,
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
