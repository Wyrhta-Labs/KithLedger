import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, LogOut, ScrollText, User } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { BreadcrumbItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';

interface TopBarProps {
  breadcrumbs: BreadcrumbItem[];
}

export default function TopBar({ breadcrumbs }: TopBarProps) {
  const { logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [menuOpen]);

  return (
    <header className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3">
      <div className="min-w-0">
        <nav className="flex items-center gap-1 overflow-x-auto text-xs text-gray-500">
          {breadcrumbs.map((crumb, index) => (
            <div key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : null}
              {crumb.to ? (
                <Link to={crumb.to} className="whitespace-nowrap transition-colors hover:text-gray-900">
                  {crumb.label}
                </Link>
              ) : (
                <span className="whitespace-nowrap text-gray-900">{crumb.label}</span>
              )}
            </div>
          ))}
        </nav>
      </div>

      <div className="relative flex items-center" ref={menuRef}>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900',
            menuOpen && 'bg-gray-100 text-gray-900'
          )}
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <User className="h-4 w-4" />
          <span>Admin</span>
          <ChevronDown className="h-4 w-4" />
        </button>

        {menuOpen ? (
          <div className="absolute right-0 top-full z-20 mt-2 w-44 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
            <Link
              to="/profile"
              className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
              onClick={() => setMenuOpen(false)}
            >
              <User className="mr-2 h-4 w-4" />
              Profile
            </Link>
            <Link
              to="/changelog"
              className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
              onClick={() => setMenuOpen(false)}
            >
              <ScrollText className="mr-2 h-4 w-4" />
              Changelog
            </Link>
            <button
              type="button"
              className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
              onClick={logout}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
