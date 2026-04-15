export interface NavItem {
  to: string;
  label: string;
  exact?: boolean;
}

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', exact: true },
  { to: '/people', label: 'People' },
  { to: '/interactions', label: 'Interactions' },
  { to: '/reminders', label: 'Reminders' },
  { to: '/graph', label: 'Graph Explorer' },
  { to: '/settings', label: 'Settings' },
];

const BREADCRUMB_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/changelog': 'Changelog',
  '/people': 'People',
  '/people/$id': 'Person Detail',
  '/interactions': 'Interactions',
  '/reminders': 'Reminders',
  '/graph': 'Graph Explorer',
  '/settings': 'Settings',
  '/profile': 'Profile',
};

export function getPageTitle(pathname: string) {
  if (pathname.startsWith('/people/')) return BREADCRUMB_LABELS['/people/$id'];
  return BREADCRUMB_LABELS[pathname] ?? 'KithLedger';
}

export function getBreadcrumbs(pathname: string): BreadcrumbItem[] {
  if (pathname === '/') {
    return [{ label: BREADCRUMB_LABELS['/'] }];
  }

  const segments = pathname.split('/').filter(Boolean);
  const breadcrumbs: BreadcrumbItem[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const href = `/${segments.slice(0, index + 1).join('/')}`;
    const isLast = index === segments.length - 1;
    const label =
      BREADCRUMB_LABELS[href] ??
      (href.startsWith('/people/') ? BREADCRUMB_LABELS['/people/$id'] : toTitleCase(segments[index]));

    breadcrumbs.push({
      label,
      to: isLast ? undefined : href,
    });
  }

  return breadcrumbs;
}

function toTitleCase(value: string) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
