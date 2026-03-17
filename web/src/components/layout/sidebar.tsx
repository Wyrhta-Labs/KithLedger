import { Link, useRouter } from '@tanstack/react-router';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Bell,
  GitBranch,
  Settings,
  BookHeart,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/people', label: 'People', icon: Users },
  { to: '/interactions', label: 'Interactions', icon: MessageSquare },
  { to: '/reminders', label: 'Reminders', icon: Bell },
  { to: '/graph', label: 'Graph', icon: GitBranch },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = router.state.location.pathname;

  return (
    <aside className="flex flex-col w-60 min-h-screen bg-gray-900 text-white">
      <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-700">
        <BookHeart className="h-6 w-6 text-blue-400" />
        <span className="font-bold text-lg">KithLedger</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ to, label, icon: Icon, exact }) => {
          const isActive = exact ? pathname === to : pathname.startsWith(to) && to !== '/';
          const isDash = to === '/' && pathname === '/';
          const active = isActive || isDash;
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
