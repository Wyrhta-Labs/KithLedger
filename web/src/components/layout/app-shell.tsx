import { Outlet, useLocation } from '@tanstack/react-router';
import Sidebar from './sidebar';
import TopBar from './top-bar';
import { ToastProvider } from '@/components/ui/toast';
import { getBreadcrumbs } from '@/lib/navigation';

export default function AppShell() {
  const { pathname } = useLocation();
  const breadcrumbs = getBreadcrumbs(pathname);

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar breadcrumbs={breadcrumbs} />
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
