'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createInviteContextStore,
  draftIsComplete,
  hasTimeCue,
} = require('./invite-context');

test('hasTimeCue recognizes evening dayparts', () => {
  assert.equal(hasTimeCue('Anyone want to play tomorrow evening?'), true);
  assert.equal(hasTimeCue('where..?'), false);
  assert.equal(hasTimeCue('at 6pm'), true);
});

test('draft completes across time then venue messages', () => {
  const store = createInviteContextStore({ ttlMs: 60_000 });
  const group = 'g1';

  store.pushMessage(group, {
    id: 'm1',
    text: 'Anyone want to play tomorrow evening?',
    senderName: 'Brigid',
  });
  store.mergeDraft(
    group,
    {
      title: 'Tennis tomorrow evening',
      suggestedTime: 'tomorrow evening',
      timeConfidence: 0.8,
    },
    { id: 'm1', text: 'Anyone want to play tomorrow evening?' },
  );
  assert.equal(store.draftIsComplete(group), false);

  store.pushMessage(group, {
    id: 'm2',
    text: 'what about the one near Atwater Elementary School..?',
    senderName: 'Abhishek',
  });
  store.mergeDraft(
    group,
    {
      venueSlug: 'atwater-elementary-tennis',
      venue: 'Atwater Elementary School Tennis Courts',
      locationName: 'Atwater Elementary School Tennis Courts',
      address: '2100 E Capitol Dr, Shorewood, WI 53211',
      venueConfidence: 1,
      addressConfidence: 1,
    },
    {
      id: 'm2',
      text: 'what about the one near Atwater Elementary School..?',
    },
  );

  const draft = store.get(group).draft;
  assert.ok(draft);
  assert.equal(draft.venueSlug, 'atwater-elementary-tennis');
  assert.ok(draft.suggestedTime);
  assert.equal(draftIsComplete(draft), true);
  assert.deepEqual(draft.relatedMessageIds, ['m1', 'm2']);
});

test('rsvp aliases map thread messages to primary invite', () => {
  const store = createInviteContextStore({ ttlMs: 60_000 });
  store.rememberInvite('g1', 'primary-msg', ['m1', 'm2', 'primary-msg']);
  assert.equal(store.resolveRsvpTarget('g1', 'm1'), 'primary-msg');
  assert.equal(store.resolveRsvpTarget('g1', 'unknown'), 'primary-msg');
});
