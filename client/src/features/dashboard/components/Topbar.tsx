import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { useTheme } from '@/app/theme/useTheme';
import { apiClient } from '@/shared/api/client';
import { Avatar } from '@/shared/components/ui';
import { MailboxAvatar } from '@/features/mailboxes/MailboxAvatar';
import { listMessages } from '@/features/messages/messages.api';
import { listAlerts, markAllAlertsRead } from '@/features/alerts/alerts.api';
import { hasPermission } from '../access';
import { ROLE_LABEL, View, viewPath } from '../dashboard.types';
import styles from '@/styles/features/dashboard/pages/Dashboard.module.css';
import IcBell from '@/assets/icons/bell.svg?react';
import IcChevronDown from '@/assets/icons/chevron-down.svg?react';
import IcHelp from '@/assets/icons/help-circle.svg?react';
import IcLogOut from '@/assets/icons/logout.svg?react';
import IcPerson from '@/assets/icons/user.svg?react';
import IcSettings from '@/assets/icons/settings.svg?react';
import IcMenu from '@/assets/icons/menu.svg?react';
import IcSun from '@/assets/icons/sun.svg?react';
import IcMoon from '@/assets/icons/moon.svg?react';

interface TopbarProps {
  title: string;
  subtitle: string;
  /** Opens the mobile nav drawer. The button is only shown below the breakpoint. */
  onMenuClick?: () => void;
}

// ── Inline icons ──────────────────────────────────────────────────────────────

// ── Notification dropdown ─────────────────────────────────────────────────────

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  target: string;
}

interface NotificationDropdownProps {
  notifications?: AppNotification[];
  onMarkAllRead?: () => void;
  /** Footer action: jump to the full list and clear the unread badges. */
  onViewAll?: () => void;
  viewAllLabel?: string;
}

const NOTIF_LIMIT = 5;

/**
 * Surfaces the signed-in user's most recently received mail as notifications.
 * "Unread" here tracks a per-user "last seen" timestamp in localStorage (not
 * the mailbox's own read/unread flag) — opening the mailbox provider doesn't
 * count as checking notifications, and clicking "Mark all read" shouldn't
 * touch the user's actual inbox read-state.
 */
function useMailNotifications(userId: string | undefined) {
  const storageKey = userId ? `notif-last-seen:${userId}` : null;
  const [lastSeen, setLastSeen] = useState<number | null>(null);

  useEffect(() => {
    if (!storageKey) { setLastSeen(null); return; }
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      setLastSeen(Number(raw));
    } else {
      // First time this browser has seen this user — start clean so their
      // existing mailbox doesn't all show up as "new" at once.
      const now = Date.now();
      localStorage.setItem(storageKey, String(now));
      setLastSeen(now);
    }
  }, [storageKey]);

  const { data } = useQuery({
    queryKey: ['topbar-recent-mail'],
    queryFn:  () => listMessages({ scope: 'own', limit: NOTIF_LIMIT, page: 1 }),
    enabled:  !!userId,
  });

  const notifications: AppNotification[] = lastSeen == null ? [] : (data?.messages ?? []).map((m) => ({
    id:        m.id,
    title:     m.fromName ?? m.fromAddress,
    body:      m.subject ?? '(no subject)',
    read:      new Date(m.receivedAt).getTime() <= lastSeen,
    createdAt: m.receivedAt,
    target:    viewPath(View.Emails),
  }));

  const markAllRead = () => {
    const now = Date.now();
    if (storageKey) localStorage.setItem(storageKey, String(now));
    setLastSeen(now);
  };

  return { notifications, markAllRead };
}

function useAlertNotifications(enabled: boolean) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['alerts'],
    queryFn:  listAlerts,
    enabled,
  });

  const markAllMut = useMutation({
    mutationFn: markAllAlertsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const notifications: AppNotification[] = (data ?? []).slice(0, NOTIF_LIMIT).map((alert) => ({
    id:        alert.id,
    title:     alert.title,
    body:      alert.description,
    read:      alert.read,
    createdAt: alert.createdAt,
    target:    viewPath(View.Alerts),
  }));

  return { notifications, markAllRead: () => markAllMut.mutate() };
}

function NotificationDropdown({ notifications = [], onMarkAllRead, onViewAll, viewAllLabel = 'View all' }: NotificationDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);
  const navigate        = useNavigate();
  const unread          = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const openNotification = (notification: AppNotification) => {
    setOpen(false);
    navigate(notification.target);
  };

  return (
    <div ref={ref} className={styles.notifDropdown}>
      <button
        className={styles.bellBtn}
        aria-label="Notifications"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <IcBell />
        {unread > 0 && (
          <span className={styles.notifBadge}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div className={styles.notifPanel}>
          <div className={styles.notifPanelHeader}>
            <span className={styles.notifPanelTitle}>Notifications</span>
            {unread > 0 && onMarkAllRead && (
              <button className={styles.notifMarkAll} onClick={() => { onMarkAllRead(); }}>
                Mark all read
              </button>
            )}
          </div>

          <div className={styles.notifList}>
            {notifications.length === 0 ? (
              <div className={styles.notifEmpty}>
                <IcBell />
                <span>No notifications yet</span>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  type="button"
                  className={`${styles.notifItem} ${!n.read ? styles.notifItemUnread : ''}`}
                  onClick={() => openNotification(n)}
                >
                  <div className={styles.notifItemDot} />
                  <div className={styles.notifItemBody}>
                    <span className={styles.notifItemTitle}>{n.title}</span>
                    <span className={styles.notifItemText}>{n.body}</span>
                    <span className={styles.notifItemTime}>
                      {new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          {onViewAll && (
            <button
              type="button"
              className={styles.notifViewAll}
              onClick={() => {
                setOpen(false);
                onViewAll();       // marks all read (clears bell + sidebar badge) then navigates
              }}
            >
              {viewAllLabel} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Profile dropdown ──────────────────────────────────────────────────────────

// ── Simple theme toggle button (in topbar) ────────────────────────────────────

function ThemeToggleBtn() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <button
      className={styles.bellBtn}
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <IcSun /> : <IcMoon />}
    </button>
  );
}

// ── Profile dropdown ──────────────────────────────────────────────────────────

function ProfileDropdown() {
  const [open, setOpen]         = useState(false);
  const ref                     = useRef<HTMLDivElement>(null);
  const { user, logout }        = useAuth();
  const navigate                = useNavigate();

  const close = () => setOpen(false);

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn:  async () => (await apiClient.get<{ version: string }>('/health')).data,
    enabled:  open,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const roleLabel = user?.roleName ?? (user?.role != null ? (ROLE_LABEL[user.role] ?? user.role) : '');

  const handleLogout = async () => {
    close();
    try { await logout(); } finally { navigate('/login', { replace: true }); }
  };

  const go = (path: string) => { close(); navigate(path); };

  return (
    <div ref={ref} className={styles.profileDropdown}>
      <button
        className={`${styles.profileChip} ${open ? styles.profileChipOpen : ''}`}
        onClick={() => setOpen(v => !v)}
        title={user?.displayName}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className={styles.profileChipAvatar}>
          {user?.mailboxId
            ? <MailboxAvatar mailboxId={user.mailboxId} name={user.displayName} size={30} />
            : <Avatar name={user?.displayName ?? '?'} size={30} />}
        </span>
        {/* Name + role are hidden below ~900px (see CSS) so the chip collapses
            back to just the avatar on narrow screens. */}
        <span className={styles.profileChipText}>
          <span className={styles.profileChipName}>{user?.displayName}</span>
          <span className={styles.profileChipRole}>{roleLabel}</span>
        </span>
        <span className={styles.profileChipCaret} aria-hidden="true">
          <IcChevronDown width={13} height={13} />
        </span>
      </button>

      {open && (
        <div className={styles.profileMenu}>
          {/* User header */}
          <div className={styles.profileMenuHeader}>
            {user?.mailboxId
              ? <MailboxAvatar mailboxId={user.mailboxId} name={user.displayName} size={44} />
              : <Avatar name={user?.displayName ?? '?'} size={44} />}
            <div className={styles.profileMenuInfo}>
              <span className={styles.profileMenuName}>{user?.displayName}</span>
              <span className={styles.profileMenuRole}>{roleLabel}</span>
              <span className={styles.profileMenuEmail}>{user?.email}</span>
            </div>
          </div>

          <div className={styles.profileMenuDivider} />

          <button className={styles.profileMenuItem} onClick={() => go(`${viewPath(View.Settings)}?tab=account`)}>
            <span className={styles.profileMenuItemIc}><IcPerson /></span> View profile
          </button>
          <button className={styles.profileMenuItem} onClick={() => go(`${viewPath(View.Settings)}?tab=account`)}>
            <span className={styles.profileMenuItemIc}><IcSettings width={14} height={14} /></span> Settings
          </button>
          <button className={styles.profileMenuItem} onClick={close}>
            <span className={styles.profileMenuItemIc}><IcHelp /></span> Help &amp; support
          </button>

          <button className={`${styles.profileMenuItem} ${styles.profileMenuItemDanger}`} onClick={handleLogout}>
            <span className={styles.profileMenuItemIc}><IcLogOut /></span> Sign out
          </button>

          {health?.version && (
            <>
              <div className={styles.profileMenuDivider} />
              <div className={styles.profileMenuVersion}>
                <span className={styles.profileMenuVersionBadge}>
                  <span className={styles.profileMenuVersionDot} />
                  Version {health.version}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Topbar({ title, subtitle, onMenuClick }: TopbarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canManageAlerts = hasPermission(user, 'alerts.manage');
  const canReadEmails = hasPermission(user, 'emails.read');
  const alertNotifications = useAlertNotifications(canManageAlerts);
  const mailNotifications = useMailNotifications(canManageAlerts || !canReadEmails ? undefined : user?.id);
  const { notifications, markAllRead } = canManageAlerts ? alertNotifications : mailNotifications;

  // Footer of the bell dropdown: mark everything read (clears the bell badge AND
  // the sidebar Alerts badge, which read the same query) then open the page.
  const viewAllTarget = canManageAlerts ? View.Alerts : View.Emails;
  const viewAllLabel  = canManageAlerts ? 'View all alerts' : 'View all mail';
  const handleViewAll = () => {
    markAllRead();
    navigate(viewPath(viewAllTarget));
  };

  return (
    <header className={styles.topbar}>

      {/* Hamburger — visible only below the mobile breakpoint (see CSS). */}
      <button className={styles.menuBtn} onClick={onMenuClick} aria-label="Open navigation menu" type="button">
        <IcMenu width={20} height={20} />
      </button>

      {/* Left: page title */}
      <div className={styles.topbarLeft}>
        <h1 className={styles.topbarTitle}>{title}</h1>
        <p className={styles.topbarSubtitle}>{subtitle}</p>
      </div>

      {/* Right: icon group + divider + avatar */}
      <div className={styles.topbarRight}>
        <div className={styles.topbarIconGroup}>
          <ThemeToggleBtn />
          <NotificationDropdown
            notifications={notifications}
            onMarkAllRead={markAllRead}
            onViewAll={handleViewAll}
            viewAllLabel={viewAllLabel}
          />
        </div>
        <div className={styles.topbarDivider} />
        <ProfileDropdown />
      </div>

    </header>
  );
}
