import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRoute,
  createRootRoute,
  RouterProvider,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AuthProvider } from './hooks/use-auth';
import AppShell from './components/layout/app-shell';
import LoginPage from './pages/login';
import DashboardPage from './pages/dashboard';
import PeoplePage from './pages/people';
import PersonPage from './pages/person';
import InteractionsPage from './pages/interactions';
import RemindersPage from './pages/reminders';
import GraphPage from './pages/graph';
import SettingsPage from './pages/settings';
import ProfilePage from './pages/profile';
import ChangelogPage from './pages/changelog';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// Root route — just renders an Outlet
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// Login route (unauthenticated)
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

// Authenticated layout route
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  beforeLoad: ({ location }) => {
    if (!localStorage.getItem('kith_jwt')) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: AppShell,
});

const dashboardRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/',
  component: DashboardPage,
});

const peopleRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/people',
  component: PeoplePage,
});

const personRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/people/$id',
  component: PersonPage,
});

const interactionsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/interactions',
  component: InteractionsPage,
});

const remindersRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/reminders',
  component: RemindersPage,
});

const graphRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/graph',
  component: GraphPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/settings',
  component: SettingsPage,
});

const profileRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/profile',
  component: ProfilePage,
});

const changelogRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/changelog',
  component: ChangelogPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authRoute.addChildren([
    dashboardRoute,
    peopleRoute,
    personRoute,
    interactionsRoute,
    remindersRoute,
    graphRoute,
    settingsRoute,
    profileRoute,
    changelogRoute,
  ]),
]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthProvider>
  );
}
