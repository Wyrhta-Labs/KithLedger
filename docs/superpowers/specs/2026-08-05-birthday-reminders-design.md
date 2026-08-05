# Birthday reminders — design

**Date:** 2026-08-05
**Status:** approved (pending spec review)

## Goal

When adding a person with a birthday, offer to create a recurring yearly
reminder for that birthday. The dashboard's birthday widget then defers to
reminders: it lists only birthdays that are *not* yet tracked by one.

## Decisions

| Question | Decision |
|---|---|
| Where does the checkbox appear? | Add Person only — never in the edit dialogs |
| Default state | Checked, whenever a birthday is set |
| Lead time | Selectable in the modal: on the day (default), 1, 3 or 7 days before |
| Time of day | 09:00 local |
| Recurrence | `P1Y` — completing it rolls to next year |
| Widget behaviour | Hides birthdays that already have a birthday reminder |
| Birthday-reminder marker | New `kind` column on `reminders` |

## Prerequisite: six broken list requests

`listPeopleQuerySchema` caps `limit` at 100, but six components request
`limit: 200`, so every one of those requests returns 400:

- `birthday-widget.tsx` — always renders "No upcoming birthdays"
- `quick-actions.tsx`, `recent-interactions.tsx`, `relationship-list.tsx`,
  `interactions.tsx` — person dropdowns silently empty

Clamp all six to 100. This must land first: the widget cannot defer to anything
while its only request fails.

Known limitation, out of scope: above 100 people these dropdowns truncate
silently. The real fix is server-side search or pagination in the pickers, not a
higher cap.

## Part 1 — Schema

Add to `reminders`:

```
kind text NOT NULL DEFAULT 'generic'
CHECK (kind IN ('generic', 'birthday'))
```

Follows the existing `reminders_status_check` idiom. Default keeps every current
row and every existing client valid. Generated with `npm run db:generate`, SQL
reviewed before `db:migrate`.

## Part 2 — Backend

**`validators/reminders.ts`**
- `createReminderSchema`: `kind: z.enum(['generic','birthday']).optional().default('generic')`
- `listRemindersQuerySchema`: optional `kind` filter

Both schemas back MCP tool `inputSchema`s via `.shape`, so the MCP surface picks
`kind` up for free — intended, not incidental.

**`services/reminders.ts`**
- `listReminders`: filter on `kind` when supplied.
- `completeReminder`: **must copy `kind` to the next occurrence.** It currently
  copies only `personId`, `dueAt`, `title`, `notes`, `recurrence`. Without this,
  completing a birthday reminder produces a `generic` successor, the widget stops
  recognising it, and the birthday reappears as untracked every year.

## Part 3 — Date computation

`web/src/lib/birthday.ts`, dependency-free so the existing root Vitest can reach
it:

```
nextBirthdayOccurrence(birthday, now) -> Date
computeBirthdayReminderDueAt(birthday, leadDays, now) -> string  // ISO UTC
```

- `birthday` is a bare `YYYY-MM-DD`; parse the numbers directly rather than
  through `Date`, avoiding UTC-vs-local shifts.
- Candidate = this year's birthday at 09:00 local, minus `leadDays`.
- If the candidate is already past, recompute against next year. The test is on
  the *reminder* date, not the birthday: a birthday 3 days out with a 7-day lead
  rolls to next year rather than creating an already-overdue reminder.
- Feb 29 in a non-leap year lands on Mar 1 via JS `Date` rollover. Accepted
  rather than special-cased, and pinned by a test so it is intentional.

`nextBirthdayOccurrence` is shared with the widget, which today computes only
*this* year's date — so in December it misses a January birthday inside its
30-day window. Sharing the helper fixes that and keeps widget and reminder
agreeing on when the next birthday is.

## Part 4 — Form

`PersonForm` already distinguishes create from edit implicitly: `person` is
undefined at both create sites and set at both edit sites, so `const isCreate =
!person` gates the feature with no new prop.

When `isCreate` and the watched birthday field is non-empty:

```
[x] Create a yearly birthday reminder
    Remind me  [ On the day  v ]
```

Clearing the birthday hides the block and creates no reminder. Requires a new
`ui/checkbox.tsx` primitive following the `input.tsx` idiom.

`PersonFormValues` gains `birthdayReminderLeadDays: number | null`, where `null`
means "do not create one".

## Part 5 — Orchestration

Two calls, since `POST /reminders` needs the new person's id. A new
`useCreatePersonWithBirthdayReminder` hook owns the sequence and is used by both
create sites:

1. `POST /people`
2. if `birthdayReminderLeadDays !== null`: `POST /reminders` with
   `kind: 'birthday'`, `recurrence: 'P1Y'`, `title: "Birthday: <name>"`
3. invalidate both `people` and `reminders` query keys

Rejected alternative: a flag on `POST /people` doing both writes in one
transaction. It would be atomic and would give the MCP tools the same
convenience, but it couples the person resource to reminders and changes a
public API contract for a UI affordance. Revisit only if birthday reminders are
wanted from MCP.

Because it is not atomic, if step 1 succeeds and step 2 fails: keep the person
and show a warning toast naming the reason. Deleting a just-created person to
undo a failed reminder is worse than the inconsistency.

## Part 6 — Widget deferral

`BirthdayWidget` additionally queries `useReminders({ kind: 'birthday', limit:
100 })` and drops any person whose id appears in that result. Copy reflects the
narrower meaning ("not tracked"), and the empty state distinguishes "no upcoming
birthdays" from "all upcoming birthdays are tracked" — otherwise the widget
going blank after adding a reminder reads as a bug.

## Testing

**`tests/birthday.test.ts`** (pure, no DB — same pattern as `crypto.test.ts`):
on-the-day; each lead value; birthday already past this year; lead pushing the
date past; Feb 29; ISO output shape.

**`tests/reminders.test.ts`** (existing integration suite): create defaults to
`kind: 'generic'`; create with `kind: 'birthday'`; list filtered by `kind`;
completing a birthday reminder yields a successor that is still `birthday`.

No frontend test runner exists (`web/` has no `test` script) and this work does
not add one. Given that every bug fixed in the preceding session lived in
`web/`, that gap deserves its own discussion.
