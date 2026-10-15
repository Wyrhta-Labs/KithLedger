import { Link, useRouterState } from '@tanstack/react-router';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Bell,
  GitBranch,
  Settings,
  BookHeart,
  LogOut,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import type { NavCountKey, NavCounts } from '@/hooks/use-nav-counts';

export type NavGroup = 'ledger' | 'system';

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  group: NavGroup;
  /** Which nav count badge this item shows, if any (hooks/use-nav-counts.ts). */
  count?: NavCountKey;
  exact?: boolean;
}

export const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'ledger', exact: true },
  { to: '/people', label: 'People', icon: Users, group: 'ledger' },
  { to: '/interactions', label: 'Interactions', icon: MessageSquare, group: 'ledger' },
  { to: '/reminders', label: 'Reminders', icon: Bell, group: 'ledger', count: 'reminders' },
  { to: '/graph', label: 'Graph', icon: GitBranch, group: 'ledger' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'system' },
];

const GROUPS: Array<{ group: NavGroup; label: string }> = [
  { group: 'ledger', label: 'Ledger' },
  { group: 'system', label: 'System' },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** A count pill; nothing for zero or an unknown count. */
export function NavBadge({ count, className }: { count: number | undefined; className?: string }) {
  if (!count) return null;
  return (
    <span
      data-nav-badge
      aria-label={`${count} due`}
      className={cn('min-w-5 rounded-full bg-primary px-[7px] text-center text-[11px] font-bold tabular-nums text-on-primary', className)}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Below 1100px the sidebar collapses to a 64px icon rail. */
export default function Sidebar({ counts = {} }: { counts?: NavCounts }) {
  // useRouterState (not useRouter().state) — only the former subscribes to
  // router state, and the shell above us does not re-render on navigation.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { logout } = useAuth();

  return (
    <aside className={cn(
      'flex h-dvh w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto bg-nav px-2.5 py-3.5 text-nav-fg',
      'max-[1100px]:w-16',
    )}>
      <div className={cn('flex items-center gap-2.5 px-2 pb-4 pt-1', 'max-[1100px]:justify-center max-[1100px]:px-0')}>
        <span className="grid size-[30px] shrink-0 place-items-center rounded-card bg-primary text-on-primary">
          <BookHeart className="size-[17px]" aria-hidden="true" />
        </span>
        <span className={cn('text-base font-extrabold tracking-[-0.2px]', 'max-[1100px]:hidden')}>KithLedger</span>
      </div>
      <nav className="flex flex-col gap-0.5">
        {GROUPS.map(({ group, label: groupLabel }) => (
          <div key={group} data-nav-group={group} className="flex flex-col gap-0.5">
            <div className={cn('px-2.5 pb-1 pt-3.5 text-[10.5px] font-bold uppercase tracking-[0.7px] text-nav-muted', 'max-[1100px]:hidden')}>
              {groupLabel}
            </div>
            {navItems.filter((i) => i.group === group).map((item) => {
              const { to, label, icon: Icon } = item;
              const active = isNavItemActive(item, pathname);
              const count = item.count ? counts[item.count] : undefined;
              return (
                <Link
                  key={to}
                  to={to}
                  title={label}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left font-medium transition-colors hover:bg-nav-hover',
                    active && 'bg-nav-active font-[650]',
                    'max-[1100px]:justify-center max-[1100px]:px-0 max-[1100px]:py-2.5',
                  )}
                >
                  <Icon className="size-[17px] shrink-0 opacity-85" aria-hidden="true" />
                  <span className={cn('flex-1', 'max-[1100px]:hidden')}>{label}</span>
                  <NavBadge count={count} className="max-[1100px]:absolute max-[1100px]:right-1 max-[1100px]:top-0.5 max-[1100px]:min-w-4 max-[1100px]:px-[5px] max-[1100px]:text-[9.5px]" />
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-h-3 flex-1" />
      <div className={cn('flex items-center gap-2.5 border-t border-nav-active px-2 pb-0.5 pt-2.5', 'max-[1100px]:flex-col max-[1100px]:px-0')}>
        <div className="flex min-w-0 flex-1 items-center gap-2.5" title="Admin">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-nav-active text-nav-fg">
            <User className="size-3.5" aria-hidden="true" />
          </span>
          <span className={cn('min-w-0 truncate text-[12.5px]', 'max-[1100px]:hidden')}>Admin</span>
        </div>
        <button type="button" onClick={logout} title="Log out" aria-label="Log out"
          className="grid size-8 shrink-0 place-items-center rounded-md text-nav-muted hover:bg-nav-hover hover:text-nav-fg">
          <LogOut className="size-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
