#!/usr/bin/env node
/**
 * Live simulation: WhatsApp bot payloads → Nest /api/whatsapp/* → signup claim.
 *
 * Scenario 1: name-only WA attendee → group message saves LID/name/phone → signup links
 * Scenario 2: signup first → later WA message attaches LID without clobbering phone/name
 *
 * Usage:
 *   WHATSAPP_BOT_TOKEN=test-secret API_URL=http://127.0.0.1:4017 \
 *     node scripts/simulate-whatsapp-signup-link.mjs
 */
const BASE = process.env.API_URL || 'http://127.0.0.1:4017';
const BOT = process.env.WHATSAPP_BOT_TOKEN || 'test-secret';

let passed = 0;
let failed = 0;

async function req(method, path, { token, body, bot } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (bot) headers['x-whatsapp-bot-token'] = bot;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
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

async function scenario1() {
  console.log('\nScenario 1: WhatsApp name-first → LID/phone → signup claim');
  const n = Date.now();
  const stamp = String(n);
  const msgId = `false_120363test@g.us_S1_${stamp}`;
  // Stable unique 15-digit LID and valid US 10-digit phone per run.
  const lid = `17370${String(n).slice(-10)}`.slice(0, 15);
  const phone10 = `414${String(n).slice(-7)}`.slice(0, 10);

  // Host creates event and names an attendee (name-only placeholder).
  const create = await req('POST', '/api/whatsapp/create-event', {
    bot: BOT,
    body: {
      senderPhone: '4145550999',
      senderLid: '999000111222333',
      senderJid: '999000111222333@lid',
      senderName: 'Host Danyal',
      messageBody: `Tennis tomorrow — SimUser${stamp} is also going`,
      whatsappMessageId: msgId,
      namedAttendees: [`SimUser${stamp}`],
      suggestedTime: '2026-07-30T18:00:00-05:00',
      timezone: 'America/Chicago',
      title: `Sim tennis ${stamp}`,
    },
  });
  assert('create-event ok', create.status < 400 && create.json?.ok !== false, `status=${create.status} body=${JSON.stringify(create.json)}`);
  const eventId = create.json?.event?.id;

  // Named attendee messages in the group (RSVP) with LID + exact name + phone.
  const rsvp = await req('POST', '/api/whatsapp/rsvp', {
    bot: BOT,
    body: {
      whatsappMessageId: msgId,
      reactorLid: lid,
      reactorJid: `${lid}@lid`,
      reactorName: `SimUser${stamp} Exact`,
      reactorPhone: phone10,
      status: 'attending',
      confidence: 0.95,
    },
  });
  assert('rsvp attaches identity', rsvp.status < 400, `status=${rsvp.status} body=${JSON.stringify(rsvp.json)}`);
  assert('rsvp user is named attendee', Boolean(rsvp.json?.rsvp?.userId), `body=${JSON.stringify(rsvp.json)}`);

  // Signup with same phone — expect link suggestion, then claim.
  const signup = await req('POST', '/api/v1/auth/signup', {
    body: {
      name: `SimUser${stamp} Exact`,
      phone: `1${phone10}`,
      password: 'Str0ngPassw0rd!',
    },
  });
  assert('signup ok', signup.status === 201 || signup.status === 200, `status=${signup.status} body=${JSON.stringify(signup.json)}`);
  const suggestions = signup.json?.linkSuggestions || [];
  assert('signup offers WhatsApp link', suggestions.length > 0, JSON.stringify(suggestions));
  const token = signup.json?.accessToken;
  const placeholderId = suggestions[0]?.userId;
  assert('has claim target', Boolean(placeholderId && token));

  if (token && placeholderId) {
    const claim = await req('POST', '/api/v1/auth/claim-named-profile', {
      token,
      body: { placeholderUserId: placeholderId },
    });
    assert('claim links LID', claim.status < 400 && claim.json?.user?.whatsappLid === lid, `status=${claim.status} body=${JSON.stringify(claim.json)}`);
    assert('claim keeps signup phone', claim.json?.user?.phone === `1${phone10}`, `phone=${claim.json?.user?.phone}`);
  }

  if (eventId) {
    assert('event created', true);
  }
}

async function scenario2() {
  console.log('\nScenario 2: signup-first → WhatsApp message attaches LID');
  const n = Date.now() + 17;
  const stamp = String(n);
  const phone10 = `415${String(n).slice(-7)}`.slice(0, 10);
  const lid = `15556${String(n).slice(-10)}`.slice(0, 15);
  const msgId = `false_120363test@g.us_S2_${stamp}`;

  const signup = await req('POST', '/api/v1/auth/signup', {
    body: {
      name: `Sam${stamp}`,
      phone: `1${phone10}`,
      password: 'Str0ngPassw0rd!',
    },
  });
  assert('signup first', signup.status === 201 || signup.status === 200, `status=${signup.status} body=${JSON.stringify(signup.json)}`);
  const userId = signup.json?.user?.id;
  const signupPhone = signup.json?.user?.phone;
  const signupName = signup.json?.user?.name;
  const token = signup.json?.accessToken;

  // Need an event to RSVP against — create via another WA host.
  const create = await req('POST', '/api/whatsapp/create-event', {
    bot: BOT,
    body: {
      senderPhone: '4145550888',
      senderLid: '888777666555444',
      senderName: 'Other Host',
      messageBody: `Pickup tennis ${stamp}`,
      whatsappMessageId: msgId,
      suggestedTime: '2026-07-31T18:00:00-05:00',
      timezone: 'America/Chicago',
      title: `Sim pickup ${stamp}`,
    },
  });
  assert('host event for RSVP', create.status < 400, `status=${create.status} body=${JSON.stringify(create.json)}`);

  // Signup user messages in group — phone matches, LID should attach; name/phone preserved.
  const rsvp = await req('POST', '/api/whatsapp/rsvp', {
    bot: BOT,
    body: {
      whatsappMessageId: msgId,
      reactorLid: lid,
      reactorJid: `${lid}@lid`,
      reactorPhone: phone10,
      reactorName: `WA Name Should Not Win ${stamp}`,
      status: 'attending',
      confidence: 0.9,
    },
  });
  assert('wa rsvp ok', rsvp.status < 400, `status=${rsvp.status} body=${JSON.stringify(rsvp.json)}`);
  assert('rsvp reused signup user', rsvp.json?.rsvp?.userId === userId, `got=${rsvp.json?.rsvp?.userId} expected=${userId}`);

  const me = await req('GET', '/api/v1/auth/me', { token });
  assert('auth/me ok', me.status < 400, `status=${me.status} body=${JSON.stringify(me.json)}`);
  const profile = me.json?.user ?? me.json;

  assert('same user id', profile?.id === userId, `got=${profile?.id}`);
  assert('LID attached', profile?.whatsappLid === lid, `got=${profile?.whatsappLid}`);
  assert('phone unchanged', profile?.phone === signupPhone, `got=${profile?.phone} expected=${signupPhone}`);
  assert('name unchanged', profile?.name === signupName, `got=${profile?.name} expected=${signupName}`);
}

async function main() {
  console.log(`Simulating WhatsApp ↔ signup link at ${BASE}`);
  const health = await req('GET', '/api/v1/health');
  assert('api health', health.status === 200, `status=${health.status}`);

  await scenario1();
  await scenario2();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
