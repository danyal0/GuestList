import { pickSurvivor } from './whatsapp-identity';

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
