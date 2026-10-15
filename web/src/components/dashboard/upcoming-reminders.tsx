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
        <div className="text-sm text-muted">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-sm text-muted">No pending reminders.</div>
      ) : (
        sorted.map((r) => {
          const overdue = isOverdue(r.dueAt);
          const today = isDueToday(r.dueAt);
          return (
            <div
              key={r.id}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border text-sm',
                overdue ? 'border-danger-border bg-danger-bg' : today ? 'border-warning-border bg-warning-bg' : 'border-line bg-surface-2'
              )}
            >
              {overdue ? (
                <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
              ) : (
                <Bell className="h-4 w-4 text-faint shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className={cn('font-medium truncate', overdue && 'text-danger', today && 'text-warning')}>
                  {r.title}
                </p>
                <p className="text-xs text-muted mt-0.5">{formatDateTime(r.dueAt)}</p>
              </div>
              {overdue && <Badge variant="destructive" className="shrink-0">Overdue</Badge>}
              {today && !overdue && <Badge variant="warning" className="shrink-0">Today</Badge>}
            </div>
          );
        })
      )}
      <Link to="/reminders" className="text-xs text-primary hover:underline">
        View all reminders →
      </Link>
    </div>
  );
}
