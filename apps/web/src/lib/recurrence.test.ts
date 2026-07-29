import {
  addMinutesToDateTimeLocal,
  buildAppleRecurrenceRule,
  combineDateAndTime,
  friendlyDayLabel,
} from './recurrence';

describe('Apple-style recurrence helpers', () => {
  it('maps common frequencies to RRULE', () => {
    expect(
      buildAppleRecurrenceRule({ frequency: 'never', endMode: 'never' }),
    ).toBeUndefined();
    expect(
      buildAppleRecurrenceRule({ frequency: 'daily', endMode: 'count', endCount: 5 }),
    ).toBe('FREQ=DAILY;COUNT=5');
    expect(
      buildAppleRecurrenceRule({ frequency: 'weekdays', endMode: 'never' }),
    ).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=26');
    expect(
      buildAppleRecurrenceRule({ frequency: 'biweekly', endMode: 'count', endCount: 6 }),
    ).toBe('FREQ=WEEKLY;INTERVAL=2;COUNT=6');
    expect(
      buildAppleRecurrenceRule({ frequency: 'quarterly', endMode: 'count', endCount: 4 }),
    ).toBe('FREQ=MONTHLY;INTERVAL=3;COUNT=4');
  });

  it('supports end-on-date via UNTIL', () => {
    const rule = buildAppleRecurrenceRule({
      frequency: 'weekly',
      endMode: 'date',
      endDate: new Date(Date.UTC(2026, 11, 31)),
    });
    expect(rule).toContain('FREQ=WEEKLY');
    expect(rule).toContain('UNTIL=20261231T235959Z');
  });

  it('combines date + time into datetime-local', () => {
    const value = combineDateAndTime(new Date(2026, 6, 30), '18:30');
    expect(value).toBe('2026-07-30T18:30');
    expect(addMinutesToDateTimeLocal(value, 90)).toBe('2026-07-30T20:00');
  });

  it('labels today and tomorrow', () => {
    const today = new Date();
    expect(friendlyDayLabel(today)).toBe('Today');
  });
});
