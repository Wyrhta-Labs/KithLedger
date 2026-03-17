import { Link } from '@tanstack/react-router';
import { Bell, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useReminders } from '@/hooks/use-reminders';
import { formatDateTime, isOverdue, isDueToday } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function UpcomingReminders() {
  const { data, isLoading } = useReminders({ status: 'pending', limit: 8 });
  const reminders = data?.data ?? [];

  const sorted = [...reminders].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  return (
    <div className="space-y-2">
      {isLoading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-sm text-gray-500">No pending reminders.</div>
      ) : (
        sorted.map((r) => {
          const overdue = isOverdue(r.dueAt);
          const today = isDueToday(r.dueAt);
          return (
            <div
              key={r.id}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border text-sm',
                overdue ? 'border-red-200 bg-red-50' : today ? 'border-yellow-200 bg-yellow-50' : 'border-gray-100 bg-gray-50'
              )}
            >
              {overdue ? (
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              ) : (
                <Bell className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className={cn('font-medium truncate', overdue && 'text-red-800', today && 'text-yellow-800')}>
                  {r.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(r.dueAt)}</p>
              </div>
              {overdue && <Badge variant="destructive" className="shrink-0">Overdue</Badge>}
              {today && !overdue && <Badge variant="warning" className="shrink-0">Today</Badge>}
            </div>
          );
        })
      )}
      <Link to="/reminders" className="text-xs text-blue-600 hover:underline">
        View all reminders →
      </Link>
    </div>
  );
}
