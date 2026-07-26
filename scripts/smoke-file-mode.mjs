#!/usr/bin/env node
/**
 * End-to-end smoke test for DATA_SOURCE=file against a running API.
 * Usage: API_URL=http://127.0.0.1:4015 node scripts/smoke-file-mode.mjs
 */
const BASE = process.env.API_URL || 'http://127.0.0.1:4015';

let passed = 0;
let failed = 0;

async function req(method, path, { token, body, cookie } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
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
  return { status: res.status, json, headers: res.headers };
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

async function login(email) {
  const res = await req('POST', '/api/v1/auth/login', {
    body: { email, password: 'Passw0rd!' },
  });
  assert(`login ${email}`, res.status === 200 && !!res.json?.accessToken, `status=${res.status}`);
  return res.json?.accessToken;
}

async function main() {
  console.log(`Smoke testing file mode at ${BASE}`);

  const health = await req('GET', '/api/v1/health');
  assert('health file', health.status === 200 && health.json?.database === 'file');

  const groups = await req('GET', '/api/v1/groups?limit=5');
  assert('list groups', groups.status === 200 && Array.isArray(groups.json?.items) && groups.json.items.length > 0);

  const events = await req('GET', '/api/v1/events?limit=5');
  assert('list events', events.status === 200 && Array.isArray(events.json?.items));

  const maya = await login('maya@example.com');
  const diego = await login('diego@example.com');
  const sam = await login('sam@example.com');

  const rec = await req('GET', '/api/v1/recommendations/events', { token: maya });
  assert('recommendations events', rec.status === 200 && Array.isArray(rec.json));

  const recG = await req('GET', '/api/v1/recommendations/groups', { token: maya });
  assert('recommendations groups', recG.status === 200 && Array.isArray(recG.json));

  const search = await req('GET', '/api/v1/search?q=trail');
  assert('search', search.status === 200);

  const profile = await req('GET', '/api/v1/profiles/user_leo', { token: maya });
  assert('profile', profile.status === 200 && profile.json?.user?.name);

  // Friend request (priya already pending to maya; maya -> diego may already be friends via other pairs)
  const friend = await req('POST', '/api/v1/profiles/friend-requests', {
    token: sam,
    body: { userId: 'user_priya' },
  });
  assert(
    'friend request',
    friend.status === 201 || friend.status === 200 || friend.status === 409,
    `status=${friend.status} body=${JSON.stringify(friend.json)}`,
  );

  const convos = await req('GET', '/api/v1/messaging/conversations', { token: maya });
  assert('list conversations', convos.status === 200 && Array.isArray(convos.json));

  const openDm = await req('POST', '/api/v1/messaging/conversations/direct', {
    token: maya,
    body: { userId: 'user_diego' },
  });
  assert('open DM', openDm.status === 200 || openDm.status === 201, `status=${openDm.status}`);
  const dmId = openDm.json?.id;
  if (dmId) {
    const msgs = await req('GET', `/api/v1/messaging/conversations/${dmId}/messages`, { token: maya });
    assert('list messages', msgs.status === 200 && Array.isArray(msgs.json?.items));
    const sent = await req('POST', `/api/v1/messaging/conversations/${dmId}/messages`, {
      token: maya,
      body: { content: 'Smoke test ping' },
    });
    assert('send message', sent.status === 201 || sent.status === 200, `status=${sent.status}`);
  }

  // Shrink an event to capacity 1, then waitlist second GOING.
  const eventId = 'event_soccer';
  // Maya hosts? Diego owns futbol. Set capacity via direct file is hard; use RSVP flow on a small event.
  // event_critique is past — use event_finetune (capacity 100). Create waitlist by updating via admin? Skip create.
  // Instead: cancel everyone and set capacity by patching as host if possible.
  const eventDetail = await req('GET', `/api/v1/events/${eventId}`, { token: diego });
  assert('event detail', eventDetail.status === 200, `status=${eventDetail.status}`);

  // Diego owns the soccer event group — update capacity to 1
  const patched = await req('PATCH', `/api/v1/events/${eventId}`, {
    token: diego,
    body: { capacity: 1 },
  });
  assert('patch capacity', patched.status === 200, `status=${patched.status} ${JSON.stringify(patched.json)}`);

  // Clear existing RSVPs by cancelling as known users (best-effort)
  for (const [token, label] of [
    [sam, 'sam'],
    [maya, 'maya'],
    [diego, 'diego'],
  ]) {
    await req('DELETE', `/api/v1/events/${eventId}/rsvp`, { token });
  }

  const first = await req('PUT', `/api/v1/events/${eventId}/rsvp`, {
    token: diego,
    body: { status: 'GOING' },
  });
  assert('first going', first.status === 200 && first.json?.rsvp?.status === 'GOING', JSON.stringify(first.json));

  const second = await req('PUT', `/api/v1/events/${eventId}/rsvp`, {
    token: maya,
    body: { status: 'GOING' },
  });
  assert(
    'second waitlisted',
    second.status === 200 && second.json?.waitlisted === true && second.json?.rsvp?.status === 'WAITLISTED',
    JSON.stringify(second.json),
  );

  const third = await req('PUT', `/api/v1/events/${eventId}/rsvp`, {
    token: sam,
    body: { status: 'GOING' },
  });
  assert(
    'third waitlisted',
    third.status === 200 && third.json?.rsvp?.status === 'WAITLISTED',
    JSON.stringify(third.json),
  );

  // Free spot — maya (first on waitlist by createdAt) should promote FIFO
  await req('DELETE', `/api/v1/events/${eventId}/rsvp`, { token: diego });
  // Give promote a tick
  await new Promise((r) => setTimeout(r, 100));
  const after = await req('GET', `/api/v1/events/${eventId}`, { token: maya });
  assert(
    'fifo promote maya to going',
    after.status === 200 && after.json?.viewerRsvp?.status === 'GOING',
    JSON.stringify(after.json?.viewerRsvp),
  );

  const notifs = await req('GET', '/api/v1/notifications', { token: maya });
  assert('notifications', notifs.status === 200 && Array.isArray(notifs.json?.items));

  const me = await req('GET', '/api/v1/auth/me', { token: maya });
  assert('auth me', me.status === 200 && me.json?.email === 'maya@example.com');

  const join = await req('POST', '/api/v1/groups/group_books/join', { token: maya });
  assert(
    'join private group pending/active',
    join.status === 200 || join.status === 201 || join.status === 409,
    `status=${join.status}`,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
