import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@/features/auth/auth.types';
import { listAlerts } from '@/features/alerts/alerts.api';
import { areAlertNotificationsEnabled, playNotificationSound } from '@/shared/utils/notificationSound';
import { canAccessView, hasPermission } from '../access';
import { View } from '../dashboard.types';
import styles from '@/styles/features/dashboard/pages/Dashboard.module.css';

import logoUrl        from '@/assets/icons/insight-hub-icon.png';
import { BRAND_NAME } from '@/shared/brand';
import { BrandText } from '@/shared/components/BrandText';
import IcSearch       from '@/assets/icons/search.svg?react';
import IcThreads      from '@/assets/icons/threads.svg?react';
import IcAttachments  from '@/assets/icons/attachments.svg?react';
import IcOrgTree      from '@/assets/icons/org-tree.svg?react';
import IcAudit        from '@/assets/icons/audit.svg?react';
import IcAdmin        from '@/assets/icons/admin.svg?react';
import IcMailbox      from '@/assets/icons/mailbox.svg?react';
import IcSettings     from '@/assets/icons/settings.svg?react';

import IcActivity     from '@/assets/icons/activity.svg?react';
import IcBarChart     from '@/assets/icons/bar-chart.svg?react';
import IcBell         from '@/assets/icons/bell.svg?react';
import IcDatabase     from '@/assets/icons/database.svg?react';
import IcHome         from '@/assets/icons/home.svg?react';
import IcMail         from '@/assets/icons/mail.svg?react';
import IcChevronLeft  from '@/assets/icons/chevron-left.svg?react';
import IcChevronRight from '@/assets/icons/chevron-right.svg?react';
import IcSparkles    from '@/assets/icons/sparkles.svg?react';
import IcUsers        from '@/assets/icons/users.svg?react';

// ── Inline SVG icons for new nav items ────────────────────────────────────────

// ── Nav definition ────────────────────────────────────────────────────────────

type NavItem = {
  id: View;
  label: string;
  Icon: React.ComponentType;
  adminOnly?: boolean;
  badge?: string;
  badgeVariant?: 'default' | 'live';
};
type NavEntry = NavItem | { section: string; adminOnly?: boolean };

const NAV_ENTRIES: NavEntry[] = [
  { id: View.Overview,      label: 'Dashboard',           Icon: IcHome },

  { section: 'INTELLIGENCE' },
  { id: View.Search,        label: 'Search Intelligence', Icon: IcSearch },
  { id: View.Threads,       label: 'Threads',             Icon: IcThreads },
  { id: View.AiSummaries,   label: 'AI Summaries',        Icon: IcSparkles },
  { id: View.Attachments,   label: 'Attachments',         Icon: IcAttachments },
  { id: View.Emails,        label: 'Mails',               Icon: IcMail },

  { section: 'ORGANIZATION', adminOnly: true },
  { id: View.Departments,   label: 'Org Hierarchy',       Icon: IcOrgTree,     adminOnly: true },
  { id: View.Users,         label: 'Users',               Icon: IcUsers,       adminOnly: true },
  // Roles & Permissions lives as a tab in Admin Console (/admin-console/roles);
  // the standalone route redirects there.

  // DATA SOURCES / MONITORING / SECURITY merged into one group — the first and
  // last were single-item headings after Email Providers, SSO Settings and
  // Roles moved into the Admin Console.
  { section: 'OPERATIONS', adminOnly: true },
  { id: View.Mailboxes,     label: 'Sync Mail',           Icon: IcMailbox,     adminOnly: true },
  { id: View.Reports,       label: 'Reports',             Icon: IcBarChart,    adminOnly: true },
  { id: View.Alerts,        label: 'Alerts',              Icon: IcBell,        adminOnly: true },
  { id: View.Monitoring,    label: 'Monitoring',          Icon: IcActivity,    adminOnly: true },
  // Superadmin only — gated in access.ts, not by a permission: superadmin
  // resolves to the full admin permission set, so no permission can express it.
  { id: View.RagPipeline,   label: 'AI Search Processing', Icon: IcSparkles,   adminOnly: true },
  { id: View.Audit,         label: 'Audit Logs',          Icon: IcAudit,       adminOnly: true },
  { id: View.Admin,         label: 'Admin Console',       Icon: IcAdmin,       adminOnly: true },

  { section: 'SYSTEM' },
  { id: View.Settings,      label: 'Settings',            Icon: IcSettings },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  view: View;
  onNavigate: (v: View) => void;
  user: User | null;
  /** Drawer open state on mobile (ignored at desktop widths — see CSS). */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ view, onNavigate, user, mobileOpen = false, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(
    () => (localStorage.getItem('insight-hub-sidebar-collapsed')
      ?? localStorage.getItem('raynex-sidebar-collapsed')) === 'true'
  );
  const canManageAlerts = hasPermission(user, 'alerts.manage');

  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn:  listAlerts,
    enabled:  canManageAlerts,
  });
  const seenUnreadAlertIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!canManageAlerts || !alerts) return;

    const unreadIds = new Set(alerts.filter((a) => !a.read).map((a) => a.id));
    if (seenUnreadAlertIds.current === null) {
      seenUnreadAlertIds.current = unreadIds;
      return;
    }

    const hasNewUnreadAlert = [...unreadIds].some((id) => !seenUnreadAlertIds.current?.has(id));
    seenUnreadAlertIds.current = unreadIds;

    if (hasNewUnreadAlert && areAlertNotificationsEnabled()) {
      playNotificationSound();
    }
  }, [alerts, canManageAlerts]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('insight-hub-sidebar-collapsed', String(next));
  };

  // Esc closes the mobile drawer, matching the backdrop tap.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onMobileClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  // On mobile the drawer must close after picking a destination.
  const handleNavigate = (v: View) => {
    onNavigate(v);
    onMobileClose?.();
  };

  const canShowItem = (entry: NavItem) => canAccessView(user, entry.id);
  const sectionHasVisibleItems = (sectionIndex: number) => {
    for (let i = sectionIndex + 1; i < NAV_ENTRIES.length; i++) {
      const next = NAV_ENTRIES[i];
      if ('section' in next) return false;
      if (canShowItem(next)) return true;
    }
    return false;
  };

  return (
    <React.Fragment>
      {/* Backdrop — only visible/interactive while the mobile drawer is open. */}
      <div
        className={`${styles.sidebarBackdrop} ${mobileOpen ? styles.sidebarBackdropOpen : ''}`}
        onClick={onMobileClose}
        aria-hidden="true"
      />
      <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''} ${mobileOpen ? styles.sidebarMobileOpen : ''}`}>

        {/* Brand — logo only, centered when collapsed */}
        <div className={styles.brand}>
          <span className={styles.brandIconWrap}>
            <img src={logoUrl} alt={`${BRAND_NAME} logo`} className={styles.brandLogoImage} />
          </span>
          <BrandText className={styles.brandText} />
        </div>

        {/* Nav */}
        <nav className={styles.nav}>
          {NAV_ENTRIES.map((entry, idx) => {
            if ('section' in entry) {
              if (!sectionHasVisibleItems(idx)) return null;
              if (!entry.section) return <div key={idx} className={styles.navSectionDivider} />;
              return <div key={idx} className={styles.navSection}>{entry.section}</div>;
            }
            if (!canShowItem(entry)) return null;
            const active    = view === entry.id;
            const EntryIcon = entry.Icon;
            const badge = entry.badge;
            return (
              <button
                key={entry.id}
                className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                onClick={() => handleNavigate(entry.id)}
                title={collapsed ? entry.label : undefined}
              >
                <span className={styles.navIcon}><EntryIcon /></span>
                <span className={styles.navLabel}>{entry.label}</span>
                {badge && (
                  <span className={`${styles.navBadge} ${entry.badgeVariant === 'live' ? styles.navBadgeLive : ''}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Storage indicator */}
        <div className={styles.sidebarStorage}>
          <div className={styles.sidebarStorageHead}>
            <span className={styles.sidebarStorageIcon}><IcDatabase /></span>
            <span className={styles.sidebarStorageLabel}>Index storage</span>
            <span className={styles.sidebarStoragePct}></span>
          </div>
          <div className={styles.sidebarStorageBarTrack}>
            <div className={styles.sidebarStorageBarFill} style={{ width: '0%' }} />
          </div>
          <div className={styles.sidebarStorageMeta}>
            <span className={styles.sidebarStorageSize}></span>
            <span className={styles.sidebarStoragePlan}></span>
          </div>
        </div>

      </aside>

      {/* Floating toggle — positioned at the sidebar/topbar boundary */}
      <button
        className={`${styles.sidebarToggle} ${collapsed ? styles.sidebarToggleCollapsed : ''}`}
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <IcChevronRight /> : <IcChevronLeft />}
      </button>
    </React.Fragment>
  );
}
