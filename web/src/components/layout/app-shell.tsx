import { useEffect, useRef } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import Sidebar from './sidebar';
import TopBar from './top-bar';
import { ToastProvider } from '@/components/ui/toast';
import { SCROLL_ROOT_ATTR } from '@/components/ui/dialog';
import { useNavCounts } from '@/hooks/use-nav-counts';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/people': 'People',
  '/interactions': 'Interactions',
  '/reminders': 'Reminders',
  '/graph': 'Graph Explorer',
  '/settings': 'Settings',
};

export default function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = PAGE_TITLES[pathname] ?? (pathname.startsWith('/people/') ? 'Person Detail' : 'KithLedger');
  const mainRef = useRef<HTMLElement>(null);
  const counts = useNavCounts();

  // <main> is the page's scroller (the shell is viewport-high), so the
  // router's window scroll restoration does not reach it: start each page at the top.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    <ToastProvider>
      <div className="flex h-dvh overflow-hidden bg-ground">
        <Sidebar counts={counts} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TopBar title={title} />
          <main
            ref={mainRef}
            {...{ [SCROLL_ROOT_ATTR]: '' }}
            className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5"
          >
            <Outlet />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
