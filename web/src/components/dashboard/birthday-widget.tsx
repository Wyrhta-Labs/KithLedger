import { Link } from '@tanstack/react-router';
import { Cake } from 'lucide-react';
import { usePeople } from '@/hooks/use-people';
import { format, parseISO, setYear } from 'date-fns';
import { isUpcomingInDays } from '@/lib/format';
import { MAX_LIST_LIMIT } from '@/lib/constants';

export default function BirthdayWidget() {
  const { data } = usePeople({ limit: MAX_LIST_LIMIT });
  const people = data?.data ?? [];

  const upcoming = people
    .filter((p) => p.birthday && isUpcomingInDays(
      setYear(parseISO(p.birthday), new Date().getFullYear()).toISOString(),
      30
    ))
    .sort((a, b) => {
      const aDate = setYear(parseISO(a.birthday!), new Date().getFullYear());
      const bDate = setYear(parseISO(b.birthday!), new Date().getFullYear());
      return aDate.getTime() - bDate.getTime();
    });

  if (upcoming.length === 0) {
    return <div className="text-sm text-gray-500">No upcoming birthdays in the next 30 days.</div>;
  }

  return (
    <div className="space-y-2">
      {upcoming.map((p) => {
        const bday = setYear(parseISO(p.birthday!), new Date().getFullYear());
        return (
          <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-purple-100 bg-purple-50 text-sm">
            <Cake className="h-4 w-4 text-purple-500 shrink-0" />
            <div className="flex-1">
              <Link to="/people/$id" params={{ id: p.id }} className="font-medium text-gray-900 hover:underline">
                {p.name}
              </Link>
            </div>
            <span className="text-xs text-gray-500">{format(bday, 'MMM d')}</span>
          </div>
        );
      })}
    </div>
  );
}
