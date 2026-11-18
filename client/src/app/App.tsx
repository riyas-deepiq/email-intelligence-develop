import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@/app/theme/ThemeProvider';
import { AuthProvider } from '@/features/auth/AuthContext';
import {
  ROUTED_VIEWS,
  VIEW_ROUTES,
  View,
  resolveViewParam,
  viewPath,
} from '@/features/dashboard/dashboard.types';
import { Footer } from '@/shared/components/Footer';
import { Navbar } from '@/shared/components/Navbar';
import { ProtectedRoute } from '@/shared/components/ProtectedRoute';
import { Spinner } from '@/shared/components/Spinner';
import { Toaster } from '@/shared/toast/Toaster';
import { ToastProvider } from '@/shared/toast/ToastProvider';

const AcceptInvite = lazy(() =>
  import('@/features/auth/pages/AcceptInvite').then((module) => ({ default: module.AcceptInvite })),
);
const About = lazy(() =>
  import('@/features/marketing/pages/About').then((module) => ({ default: module.About })),
);
const Contact = lazy(() =>
  import('@/features/marketing/pages/Contact').then((module) => ({ default: module.Contact })),
);
const Dashboard = lazy(() =>
  import('@/features/dashboard/pages/Dashboard').then((module) => ({ default: module.Dashboard })),
);
const ForgotPassword = lazy(() =>
  import('@/features/auth/pages/ForgotPassword').then((module) => ({
    default: module.ForgotPassword,
  })),
);
const Login = lazy(() =>
  import('@/features/auth/pages/Login').then((module) => ({ default: module.Login })),
);
const OidcCallback = lazy(() =>
  import('@/features/auth/pages/OidcCallback').then((module) => ({ default: module.OidcCallback })),
);
const ResetPassword = lazy(() =>
  import('@/features/auth/pages/ResetPassword').then((module) => ({
    default: module.ResetPassword,
  })),
);
const Setup = lazy(() =>
  import('@/features/auth/pages/Setup').then((module) => ({ default: module.Setup })),
);

const FULLSCREEN_PATHS = [
  '/login',
  '/setup',
  '/auth/callback',
  '/forgot-password',
  '/reset-password',
  '/accept-invite',
];

const LEGACY_ROUTE_REDIRECTS: Record<string, string> = {
  '/chat': viewPath(View.Search),
  '/emails': viewPath(View.Emails),
  '/mail': viewPath(View.Emails),
  '/mailboxes': viewPath(View.Mailboxes),
  '/sync': viewPath(View.Mailboxes),
  '/departments': viewPath(View.Departments),
  '/org-tree': viewPath(View.Departments),
  '/email-provider': viewPath(View.EmailProvider),
  '/providers': viewPath(View.EmailProvider),
  '/oidc': viewPath(View.Oidc),
  '/sso': viewPath(View.Oidc),
  '/audit': viewPath(View.Audit),
  '/admin': viewPath(View.Admin),
  '/admin/mailboxes': viewPath(View.Mailboxes),
  '/admin/sync': viewPath(View.Mailboxes),
  '/admin/org': viewPath(View.Departments),
  '/admin/audit': viewPath(View.Audit),
  '/admin/policy': `${viewPath(View.Settings)}?tab=security`,
  '/admin/sso': viewPath(View.Oidc),
  '/admin/metering': viewPath(View.Reports),
};

const LEGACY_ROUTE_REDIRECT_ENTRIES = Object.entries(LEGACY_ROUTE_REDIRECTS).sort(
  ([a], [b]) => b.length - a.length,
);

function isShellRoute(pathname: string): boolean {
  return (
    ROUTED_VIEWS.some((view) => {
      const path = VIEW_ROUTES[view];
      return pathname === path || pathname.startsWith(`${path}/`);
    }) ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/admin') ||
    pathname === '/chat'
  );
}

function legacyRedirectTarget(pathname: string): string | undefined {
  const exactTarget = LEGACY_ROUTE_REDIRECTS[pathname];
  if (exactTarget) return exactTarget;

  const prefixedMatch = LEGACY_ROUTE_REDIRECT_ENTRIES.find(([from]) =>
    pathname.startsWith(`${from}/`),
  );
  return prefixedMatch?.[1];
}

function preserveUrlSuffix(target: string, search: string, hash: string): string {
  return `${target}${target.includes('?') ? '' : search}${hash}`;
}

function resolveShellView(pathname: string): View {
  for (const view of ROUTED_VIEWS) {
    const path = VIEW_ROUTES[view];
    if (pathname === path) return view;
    if (path !== viewPath(View.Overview) && pathname.startsWith(`${path}/`)) return view;
  }

  if (pathname.startsWith('/dashboard/')) {
    const [, , viewParam] = pathname.split('/');
    return resolveViewParam(viewParam);
  }

  return View.Overview;
}

function DashboardShell() {
  const location = useLocation();
  const redirectTarget = legacyRedirectTarget(location.pathname);

  if (redirectTarget) {
    return (
      <Navigate to={preserveUrlSuffix(redirectTarget, location.search, location.hash)} replace />
    );
  }

  return (
    <ProtectedRoute>
      <Dashboard viewOverride={resolveShellView(location.pathname)} />
    </ProtectedRoute>
  );
}

function AppLayout() {
  const location = useLocation();
  const isFullscreen =
    FULLSCREEN_PATHS.includes(location.pathname) || isShellRoute(location.pathname);

  return (
    <AuthProvider>
      <div className="app">
        {!isFullscreen && <Navbar />}
        <main className={isFullscreen ? 'auth-content' : 'main-content'}>
          <Suspense fallback={<Spinner size="lg" />}>
            {isShellRoute(location.pathname) ? (
              <DashboardShell />
            ) : (
              <Routes>
                <Route path="/" element={<Navigate to="/login" replace />} />
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/accept-invite" element={<AcceptInvite />} />
                <Route path="/auth/callback" element={<OidcCallback />} />
                <Route path="/setup" element={<Setup />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            )}
          </Suspense>
        </main>
        {!isFullscreen && <Footer />}
      </div>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ThemeProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppLayout />
        </BrowserRouter>
      </ThemeProvider>
      <Toaster />
    </ToastProvider>
  );
}
