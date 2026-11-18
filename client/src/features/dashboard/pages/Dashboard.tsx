import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/useAuth';
import { canAccessView } from '../access';
import { ViewActiveContext } from '../viewActive';
import { View, VIEW_META, resolveViewParam, viewPath } from '../dashboard.types';
import { Sidebar, Topbar } from '../components';
import {
  OverviewView, EmailsView, ThreadsView, AttachmentsView,
  AISummariesView, UsersView, OrgsView, AlertsView, ReportsView,
  MonitoringView, RagPipelineView, AdminConsoleView, AuditLogView, MailboxesView,
  EmailProviderView, SettingsView, ComingSoonView,
} from '../views';
import { OrgHierarchyView } from '@/features/org-hierarchy/OrgHierarchyView';
import { Chat } from '@/features/chat/pages/Chat';
import styles from '@/styles/features/dashboard/pages/Dashboard.module.css';

export { View, ServiceStatus } from '../dashboard.types';

// ─── Content router ───────────────────────────────────────────────────────────

function renderView(view: View) {
  switch (view) {
    // Shared views (all roles)
    case View.Overview:     return <OverviewView />;
    case View.Search:       return <Chat />;
    case View.Emails:       return <EmailsView />;
    case View.Threads:      return <ThreadsView />;
    case View.Attachments:  return <AttachmentsView />;
    case View.AiSummaries:  return <AISummariesView />;
    case View.Settings:     return <SettingsView />;

    // Admin-only views
    case View.Users:        return <UsersView />;
    case View.Orgs:         return <OrgsView />;
    case View.Departments:  return <OrgHierarchyView />;
    // Roles is a tab inside Admin Console now; keep /roles working for links.
    case View.Roles:        return <Navigate to={`${viewPath(View.Admin)}/roles`} replace />;
    case View.Alerts:       return <AlertsView />;
    case View.Reports:      return <ReportsView />;
    case View.Monitoring:   return <MonitoringView />;
    case View.RagPipeline:  return <RagPipelineView />;
    case View.Audit:        return <AuditLogView />;
    case View.Admin:        return <AdminConsoleView />;
    case View.Mailboxes:    return <MailboxesView />;
    // SSO now lives as a tab inside the Admin Console; /sso-settings is kept as
    // a redirect so existing links and bookmarks still land in the right place.
    case View.Oidc:           return <Navigate to={`${viewPath(View.Admin)}/sso`} replace />;
    case View.EmailProvider:  return <EmailProviderView />;
    // Sync config was merged into the Mailboxes page; keep rendering it for
    // old links while the redirect effect below fixes the URL.
    case View.Sync:           return <MailboxesView />;
    default:
      return <ComingSoonView title="Coming soon" phase="Future phase" description="This feature is not yet available." bullets={[]} />;
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

interface DashboardProps {
  viewOverride?: View;
}

export function Dashboard({ viewOverride }: DashboardProps) {
  const { view: viewParam } = useParams<{ view: string }>();
  const view = viewOverride ?? resolveViewParam(viewParam);

  const { user } = useAuth();
  const navigate = useNavigate();

  // Canonicalize any legacy /dashboard/:view links that still reach this shell.
  useEffect(() => {
    if (!viewOverride && viewParam && viewPath(view) !== `/dashboard/${viewParam}`) {
      navigate(viewPath(view), { replace: true });
    }
  }, [navigate, view, viewOverride, viewParam]);

  const canAccessCurrentView = canAccessView(user, view);

  const handleNavigate = (v: View) => navigate(viewPath(v));

  const effectiveView = view;
  const [visitedViews, setVisitedViews] = useState<View[]>(() => [effectiveView]);
  const mountedViews = useMemo(
    () => visitedViews.includes(effectiveView) ? visitedViews : [...visitedViews, effectiveView],
    [effectiveView, visitedViews]
  );
  const contentRef = useRef<HTMLElement | null>(null);
  const activeViewRef = useRef(effectiveView);
  const scrollByViewRef = useRef<Partial<Record<View, number>>>({});

  // Mobile nav is a drawer: the sidebar is off-canvas below the breakpoint and
  // this opens it. Always closed on navigation so it never lingers over content.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { setMobileNavOpen(false); }, [effectiveView]);

  useEffect(() => {
    setVisitedViews((prev) => prev.includes(effectiveView) ? prev : [...prev, effectiveView]);
  }, [effectiveView]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const previousView = activeViewRef.current;
    if (!content || previousView === effectiveView) return;

    scrollByViewRef.current[previousView] = content.scrollTop;
    activeViewRef.current = effectiveView;

    const nextScrollTop = scrollByViewRef.current[effectiveView] ?? 0;
    const frame = window.requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.scrollTop = nextScrollTop;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [effectiveView]);

  const meta = VIEW_META[effectiveView] ?? VIEW_META[View.Overview];

  return (
    <div className={styles.layout}>
      <Sidebar
        view={effectiveView}
        onNavigate={handleNavigate}
        user={user}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className={styles.mainWrap}>
        <Topbar title={meta.title} subtitle={meta.subtitle} onMenuClick={() => setMobileNavOpen(true)} />

        <main
          ref={contentRef}
          className={`${styles.content} ${effectiveView === View.Search ? styles.contentFixed : ''}`}
        >
          {!canAccessCurrentView ? (
            <ComingSoonView
              title="Access Restricted"
              phase="Permission required"
              description="This section is not included in your assigned role."
              bullets={['Contact your platform administrator to request access']}
            />
          ) : (
            mountedViews.map((mountedView) => {
              if (!canAccessView(user, mountedView)) return null;

              const isActive = mountedView === effectiveView;
              return (
                <section
                  key={mountedView}
                  className={`${styles.viewPane} ${mountedView === View.Search ? styles.viewPaneFixed : ''} ${isActive ? '' : styles.viewPaneHidden}`}
                  aria-hidden={!isActive}
                >
                  {/* Views stay mounted when hidden, so they need to know
                      when they've been navigated away from in order to clear
                      transient state like search terms (see useResetOnHide). */}
                  <ViewActiveContext.Provider value={isActive}>
                    {renderView(mountedView)}
                  </ViewActiveContext.Provider>
                </section>
              );
            })
          )}
        </main>
      </div>
    </div>
  );
}
