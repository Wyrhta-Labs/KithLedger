import { describe, it, expect } from 'vitest';
// Imported across into web/ by relative path: the helper is dependency-free and
// web/ has no test runner of its own. The root tsconfig excludes tests/, so this
// does not affect `npm run typecheck`.
import {
  nextBirthdayOccurrence,
  computeBirthdayReminderDueAt,
  BIRTHDAY_REMINDER_HOUR,
} from '../web/src/lib/birthday.js';
import { nextBirthdayDueAt } from '../src/services/reminders.js';

/** Local-time helper so assertions read in the same frame the code computes in. */
function local(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

describe('nextBirthdayOccurrence', () => {
  it('returns this year when the birthday is still ahead', () => {
    const got = nextBirthdayOccurrence('1990-08-21', local(2026, 8, 5, 12));
    expect(got).toEqual(local(2026, 8, 21, BIRTHDAY_REMINDER_HOUR));
  });

  it('rolls to next year when the birthday has passed', () => {
    const got = nextBirthdayOccurrence('1990-03-14', local(2026, 8, 5, 12));
    expect(got).toEqual(local(2027, 3, 14, BIRTHDAY_REMINDER_HOUR));
  });

  it("returns today's occurrence when it has not yet passed", () => {
    const got = nextBirthdayOccurrence('1990-08-05', local(2026, 8, 5, 7));
    expect(got).toEqual(local(2026, 8, 5, BIRTHDAY_REMINDER_HOUR));
  });

  it('rolls past today once the hour has passed', () => {
    const got = nextBirthdayOccurrence('1990-08-05', local(2026, 8, 5, 10));
    expect(got).toEqual(local(2027, 8, 5, BIRTHDAY_REMINDER_HOUR));
  });

  it('crosses the year boundary — a January birthday seen in December', () => {
    const got = nextBirthdayOccurrence('1990-01-09', local(2026, 12, 20, 12));
    expect(got).toEqual(local(2027, 1, 9, BIRTHDAY_REMINDER_HOUR));
  });

  it('rolls a Feb 29 birthday to Mar 1 in a common year', () => {
    const got = nextBirthdayOccurrence('1988-02-29', local(2027, 1, 1, 12));
    expect(got).toEqual(local(2027, 3, 1, BIRTHDAY_REMINDER_HOUR));
  });

  it('keeps Feb 29 in a leap year', () => {
    const got = nextBirthdayOccurrence('1988-02-29', local(2028, 1, 1, 12));
    expect(got).toEqual(local(2028, 2, 29, BIRTHDAY_REMINDER_HOUR));
  });

  it('rejects a malformed birthday', () => {
    expect(() => nextBirthdayOccurrence('14-03-1990')).toThrow(/Invalid birthday/);
  });
});

describe('computeBirthdayReminderDueAt', () => {
  it('returns ISO-8601 UTC', () => {
    const got = computeBirthdayReminderDueAt('1990-08-21', 0, local(2026, 8, 5, 12));
    expect(got).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('fires on the day with a zero lead', () => {
    const got = computeBirthdayReminderDueAt('1990-08-21', 0, local(2026, 8, 5, 12));
    expect(new Date(got)).toEqual(local(2026, 8, 21, BIRTHDAY_REMINDER_HOUR));
  });

  it.each([1, 3, 7])('subtracts a %i-day lead', (leadDays) => {
    const got = computeBirthdayReminderDueAt('1990-08-21', leadDays, local(2026, 8, 5, 12));
    expect(new Date(got)).toEqual(
      new Date(local(2026, 8, 21, BIRTHDAY_REMINDER_HOUR).getTime() - leadDays * 86_400_000)
    );
  });

  it('rolls to next year when the birthday has already passed', () => {
    const got = computeBirthdayReminderDueAt('1990-03-14', 0, local(2026, 8, 5, 12));
    expect(new Date(got)).toEqual(local(2027, 3, 14, BIRTHDAY_REMINDER_HOUR));
  });

  it('rolls to next year when the LEAD pushes the date into the past', () => {
    // Birthday is 3 days away, but a 7-day lead would have fired 4 days ago.
    const got = computeBirthdayReminderDueAt('1990-08-08', 7, local(2026, 8, 5, 12));
    expect(new Date(got)).toEqual(
      new Date(local(2027, 8, 8, BIRTHDAY_REMINDER_HOUR).getTime() - 7 * 86_400_000)
    );
  });

  it('does not roll when the lead date is still ahead', () => {
    const got = computeBirthdayReminderDueAt('1990-08-20', 7, local(2026, 8, 5, 12));
    expect(new Date(got)).toEqual(
      new Date(local(2026, 8, 20, BIRTHDAY_REMINDER_HOUR).getTime() - 7 * 86_400_000)
    );
  });
});

describe('nextBirthdayDueAt (server-side recurrence recompute)', () => {
  it('advances a zero-lead birthday reminder by exactly one year', () => {
    const current = new Date('2027-03-14T08:00:00.000Z');
    expect(nextBirthdayDueAt(current, '1990-03-14', 0)).toEqual(
      new Date('2028-03-14T08:00:00.000Z')
    );
  });

  it('lands on Feb 29 for a Mar 1 birthday with a 1-day lead in a leap year', () => {
    // This is the case a naive +P1Y gets wrong: it would repeat Feb 28.
    const current = new Date('2027-02-28T08:00:00.000Z');
    expect(nextBirthdayDueAt(current, '1990-03-01', 1)).toEqual(
      new Date('2028-02-29T08:00:00.000Z')
    );
  });

  it('returns to Feb 28 the year after the leap year', () => {
    const current = new Date('2028-02-29T08:00:00.000Z');
    expect(nextBirthdayDueAt(current, '1990-03-01', 1)).toEqual(
      new Date('2029-02-28T08:00:00.000Z')
    );
  });

  it('preserves the UTC time-of-day', () => {
    const current = new Date('2027-08-21T06:30:00.000Z');
    expect(nextBirthdayDueAt(current, '1990-08-21', 0).toISOString()).toBe(
      '2028-08-21T06:30:00.000Z'
    );
  });

  it('picks up an edited birthday instead of repeating the old date', () => {
    // Reminder was created for Aug 21; the person's birthday is now Sep 02.
    const current = new Date('2027-08-21T08:00:00.000Z');
    expect(nextBirthdayDueAt(current, '1990-09-02', 0)).toEqual(
      new Date('2028-09-02T08:00:00.000Z')
    );
  });

  it('handles a 7-day lead across a month boundary', () => {
    const current = new Date('2027-02-22T08:00:00.000Z');
    expect(nextBirthdayDueAt(current, '1990-03-01', 7)).toEqual(
      new Date('2028-02-23T08:00:00.000Z')
    );
  });
});
