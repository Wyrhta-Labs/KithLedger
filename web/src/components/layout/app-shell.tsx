import { Outlet, useRouter } from '@tanstack/react-router';
import Sidebar from './sidebar';
import TopBar from './top-bar';
import { ToastProvider } from '@/components/ui/toast';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/people': 'People',
  '/interactions': 'Interactions',
  '/reminders': 'Reminders',
  '/graph': 'Graph Explorer',
  '/settings': 'Settings',
};

export default function AppShell() {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const title = PAGE_TITLES[pathname] ?? (pathname.startsWith('/people/') ? 'Person Detail' : 'KithLedger');

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar title={title} />
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
