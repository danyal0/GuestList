import {
  formatNamedProfileClueSummary,
  isNamedPlaceholder,
  pickSurvivor,
} from './whatsapp-identity';

describe('pickSurvivor', () => {
  it('prefers the account with a password', () => {
    const a = {
      id: 'a',
      name: 'WA',
      phone: null,
      whatsappLid: '111',
      passwordHash: null,
    };
    const b = {
      id: 'b',
      name: 'Web',
      phone: '19296003270',
      whatsappLid: null,
      passwordHash: 'hash',
    };
    expect(pickSurvivor(a, b).survivor.id).toBe('b');
    expect(pickSurvivor(a, b).loser.id).toBe('a');
  });

  it('prefers the LID account when neither has a password', () => {
    const a = {
      id: 'a',
      name: 'Phone',
      phone: '19296003270',
      whatsappLid: null,
      passwordHash: null,
    };
    const b = {
      id: 'b',
      name: 'Lid',
      phone: null,
      whatsappLid: '173709952336025',
      passwordHash: null,
    };
    expect(pickSurvivor(a, b).survivor.id).toBe('b');
  });
});

describe('isNamedPlaceholder', () => {
  it('recognizes WhatsApp name-only attendees', () => {
    expect(
      isNamedPlaceholder({
        email: 'named-khatera-abc123@wa.mkeplays.app',
        phone: null,
        whatsappLid: null,
        passwordHash: null,
      }),
    ).toBe(true);
  });

  it('still recognizes placeholders when email was omitted from a partial select', () => {
    // Regression: claim used identitySelect without email and always failed.
    expect(
      isNamedPlaceholder({
        email: undefined,
        phone: null,
        whatsappLid: null,
        passwordHash: null,
      }),
    ).toBe(true);
  });

  it('rejects real accounts and LID-only WhatsApp users', () => {
    expect(
      isNamedPlaceholder({
        email: 'named-khatera-abc123@wa.mkeplays.app',
        phone: '14145550100',
        whatsappLid: null,
        passwordHash: null,
      }),
    ).toBe(false);
    expect(
      isNamedPlaceholder({
        email: null,
        phone: null,
        whatsappLid: '173709952336025',
        passwordHash: null,
      }),
    ).toBe(false);
    expect(
      isNamedPlaceholder({
        email: 'named-khatera-abc123@wa.mkeplays.app',
        phone: null,
        whatsappLid: null,
        passwordHash: 'hash',
      }),
    ).toBe(false);
  });
});

describe('formatNamedProfileClueSummary', () => {
  it('includes venue, time, and host', () => {
    const summary = formatNamedProfileClueSummary({
      title: 'Atwater Elementary tennis 6pm',
      startTime: new Date('2026-07-28T23:00:00.000Z'),
      venueName: 'Atwater Elementary School',
      hostName: 'Danyal',
    });
    expect(summary).toContain('Atwater Elementary School');
    expect(summary).toContain('Danyal');
    expect(summary).toContain('Atwater Elementary tennis 6pm');
  });
});
