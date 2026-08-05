# Birthday reminders — design

**Date:** 2026-08-05
**Status:** approved; revised after independent review (Codex, read-only)

## Goal

When adding a person with a birthday, offer to create a recurring yearly
reminder for that birthday. The dashboard's birthday widget then defers to
reminders: it lists only birthdays that are *not* already tracked by an active
one.

## Decisions

| Question | Decision |
|---|---|
| Where does the checkbox appear? | Add Person only — never in the edit dialogs |
| Default state | Checked, whenever a birthday is set |
| Lead time | Selectable in the modal: on the day (default), 1, 3 or 7 days before |
| Time of day | 09:00 in the browser's local time at creation |
| Recurrence | `P1Y`, but birthday reminders **recompute** on completion (see Part 2) |
| Widget behaviour | Hides birthdays with an *active* birthday reminder |
| Marker | New `kind` column, plus `lead_days`, on `reminders` |

## Prerequisites: three pre-existing bugs

These are unrelated to the feature but block or undermine it.

**1. Five list requests exceed the server's cap.** `listPeopleQuerySchema` caps
`limit` at 100; these request 200, so every one returns 400:
`birthday-widget.tsx:8`, `quick-actions.tsx:20`, `recent-interactions.tsx:9`,
`relationship-list.tsx:21`, `pages/interactions.tsx:28`. The birthday widget has
therefore never displayed anything, and those person dropdowns are silently
empty. Clamp all five to 100 via a shared constant mirroring the server cap.

Known limitation, out of scope: above 100 people these pickers truncate
silently. The real fix is server-side search in the pickers, not a higher cap.

**2. Reminder `personId` is optional in the UI, required by the server.**
`reminder-form.tsx` types it optional and maps blank to `undefined`, but
`createReminderSchema` requires a UUID and `reminders.person_id` is `NOT NULL`.
Creating a reminder from Quick Actions without choosing a person always 400s.
Make the field required in the form and narrow `CreateReminderInput.personId` to
`string`.

**3. Blank optional fields cannot be cleared on edit.** `updateReminder` and
`updateInteraction` treat `undefined` as no-op, so the interaction form's "None"
channel option and blank notes/sentiment/recurrence silently fail to clear an
existing value. Verified: `PATCH {"type":"call"}` leaves `channel: "phone"`,
while `channel: null` clears it. Send `null` for intentionally-blank nullable
fields, as `person-form` already does.

Also: wrap `reminder-list.tsx`'s `handleSnooze` in try/catch — it calls
`toApiDateTime` and awaits a mutation with no error path, so both throw
uncaught.

## Part 1 — Schema

Add to `reminders`:

```
kind      text    NOT NULL DEFAULT 'generic'  CHECK (kind IN ('generic','birthday'))
lead_days integer                                 -- NULL unless kind='birthday'
```

`kind` follows the existing `reminders_status_check` idiom. Both defaults keep
every existing row and every existing client valid. Generated via
`npm run db:generate`; SQL reviewed before `db:migrate`.

## Part 2 — Backend

**`validators/reminders.ts`**
- `createReminderSchema`: add
  `kind: z.enum(['generic','birthday']).optional().default('generic')` and
  `leadDays: z.number().int().min(0).max(365).optional().nullable()`.
- `updateReminderSchema`: **must omit `kind`** — it is derived as
  `createReminderSchema.partial().omit({ personId: true })`, so adding `kind` to
  create would otherwise make it PATCH-accepted. `updateReminder` uses an
  explicit `if`-chain and would silently ignore it, which is worse than
  rejecting it. Use
  `createReminderSchema.omit({ personId: true, kind: true }).partial()`.
- `listRemindersQuerySchema`: optional `kind` filter.

Both schemas back MCP tool `inputSchema`s via `.shape`, so the MCP surface picks
`kind` and `leadDays` up automatically — intended, not incidental.

**`services/reminders.ts`**

- `createReminder` **must insert `kind` and `leadDays`.** It currently inserts an
  explicit field list (`personId, dueAt, title, notes, recurrence`), so without
  this every posted birthday reminder is stored as `generic` by the column
  default — the feature would appear to work while marking nothing, and the
  widget would never hide anything.
- `listReminders`: filter on `kind` when supplied.
- `completeReminder`: for `kind='birthday'` with a non-null `lead_days` and a
  person who still has a birthday, **recompute** the next due date instead of
  adding `P1Y`:

  ```
  Y     = UTC year of (dueAt + lead_days days)      // the birthday year this row served
  next  = Date.UTC(Y + 1, birthdayMonth - 1, birthdayDay)
          - lead_days days
          at the same UTC time-of-day as dueAt
  ```

  Fall back to the existing `addDuration(dueAt, 'P1Y')` when the person's
  birthday is null (it was removed after the reminder was made).

  Why: adding `P1Y` to a lead-time date is wrong across leap years — a Mar 1
  birthday with a 1-day lead is due Feb 28, and `+P1Y` yields Feb 28 again when
  the correct date is Feb 29. Recomputing from the person's *current* birthday
  also means the reminder self-heals if the birthday is edited later, which is
  why no birthday snapshot column is needed.
- The carry-forward must also copy `kind` and `lead_days`. It correctly does
  *not* copy `status`, `snoozedUntil`, `id` or timestamps.

Accepted residual: because the recomputed instant keeps the original UTC
time-of-day, a birthday falling near a DST transition shifts by up to an hour in
local terms across years. Storing an IANA timezone per reminder would fix that
and is deliberately rejected as over-engineering for a single-user deployment.

## Part 3 — Date computation (frontend)

`web/src/lib/birthday.ts`, dependency-free so the existing root Vitest reaches
it:

```
nextBirthdayOccurrence(birthday, now) -> Date
computeBirthdayReminderDueAt(birthday, leadDays, now) -> string   // ISO UTC
```

- `birthday` is a bare `YYYY-MM-DD`; parse the components directly rather than
  through `Date`, avoiding UTC-vs-local shifts.
- Candidate = this year's birthday at 09:00 local, minus `leadDays`.
- If the candidate is already past, recompute against next year. The test is on
  the *reminder* date, not the birthday: a birthday 3 days out with a 7-day lead
  rolls to next year rather than creating an already-overdue reminder.
- Feb 29 in a non-leap year lands on Mar 1 via JS `Date` rollover. Accepted
  rather than special-cased, and pinned by a test so it is intentional.

`nextBirthdayOccurrence` is shared with the widget, which today computes only
*this* year's date — so in December it misses a January birthday inside its own
30-day window. Sharing the helper fixes that and keeps widget and reminder
agreeing on when the next birthday falls.

## Part 4 — Form

`PersonForm` already distinguishes create from edit implicitly: `person` is
undefined at both create sites and set at both edit sites, so
`const isCreate = !person` gates the feature with no new prop.

When `isCreate` and the watched birthday field is non-empty:

```
[x] Create a yearly birthday reminder
    Remind me  [ On the day  v ]     // 1 / 3 / 7 days before
```

Clearing the birthday hides the block and creates no reminder. Needs a new
`ui/checkbox.tsx` primitive following the `input.tsx` idiom.

`PersonFormValues` gains `birthdayReminderLeadDays: number | null`, where `null`
means "do not create one".

## Part 5 — Orchestration

Two calls, since `POST /reminders` needs the new person's id. A new
`useCreatePersonWithBirthdayReminder` hook owns the sequence, used by both create
sites:

1. `POST /people`
2. if `birthdayReminderLeadDays !== null`: `POST /reminders` with
   `kind: 'birthday'`, `leadDays`, `recurrence: 'P1Y'`,
   `title: "Birthday: <name>"`
3. invalidate both `people` and `reminders` query keys

Rejected alternative: a flag on `POST /people` doing both writes in one
transaction. Atomic, and the MCP tools would get it free, but it couples the
person resource to reminders and changes a public API contract for a UI
affordance. Revisit only if birthday reminders are wanted from MCP.

Because it is not atomic, if step 1 succeeds and step 2 fails: keep the person
and show a warning toast **naming the person and the reason** — the person is the
primary intent, and deleting a just-created row to unwind a failed reminder is
worse than the inconsistency. No retry affordance: the user can add the reminder
from the person's page.

## Part 6 — Widget deferral

`BirthdayWidget` additionally queries birthday reminders and drops any person
with an **active** one.

"Active" means `status` in (`pending`, `snoozed`) — **not** any birthday reminder.
A `dismissed` reminder, or a completed non-recurring one, must not hide the
birthday forever. Since `listReminders` filters a single status, query per
status or add a multi-status filter; do not filter client-side over a capped
page, because historic `done` rows would consume the 100-row window.

Copy reflects the narrower meaning ("not tracked"), and the empty state
distinguishes "no upcoming birthdays" from "all upcoming birthdays are tracked" —
otherwise the widget going blank after adding a reminder reads as a bug.

## Testing

**`tests/birthday.test.ts`** (pure, no DB — same pattern as `crypto.test.ts`):
on-the-day; each lead value; birthday already past this year; lead pushing the
date past; Feb 29; ISO output shape.

**`tests/reminders.test.ts`** (existing integration suite):
- create defaults to `kind: 'generic'`
- create with `kind: 'birthday'` **persists and returns** `birthday` (guards the
  dropped-insert bug above)
- list filtered by `kind`
- `PATCH` does not accept `kind`
- completing a birthday reminder yields a successor that is still `birthday`,
  retains `lead_days`, and lands on the recomputed date — including the Mar 1 +
  1-day-lead leap-year case
- completing a birthday reminder whose person lost their birthday falls back to
  `P1Y`

No frontend test runner exists (`web/` has no `test` script) and this work does
not add one. Given that every bug fixed in the preceding session lived in
`web/`, that gap deserves its own discussion.

## Review findings deliberately not acted on

- **Store an IANA `timeZone` per birthday reminder.** Over-engineering for a
  single-user self-hosted deployment; see the accepted residual in Part 2.
- **Make `toApiDateTime` reject DST-gap times.** `2026-03-29T02:30` in Berlin
  does not exist and normalizing it forward to `03:30` is what calendar software
  does; throwing would be worse. Document the behaviour in a comment instead. The
  companion example, `2026-02-30`, cannot come out of a date picker.
- **A retry affordance for a failed birthday reminder.** A toast naming the
  person is enough; the reminder can be added from their page.
