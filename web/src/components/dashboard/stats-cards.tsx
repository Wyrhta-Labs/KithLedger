import { Users, MessageSquare, Bell, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { usePeople } from '@/hooks/use-people';
import { useInteractions } from '@/hooks/use-interactions';
import { useReminders } from '@/hooks/use-reminders';
import { startOfMonth } from 'date-fns';

export default function StatsCards() {
  const { data: peopleData } = usePeople({ limit: 1 });
  const { data: interactionsData } = useInteractions({
    from: startOfMonth(new Date()).toISOString(),
    limit: 1,
  });
  const { data: remindersData } = useReminders({ status: 'pending', limit: 1 });

  const stats = [
    {
      label: 'Total People',
      value: peopleData?.meta?.total ?? '—',
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Interactions This Month',
      value: interactionsData?.meta?.total ?? '—',
      icon: MessageSquare,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: 'Pending Reminders',
      value: remindersData?.meta?.total ?? '—',
      icon: Bell,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50',
    },
    {
      label: 'Relationships',
      value: '—',
      icon: TrendingUp,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${stat.bg}`}>
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{String(stat.value)}</p>
                  <p className="text-xs text-gray-500">{stat.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
