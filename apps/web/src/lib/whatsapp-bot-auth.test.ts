import { timingSafeEqual } from 'crypto';

import {
  isValidWhatsappBotToken,
  normalizePhone,
} from './whatsapp-bot-auth';

describe('whatsapp-bot-auth', () => {
  const ORIGINAL = process.env.WHATSAPP_BOT_TOKEN;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.WHATSAPP_BOT_TOKEN;
    else process.env.WHATSAPP_BOT_TOKEN = ORIGINAL;
  });

  it('rejects missing token or unset secret', () => {
    delete process.env.WHATSAPP_BOT_TOKEN;
    expect(isValidWhatsappBotToken('anything')).toBe(false);

    process.env.WHATSAPP_BOT_TOKEN = 'secret';
    expect(isValidWhatsappBotToken(null)).toBe(false);
  });

  it('accepts an exact matching token', () => {
    process.env.WHATSAPP_BOT_TOKEN = 'super-secret-token';
    expect(isValidWhatsappBotToken('super-secret-token')).toBe(true);
  });

  it('rejects mismatched tokens of equal length', () => {
    process.env.WHATSAPP_BOT_TOKEN = 'abcdefgh';
    expect(isValidWhatsappBotToken('abcdefgH')).toBe(false);
  });

  it('normalizePhone strips non-digits', () => {
    expect(normalizePhone('+1 (415) 555-0100')).toBe('14155550100');
  });

  it('uses constant-time comparison path without throwing', () => {
    process.env.WHATSAPP_BOT_TOKEN = 'abcd';
    const a = Buffer.from('abcd');
    const b = Buffer.from('abcd');
    expect(timingSafeEqual(a, b)).toBe(true);
    expect(isValidWhatsappBotToken('abcd')).toBe(true);
  });
});
