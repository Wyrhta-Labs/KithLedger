import { db } from '../db/index.js';
import { reminders, people } from '../db/schema/index.js';
import { eq, and, lte, sql } from 'drizzle-orm';
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

export async function listReminders(query: ListRemindersQuery) {
  const conditions = [];

  if (query.person_id) conditions.push(eq(reminders.personId, query.person_id));
  if (query.status) conditions.push(eq(reminders.status, query.status));
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
      const nextDueAt = addDuration(reminder.dueAt, reminder.recurrence);
      const [newReminder] = await tx
        .insert(reminders)
        .values({
          personId: reminder.personId,
          dueAt: nextDueAt,
          title: reminder.title,
          notes: reminder.notes,
          recurrence: reminder.recurrence,
          status: 'pending',
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
