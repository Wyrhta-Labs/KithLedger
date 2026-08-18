import { db } from '../db/index.js';
import { reminders, people, reminderShares } from '../db/schema/index.js';
import { eq, and, lte, inArray, sql } from 'drizzle-orm';
import type { CreateReminderInput, UpdateReminderInput, ListRemindersQuery } from '../validators/reminders.js';
import { personVisible } from './people.js';
import {
  REMINDERS_SCOPE,
  REMINDER_SHARE_TARGET,
  NOT_OWNER,
  canDelete,
  deletableBy,
  ownerFor,
  ownsRow,
  replaceShareSet,
  visibleTo,
  type Scope,
} from './scope.js';

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

export async function listReminders(scope: Scope, query: ListRemindersQuery) {
  const conditions = [visibleTo(REMINDERS_SCOPE, scope)];

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

  const where = and(...conditions);

  const rows = await db.select().from(reminders)
    .where(where)
    .orderBy(reminders.dueAt)
    .limit(limit)
    .offset(offset);

  // Same `where` as the rows: ADR 0004 §3.4.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reminders)
    .where(where);

  return { rows, total: count, limit, offset };
}

export async function getReminder(scope: Scope, id: string) {
  const [row] = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, id), visibleTo(REMINDERS_SCOPE, scope)))
    .limit(1);
  return row ?? null;
}

export async function createReminder(scope: Scope, input: CreateReminderInput) {
  const ownerId = ownerFor(scope);

  // ADR 0004 §3.1 — the pre-check is SCOPED, so a person outside the caller's
  // scope 404s exactly like a person who does not exist. An unscoped probe
  // would make this endpoint an existence oracle.
  if (!(await personVisible(scope, input.personId))) throw new Error('PERSON_NOT_FOUND');

  return db.transaction(async (tx) => {
    const [row] = await tx
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
        ownerId,
        // B9: the creator IS the last writer at insert time.
        updatedBy: ownerId,
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      })
      .returning();
    if (!row) throw new Error('Failed to create reminder');
    if (input.sharedWith) {
      await replaceShareSet(tx, REMINDER_SHARE_TARGET, row.id, input.sharedWith);
    }
    return row;
  });
}

export async function updateReminder(scope: Scope, id: string, input: UpdateReminderInput) {
  // B9: the acting principal, stamped as `updated_by` below. `ownerFor` is
  // also the read-only-scope refusal — the household dashboard principal has
  // no member id, so it cannot be the author of a write.
  const actor = ownerFor(scope);

  const current = await getReminder(scope, id);
  if (!current) return null;
  // ADR 0004 §4 — owner-only governance; sharing is not transitive.
  if ((input.visibility !== undefined || input.sharedWith !== undefined)
      && !ownsRow(scope, current.ownerId)) {
    throw new Error(NOT_OWNER);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor };
  if (input.dueAt !== undefined) updates['dueAt'] = new Date(input.dueAt);
  if (input.title !== undefined) updates['title'] = input.title;
  if (input.notes !== undefined) updates['notes'] = input.notes;
  if (input.recurrence !== undefined) updates['recurrence'] = input.recurrence;
  if (input.visibility !== undefined) updates['visibility'] = input.visibility;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(reminders)
      .set(updates)
      .where(and(eq(reminders.id, id), visibleTo(REMINDERS_SCOPE, scope)))
      .returning();
    if (!row) return null;
    if (input.sharedWith !== undefined) {
      await replaceShareSet(tx, REMINDER_SHARE_TARGET, id, input.sharedWith);
    }
    return row;
  });
}

/**
 * ADR 0004 §4 (task B9). Delete is NARROWER than read and narrower than a
 * content edit: `household` items may be removed by any member, but a
 * `private` or `shared` one only by its owner. See {@link deletableBy} for the
 * argument. The 404 / 403 split is deliberate and is not a §3.1 leak — an item
 * outside the scope is `null` here and 404s at the route exactly as a
 * non-existent id does, while `NOT_OWNER` is thrown only for an item the
 * caller can already see.
 */
export async function deleteReminder(scope: Scope, id: string) {
  ownerFor(scope);

  const current = await getReminder(scope, id);
  if (!current) return null;
  if (!canDelete(scope, current)) throw new Error(NOT_OWNER);

  const [row] = await db
    .delete(reminders)
    // Both predicates again, on the statement itself: the row could have been
    // flipped `household` -> `private` between the check above and here.
    .where(and(eq(reminders.id, id), visibleTo(REMINDERS_SCOPE, scope), deletableBy(REMINDERS_SCOPE, scope)))
    .returning();
  return row ?? null;
}

export async function completeReminder(scope: Scope, id: string) {
  const actor = ownerFor(scope);

  // ADR 0004 §3.1 — scoped existence pre-check: completing a reminder you
  // cannot see is NOT FOUND, not forbidden.
  const reminder = await getReminder(scope, id);
  if (!reminder) return null;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(reminders)
      .set({ status: 'done', updatedAt: new Date(), updatedBy: actor })
      .where(and(eq(reminders.id, id), visibleTo(REMINDERS_SCOPE, scope)))
      .returning();
    if (!updated) return null;

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
          // The successor is the SAME commitment recurring, so it inherits the
          // original's owner and visibility rather than silently becoming a
          // `household` item owned by whoever happened to tick the box. The
          // share set is carried over for the same reason: a recurrence whose
          // audience widened or narrowed each cycle would make `shared`
          // unusable for anything periodic.
          ownerId: reminder.ownerId,
          visibility: reminder.visibility,
          // ...but NOT the writer. B9: `owner_id` is inherited from the
          // commitment, `updated_by` records who actually ticked the box, and
          // for a shared or household reminder those are routinely different
          // people. This is the one insert in the service where creator and
          // owner provably diverge — see `0007_*.sql` for why that makes a
          // "creator == owner" backfill of pre-B9 rows unsafe.
          updatedBy: actor,
        })
        .returning();
      next = newReminder ?? null;
      if (newReminder && reminder.visibility === 'shared') {
        const grants = await tx
          .select({ memberId: reminderShares.memberId })
          .from(reminderShares)
          .where(eq(reminderShares.reminderId, reminder.id));
        await replaceShareSet(
          tx,
          REMINDER_SHARE_TARGET,
          newReminder.id,
          grants.map((g) => g.memberId),
        );
      }
    }

    return { updated, next };
  });
}

export async function snoozeReminder(scope: Scope, id: string, snoozeUntil: string) {
  const actor = ownerFor(scope);
  const [row] = await db
    .update(reminders)
    .set({ status: 'snoozed', snoozedUntil: new Date(snoozeUntil), updatedAt: new Date(), updatedBy: actor })
    .where(and(eq(reminders.id, id), visibleTo(REMINDERS_SCOPE, scope)))
    .returning();
  return row ?? null;
}

export async function dismissReminder(scope: Scope, id: string) {
  const actor = ownerFor(scope);
  const [row] = await db
    .update(reminders)
    .set({ status: 'dismissed', updatedAt: new Date(), updatedBy: actor })
    .where(and(eq(reminders.id, id), visibleTo(REMINDERS_SCOPE, scope)))
    .returning();
  return row ?? null;
}
