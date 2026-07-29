import { eventShareUrl } from './share';

describe('eventShareUrl', () => {
  it('builds an event link from the current origin', () => {
    expect(eventShareUrl('evt_123')).toBe(`${window.location.origin}/events/evt_123`);
  });
});
