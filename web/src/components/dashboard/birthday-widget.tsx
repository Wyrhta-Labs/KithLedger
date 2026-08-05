import { Link } from '@tanstack/react-router';
import { Cake } from 'lucide-react';
import { format } from 'date-fns';
import { usePeople } from '@/hooks/use-people';
import { useReminders } from '@/hooks/use-reminders';
import { MAX_LIST_LIMIT } from '@/lib/constants';
import { nextBirthdayOccurrence } from '@/lib/birthday';

const WINDOW_DAYS = 30;

export default function BirthdayWidget() {
  const { data } = usePeople({ limit: MAX_LIST_LIMIT });
  // "Tracked" means an *active* birthday reminder. Filtering by status on the
  // server matters: done/dismissed rows would otherwise consume the page window
  // and could hide a birthday permanently.
  const { data: reminderData } = useReminders({
    kind: 'birthday',
    statuses: 'pending,snoozed',
    limit: MAX_LIST_LIMIT,
  });

  const people = data?.data ?? [];
  const trackedPersonIds = new Set(
    (reminderData?.data ?? []).map((r) => r.personId).filter((id): id is string => !!id)
  );

  const now = new Date();
  const windowEnd = now.getTime() + WINDOW_DAYS * 86_400_000;

  // nextBirthdayOccurrence is shared with the reminder logic, so the widget and
  // any generated reminder agree on when the next birthday falls — and it wraps
  // the year correctly, which the previous same-year calculation did not (a
  // January birthday seen in December fell outside the window).
  const upcoming = people
    .filter((p) => p.birthday && !trackedPersonIds.has(p.id))
    .map((p) => ({ person: p, next: nextBirthdayOccurrence(p.birthday!, now) }))
    .filter(({ next }) => next.getTime() <= windowEnd)
    .sort((a, b) => a.next.getTime() - b.next.getTime());

  if (upcoming.length === 0) {
    // Distinguish "nothing coming up" from "everything coming up is already
    // tracked", so the list going empty after adding a reminder does not read
    // as a bug.
    return (
      <div data-testid="birthday-widget" className="text-sm text-gray-500">
        {trackedPersonIds.size > 0
          ? `No untracked birthdays in the next ${WINDOW_DAYS} days — the rest have reminders.`
          : `No upcoming birthdays in the next ${WINDOW_DAYS} days.`}
      </div>
    );
  }

  return (
    <div data-testid="birthday-widget" className="space-y-2">
      {upcoming.map(({ person, next }) => (
        <div
          key={person.id}
          className="flex items-center gap-3 p-3 rounded-lg border border-purple-100 bg-purple-50 text-sm"
        >
          <Cake className="h-4 w-4 text-purple-500 shrink-0" />
          <div className="flex-1">
            <Link
              to="/people/$id"
              params={{ id: person.id }}
              className="font-medium text-gray-900 hover:underline"
            >
              {person.name}
            </Link>
          </div>
          <span className="text-xs text-gray-500">{format(next, 'MMM d')}</span>
        </div>
      ))}
    </div>
  );
}
