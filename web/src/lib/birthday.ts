/**
 * Birthday date arithmetic, kept dependency-free so the root Vitest suite can
 * import it directly (web/ has no test runner of its own).
 *
 * A birthday is a bare `YYYY-MM-DD` with no timezone. Parsing it via `new
 * Date('1990-03-14')` would treat it as UTC midnight and shift the day for
 * anyone west of Greenwich, so the components are parsed by hand throughout.
 */

/** Hour of day, in the user's local timezone, that birthday reminders fire. */
export const BIRTHDAY_REMINDER_HOUR = 9;

/** Lead-time choices offered in the Add Person modal. */
export const BIRTHDAY_LEAD_OPTIONS = [
  { value: 0, label: 'On the day' },
  { value: 1, label: '1 day before' },
  { value: 3, label: '3 days before' },
  { value: 7, label: '7 days before' },
] as const;

const MS_PER_DAY = 86_400_000;

function parseBirthday(birthday: string): { month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!match) throw new Error(`Invalid birthday: ${birthday}`);
  return { month: Number(match[2]), day: Number(match[3]) };
}

/**
 * The next time this birthday comes around, at BIRTHDAY_REMINDER_HOUR local
 * time. Returns today's occurrence if it has not yet passed.
 *
 * A Feb 29 birthday lands on Mar 1 in a common year, via JS `Date` rollover.
 * That is deliberate: clamping to Feb 28 would be an equally arbitrary choice,
 * and rolling forward keeps the arithmetic honest and testable.
 */
export function nextBirthdayOccurrence(birthday: string, now: Date = new Date()): Date {
  const { month, day } = parseBirthday(birthday);
  const thisYear = new Date(now.getFullYear(), month - 1, day, BIRTHDAY_REMINDER_HOUR, 0, 0, 0);
  if (thisYear.getTime() >= now.getTime()) return thisYear;
  return new Date(now.getFullYear() + 1, month - 1, day, BIRTHDAY_REMINDER_HOUR, 0, 0, 0);
}

/**
 * When a birthday reminder should fire, as ISO-8601 UTC for the API.
 *
 * The "already past" test is applied to the *reminder* date, not the birthday:
 * a birthday three days out with a seven-day lead rolls to next year rather
 * than producing a reminder that is already overdue the moment it is created.
 */
export function computeBirthdayReminderDueAt(
  birthday: string,
  leadDays: number,
  now: Date = new Date()
): string {
  const { month, day } = parseBirthday(birthday);

  const dueForYear = (year: number) =>
    new Date(
      new Date(year, month - 1, day, BIRTHDAY_REMINDER_HOUR, 0, 0, 0).getTime() -
        leadDays * MS_PER_DAY
    );

  let due = dueForYear(now.getFullYear());
  if (due.getTime() < now.getTime()) due = dueForYear(now.getFullYear() + 1);
  return due.toISOString();
}
