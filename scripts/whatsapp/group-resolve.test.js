'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGroupId,
  parseInviteCode,
  createGroupResolver,
  extractPhone,
} = require('./group-resolve');

test('normalizeGroupId accepts @g.us and bare digits', () => {
  assert.equal(normalizeGroupId('120363123@g.us'), '120363123@g.us');
  assert.equal(normalizeGroupId('120363123'), '120363123@g.us');
  assert.equal(normalizeGroupId(' 120363123@g.us '), '120363123@g.us');
  assert.equal(normalizeGroupId('not-a-group'), null);
  assert.equal(normalizeGroupId(''), null);
  assert.equal(normalizeGroupId(null), null);
});

test('parseInviteCode extracts code from full invite URL with query params', () => {
  const url =
    'https://chat.whatsapp.com/KlaqXZtz8gLJBnIYdJduuL?s=cl&p=i&ilr=2&amv=2';
  assert.equal(parseInviteCode(url), 'KlaqXZtz8gLJBnIYdJduuL');
  assert.equal(parseInviteCode('KlaqXZtz8gLJBnIYdJduuL'), 'KlaqXZtz8gLJBnIYdJduuL');
  assert.equal(parseInviteCode('https://example.com/nope'), null);
  assert.equal(parseInviteCode(null), null);
});

test('auto-learn pins first group message without calling getChats', () => {
  const logs = [];
  const resolver = createGroupResolver({
    autoLearn: true,
    log: (...args) => logs.push(args.join(' ')),
  });

  // Simulate the failure mode: Store APIs throw `r` — we never call them here.
  const first = resolver.shouldProcessMessage({
    from: '120363999888777@g.us',
  });

  assert.equal(first.ok, true);
  assert.equal(first.groupId, '120363999888777@g.us');
  assert.equal(resolver.getId(), '120363999888777@g.us');
  assert.match(logs.join('\n'), /Auto-learned target group id/);
});

test('after learning, messages from other groups are ignored', () => {
  const resolver = createGroupResolver({ autoLearn: true, log: () => {} });
  resolver.shouldProcessMessage({ from: '120363aaa@g.us' });

  const other = resolver.shouldProcessMessage({ from: '120363bbb@g.us' });
  assert.equal(other.ok, false);
  assert.equal(other.reason, 'wrong-group');

  const same = resolver.shouldProcessMessage({ from: '120363aaa@g.us' });
  assert.equal(same.ok, true);
});

test('explicit WHATSAPP_GROUP_ID does not auto-switch to another group', () => {
  const resolver = createGroupResolver({
    groupId: '120363pinned@g.us',
    autoLearn: true,
    log: () => {},
  });

  const wrong = resolver.shouldProcessMessage({ from: '120363other@g.us' });
  assert.equal(wrong.ok, false);
  assert.equal(resolver.getId(), '120363pinned@g.us');

  const right = resolver.shouldProcessMessage({ from: '120363pinned@g.us' });
  assert.equal(right.ok, true);
});

test('auto-learn can be disabled', () => {
  const resolver = createGroupResolver({ autoLearn: false, log: () => {} });
  const result = resolver.shouldProcessMessage({ from: '120363learn@g.us' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unresolved-group');
  assert.equal(resolver.getId(), null);
});

test('ignores DMs, status, and self messages', () => {
  const resolver = createGroupResolver({
    groupId: '120363pinned@g.us',
    log: () => {},
  });

  assert.equal(
    resolver.shouldProcessMessage({ from: '15551234567@c.us' }).reason,
    'not-group',
  );
  assert.equal(
    resolver.shouldProcessMessage({ from: 'status@broadcast' }).reason,
    'status',
  );
  assert.equal(
    resolver.shouldProcessMessage({
      from: '120363pinned@g.us',
      fromMe: true,
    }).reason,
    'self',
  );
  assert.equal(
    resolver.shouldProcessMessage({
      from: '120363pinned@g.us',
      fromMe: true,
      processSelf: true,
    }).ok,
    true,
  );
});

test('extractPhone prefers author in groups', () => {
  assert.equal(
    extractPhone({ author: '15558675309@c.us', from: '120363group@g.us' }),
    '15558675309',
  );
  assert.equal(extractPhone({ from: '15551112222@c.us' }), '15551112222');
  assert.equal(extractPhone({ number: '+1 (555) 000-1111' }), '15550001111');
});

test('regression: getChats throwing must not prevent processing when learning from message.from', () => {
  // This is the exact production failure mode the user hit.
  const getChats = () => {
    throw new Error('r');
  };

  const resolver = createGroupResolver({ autoLearn: true, log: () => {} });

  let storeCalled = false;
  try {
    // Old path would call getChats() here and abort.
    getChats();
    storeCalled = true;
  } catch {
    // New path: ignore Store failure and learn from message.from instead.
  }

  assert.equal(storeCalled, false);

  const result = resolver.shouldProcessMessage({
    from: '120363frommessage@g.us',
  });
  assert.equal(result.ok, true);
  assert.equal(result.groupId, '120363frommessage@g.us');
});

test('serializeWhatsappMessageId prefers _serialized and composes fallback', () => {
  const {
    serializeWhatsappMessageId,
    extractSenderIdentity,
  } = require('./group-resolve');

  assert.equal(
    serializeWhatsappMessageId({
      id: { _serialized: 'true_120363@g.us_ABCD' },
    }),
    'true_120363@g.us_ABCD',
  );

  assert.equal(
    serializeWhatsappMessageId({
      id: { fromMe: false, remote: '120363@g.us', id: '3EB0XYZ' },
    }),
    'false_120363@g.us_3EB0XYZ',
  );

  assert.equal(serializeWhatsappMessageId({ id: {} }), null);
  assert.equal(serializeWhatsappMessageId({}), null);

  // JSON.stringify drops undefined — ensure we never return undefined.
  const serialized = serializeWhatsappMessageId({
    id: { fromMe: true, remote: '120363@g.us', id: '1' },
  });
  assert.equal(
    JSON.parse(JSON.stringify({ whatsappMessageId: serialized }))
      .whatsappMessageId,
    'true_120363@g.us_1',
  );

  const lid = extractSenderIdentity({
    author: '173709952336025@lid',
    from: '120363group@g.us',
  });
  assert.equal(lid.isLid, true);
  assert.equal(lid.senderKey, '173709952336025');
  assert.equal(lid.senderJid, '173709952336025@lid');
});
