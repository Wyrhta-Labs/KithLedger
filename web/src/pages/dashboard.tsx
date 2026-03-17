import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import StatsCards from '@/components/dashboard/stats-cards';
import UpcomingReminders from '@/components/dashboard/upcoming-reminders';
import RecentInteractions from '@/components/dashboard/recent-interactions';
import BirthdayWidget from '@/components/dashboard/birthday-widget';
import QuickActions from '@/components/dashboard/quick-actions';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <StatsCards />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Upcoming Reminders</CardTitle>
            </CardHeader>
            <CardContent>
              <UpcomingReminders />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Interactions</CardTitle>
            </CardHeader>
            <CardContent>
              <RecentInteractions />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Upcoming Birthdays</CardTitle>
            </CardHeader>
            <CardContent>
              <BirthdayWidget />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <QuickActions />
        </CardContent>
      </Card>
    </div>
  );
}
