import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reminders } from '../db/schema/index.js';

export const BIRTHDAY_REMINDER_KIND = 'birthday' as const;
export const BIRTHDAY_REMINDER_TITLE = 'Birthday reminder';

function parseBirthdayParts(birthday: string) {
  const [year, month, day] = birthday.split('-').map(Number);
  return { year, month, day };
}

function buildBirthdayOccurrence(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

export function getNextBirthdayDueAt(birthday: string, now = new Date()) {
  const { month, day } = parseBirthdayParts(birthday);
  const currentYear = now.getUTCFullYear();
  const thisYearBirthday = buildBirthdayOccurrence(currentYear, month, day);
  return thisYearBirthday >= now
    ? thisYearBirthday
    : buildBirthdayOccurrence(currentYear + 1, month, day);
}

export function getBirthdayAgeForReminder(birthday: string, dueAt: Date | string) {
  const { year } = parseBirthdayParts(birthday);
  const dueYear = new Date(dueAt).getUTCFullYear();
  return dueYear - year;
}

export function getBirthdayReminderTitle(name: string, birthday: string, dueAt: Date | string) {
  return `${name} turns ${getBirthdayAgeForReminder(birthday, dueAt)}`;
}

export async function syncBirthdayReminderForPerson(personId: string, name: string, birthday: string | null) {
  const [existing] = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.personId, personId), eq(reminders.kind, BIRTHDAY_REMINDER_KIND)))
    .limit(1);

  if (!birthday) {
    if (existing) {
      await db.delete(reminders).where(eq(reminders.id, existing.id));
    }
    return null;
  }

  const dueAt = getNextBirthdayDueAt(birthday);

  if (!existing) {
    const [created] = await db
      .insert(reminders)
      .values({
        personId,
        dueAt,
        title: BIRTHDAY_REMINDER_TITLE,
        kind: BIRTHDAY_REMINDER_KIND,
      })
      .returning();
    return created ?? null;
  }

  const [updated] = await db
    .update(reminders)
    .set({
      dueAt,
      title: BIRTHDAY_REMINDER_TITLE,
      updatedAt: new Date(),
    })
    .where(eq(reminders.id, existing.id))
    .returning();
  return updated ?? null;
}
