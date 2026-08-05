import { db } from '../db/index.js';
import { reminders, people } from '../db/schema/index.js';
import { eq, and, lte, inArray, sql } from 'drizzle-orm';
import type { CreateReminderInput, UpdateReminderInput, ListRemindersQuery } from '../validators/reminders.js';

/** Parse an ISO 8601 duration like P3M and add it to a date */
function addDuration(date: Date, duration: string): Date {
  const result = new Date(date);
  // Simple parser: PnYnMnDTnHnMnS
  const match = duration.match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );
  if (!match) throw new Error(`Invalid ISO 8601 duration: ${duration}`);
  const [, years, months, days, hours, minutes, seconds] = match.map(Number);
  if (years) result.setFullYear(result.getFullYear() + years);
  if (months) result.setMonth(result.getMonth() + months);
  if (days) result.setDate(result.getDate() + days);
  if (hours) result.setHours(result.getHours() + hours);
  if (minutes) result.setMinutes(result.getMinutes() + minutes);
  if (seconds) result.setSeconds(result.getSeconds() + seconds);
  return result;
}

const MS_PER_DAY = 86_400_000;

/**
 * Next due date for a recurring birthday reminder, recomputed from the person's
 * *current* birthday rather than by adding P1Y to the previous date.
 *
 * Adding P1Y is wrong for any non-zero lead: a Mar 1 birthday with a 1-day lead
 * is due Feb 28 in a common year, and +P1Y repeats Feb 28 when the correct date
 * in a leap year is Feb 29. Recomputing also means the reminder self-heals if
 * the birthday is edited after the reminder was created.
 *
 * The UTC time-of-day of `currentDueAt` is preserved, which keeps the original
 * "09:00 local at creation" stable year to year except across a DST rule change
 * — an accepted tradeoff over storing a timezone per reminder.
 */
export function nextBirthdayDueAt(currentDueAt: Date, birthday: string, leadDays: number): Date {
  const match = birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid birthday: ${birthday}`);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // The birthday occurrence this row was serving, so the next one is year + 1.
  const served = new Date(currentDueAt.getTime() + leadDays * MS_PER_DAY);
  const year = served.getUTCFullYear() + 1;

  const nextBirthday = Date.UTC(
    year,
    month - 1,
    day,
    currentDueAt.getUTCHours(),
    currentDueAt.getUTCMinutes(),
    currentDueAt.getUTCSeconds(),
    currentDueAt.getUTCMilliseconds()
  );
  return new Date(nextBirthday - leadDays * MS_PER_DAY);
}

export async function listReminders(query: ListRemindersQuery) {
  const conditions = [];

  if (query.person_id) conditions.push(eq(reminders.personId, query.person_id));
  if (query.statuses?.length) conditions.push(inArray(reminders.status, query.statuses));
  else if (query.status) conditions.push(eq(reminders.status, query.status));
  if (query.kind) conditions.push(eq(reminders.kind, query.kind));
  if (query.due_before) conditions.push(lte(reminders.dueAt, new Date(query.due_before)));
  if (query.overdue === 'true') {
    conditions.push(
      and(
        lte(reminders.dueAt, new Date()),
        eq(reminders.status, 'pending')
      )!
    );
  }

  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = Math.max(0, query.offset ?? 0);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select().from(reminders)
    .where(where)
    .orderBy(reminders.dueAt)
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reminders)
    .where(where);

  return { rows, total: count, limit, offset };
}

export async function getReminder(id: string) {
  const [row] = await db.select().from(reminders).where(eq(reminders.id, id)).limit(1);
  return row ?? null;
}

export async function createReminder(input: CreateReminderInput) {
  const [person] = await db.select().from(people).where(eq(people.id, input.personId)).limit(1);
  if (!person) throw new Error('PERSON_NOT_FOUND');

  const [row] = await db
    .insert(reminders)
    .values({
      personId: input.personId,
      dueAt: new Date(input.dueAt),
      title: input.title,
      notes: input.notes ?? null,
      recurrence: input.recurrence ?? null,
      // Must be inserted explicitly: this is an explicit column list, so
      // omitting kind would silently fall back to the 'generic' column default
      // and every birthday reminder would be unrecognisable to the widget.
      kind: input.kind,
      leadDays: input.leadDays ?? null,
    })
    .returning();
  return row!;
}

export async function updateReminder(id: string, input: UpdateReminderInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.dueAt !== undefined) updates['dueAt'] = new Date(input.dueAt);
  if (input.title !== undefined) updates['title'] = input.title;
  if (input.notes !== undefined) updates['notes'] = input.notes;
  if (input.recurrence !== undefined) updates['recurrence'] = input.recurrence;

  const [row] = await db.update(reminders).set(updates).where(eq(reminders.id, id)).returning();
  return row ?? null;
}

export async function deleteReminder(id: string) {
  const [row] = await db.delete(reminders).where(eq(reminders.id, id)).returning();
  return row ?? null;
}

export async function completeReminder(id: string) {
  const [reminder] = await db.select().from(reminders).where(eq(reminders.id, id)).limit(1);
  if (!reminder) return null;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(reminders)
      .set({ status: 'done', updatedAt: new Date() })
      .where(eq(reminders.id, id))
      .returning();

    let next = null;
    if (reminder.recurrence) {
      let nextDueAt: Date;
      if (reminder.kind === 'birthday' && reminder.leadDays !== null) {
        // Recompute from the person's current birthday. Falls back to the
        // generic duration if they no longer have one.
        const [person] = await tx
          .select({ birthday: people.birthday })
          .from(people)
          .where(eq(people.id, reminder.personId))
          .limit(1);
        nextDueAt = person?.birthday
          ? nextBirthdayDueAt(reminder.dueAt, person.birthday, reminder.leadDays)
          : addDuration(reminder.dueAt, reminder.recurrence);
      } else {
        nextDueAt = addDuration(reminder.dueAt, reminder.recurrence);
      }

      const [newReminder] = await tx
        .insert(reminders)
        .values({
          personId: reminder.personId,
          dueAt: nextDueAt,
          title: reminder.title,
          notes: reminder.notes,
          recurrence: reminder.recurrence,
          status: 'pending',
          // Carry the classification forward, or the successor degrades to
          // 'generic' and the widget stops recognising the birthday.
          kind: reminder.kind,
          leadDays: reminder.leadDays,
        })
        .returning();
      next = newReminder;
    }

    return { updated: updated!, next };
  });
}

export async function snoozeReminder(id: string, snoozeUntil: string) {
  const [row] = await db
    .update(reminders)
    .set({ status: 'snoozed', snoozedUntil: new Date(snoozeUntil), updatedAt: new Date() })
    .where(eq(reminders.id, id))
    .returning();
  return row ?? null;
}

export async function dismissReminder(id: string) {
  const [row] = await db
    .update(reminders)
    .set({ status: 'dismissed', updatedAt: new Date() })
    .where(eq(reminders.id, id))
    .returning();
  return row ?? null;
}
