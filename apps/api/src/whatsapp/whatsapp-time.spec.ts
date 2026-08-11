import {
  coerceTennisStartTime,
  daypartHourFromText,
  formatStartForSenseCheck,
  hasDaypartCue,
  hasTimeOrDaypartCue,
  resolveSchedule,
  tryParseCasualTennisTime,
} from './whatsapp-time';

describe('daypart tennis time', () => {
  it('maps evening/tonight/afternoon', () => {
    expect(daypartHourFromText('tomorrow evening')).toBe(18);
    expect(daypartHourFromText('tonight')).toBe(18);
    expect(daypartHourFromText('this afternoon')).toBe(14);
    expect(daypartHourFromText('tomorrow morning')).toBe(10);
  });

  it('treats dayparts as time cues', () => {
    expect(hasDaypartCue('Anyone want to play tomorrow evening?')).toBe(true);
    expect(hasTimeOrDaypartCue('tomorrow evening')).toBe(true);
    expect(hasTimeOrDaypartCue('tennis at Atwater')).toBe(false);
  });

  it('parses tomorrow evening to ~18:00 Chicago', () => {
    const d = tryParseCasualTennisTime('tomorrow evening', 'America/Chicago');
    expect(d).toBeTruthy();
    const local = formatStartForSenseCheck(d!, 'America/Chicago');
    expect(local.localHour).toBe(18);
  });

  it('coerces absurd 23:00 local ISO when message said evening', () => {
    const coerced = coerceTennisStartTime(
      '2026-08-11T23:00:00-05:00',
      'Anyone want to play tomorrow evening?',
      'America/Chicago',
    );
    expect(coerced).toBeTruthy();
    const local = formatStartForSenseCheck(coerced!, 'America/Chicago');
    expect(local.localHour).toBe(18);
  });

  it('keeps a sensible 6pm ISO from evening', () => {
    const kept = coerceTennisStartTime(
      '2026-08-11T18:00:00-05:00',
      'Anyone want to play tomorrow evening?',
      'America/Chicago',
    );
    expect(kept).toBeTruthy();
    const local = formatStartForSenseCheck(kept!, 'America/Chicago');
    expect(local.localHour).toBe(18);
  });

  it('defaults resolveSchedule to tomorrow 18:00 when empty', () => {
    const { startTime } = resolveSchedule(null, {
      timezone: 'America/Chicago',
      durationMinutes: 90,
      messageBody: '',
    });
    const local = formatStartForSenseCheck(startTime, 'America/Chicago');
    expect(local.localHour).toBe(18);
  });

  it('formats sense-check fields with local hour not UTC confusion', () => {
    // 6pm CDT = 23:00 UTC
    const sixPm = new Date('2026-08-11T23:00:00.000Z');
    const formatted = formatStartForSenseCheck(sixPm, 'America/Chicago');
    expect(formatted.localHour).toBe(18);
    expect(formatted.startTimeUtc).toContain('T23:00:00');
    expect(formatted.startTimeLocal).toMatch(/18:00|6:00/i);
  });
});
