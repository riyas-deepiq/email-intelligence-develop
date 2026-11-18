import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/useAuth';
import { useTheme } from '@/app/theme/useTheme';
import { Theme } from '@/app/theme/theme';
import { Palette, PALETTE_META } from '@/app/theme/palette';
import { useToast } from '@/shared/toast/useToast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { changePassword, listSessions, revokeSession } from '@/features/auth/auth.api';
import { Role } from '@/shared/types/enums';
import { hasPermission } from '../access';
import { ROLE_LABEL } from '../dashboard.types';
import { Avatar } from '@/shared/components/ui';
import { MailboxAvatar } from '@/features/mailboxes/MailboxAvatar';
import { ALERT_NOTIFICATIONS_KEY, NOTIFICATION_SOUND_KEY, playNotificationSound } from '@/shared/utils/notificationSound';
import styles from '@/styles/features/dashboard/pages/Dashboard.module.css';
import IcBell     from '@/assets/icons/bell.svg?react';
import IcPerson   from '@/assets/icons/user.svg?react';
import IcShield   from '@/assets/icons/shield-outline.svg?react';
import IcSun      from '@/assets/icons/sun.svg?react';
import IcMoon     from '@/assets/icons/moon.svg?react';

// ─── Inline icon set ──────────────────────────────────────────────────────────

// ─── Settings tab definition ──────────────────────────────────────────────────

enum SettingsTab {
  Account       = 'account',
  Notifications = 'notifications',
  Appearance    = 'appearance',
  Security      = 'security',
}

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: SettingsTab.Account,       label: 'Account',        icon: <IcPerson /> },
  { id: SettingsTab.Notifications, label: 'Notifications',  icon: <IcBell /> },
  { id: SettingsTab.Appearance,    label: 'Appearance',     icon: <IcSun /> },
  { id: SettingsTab.Security,      label: 'Security',       icon: <IcShield /> },
];

const RBAC_KEY = 'settings.rbac';
const DLP_KEY = 'settings.dlp';
const ENFORCE_2FA_KEY = 'settings.enforce2fa';

// ─── Toggle row helper ────────────────────────────────────────────────────────

function ToggleRow({ title, desc, checked, onChange }: { title: string; desc: string; checked: boolean; onChange: () => void }) {
  return (
    <div className={styles.settingsRow}>
      <div className={styles.settingsRowLeft}>
        <span className={styles.settingsRowTitle}>{title}</span>
        <span className={styles.settingsRowDesc}>{desc}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
        onClick={onChange}
      />
    </div>
  );
}

// ─── Appearance tab ───────────────────────────────────────────────────────────

function AppearanceTab() {
  const { theme, resolvedTheme, palette, setTheme, setPalette } = useTheme();

  return (
    <>
      {/* Theme Mode Selector */}
      <div className={styles.settingsCard}>
        <div className={styles.settingsCardHeader}>
          <h2 className={styles.settingsCardTitle}>Theme Mode</h2>
          <p className={styles.settingsCardDesc}>Choose between light, dark, or system preference.</p>
        </div>
        <div className={styles.settingsDivider} />
        <div className={styles.themeSelector}>
          <button
            type="button"
            className={`${styles.themeSelectorBtn} ${resolvedTheme === 'light' || theme === Theme.Light ? styles.themeSelectorBtnActive : ''}`}
            onClick={() => setTheme(Theme.Light)}
          >
            <span className={styles.themeSelectorBtnIc}><IcSun /></span>
            <span className={styles.themeSelectorBtnLabel}>Light</span>
            {(resolvedTheme === 'light' || theme === Theme.Light) && <span className={styles.themeSelectorBtnCheck}>✓</span>}
          </button>
          <button
            type="button"
            className={`${styles.themeSelectorBtn} ${resolvedTheme === 'dark' || theme === Theme.Dark ? styles.themeSelectorBtnActive : ''}`}
            onClick={() => setTheme(Theme.Dark)}
          >
            <span className={styles.themeSelectorBtnIc}><IcMoon /></span>
            <span className={styles.themeSelectorBtnLabel}>Dark</span>
            {(resolvedTheme === 'dark' || theme === Theme.Dark) && <span className={styles.themeSelectorBtnCheck}>✓</span>}
          </button>
          <button
            type="button"
            className={`${styles.themeSelectorBtn} ${theme === Theme.Auto ? styles.themeSelectorBtnActive : ''}`}
            onClick={() => setTheme(Theme.Auto)}
          >
            <span className={styles.themeSelectorBtnIc}><IcSun /></span>
            <span className={styles.themeSelectorBtnLabel}>Auto</span>
            {theme === Theme.Auto && <span className={styles.themeSelectorBtnCheck}>✓</span>}
          </button>
        </div>
      </div>

      {/* Color Palette Selector */}
      <div className={styles.settingsCard} style={{ marginTop: '1.25rem' }}>
        <div className={styles.settingsCardHeader}>
          <h2 className={styles.settingsCardTitle}>Color Palette</h2>
          <p className={styles.settingsCardDesc}>Choose an accent color scheme for the whole app.</p>
        </div>
        <div className={styles.settingsDivider} />
        <div className={styles.paletteGrid}>
          {Object.values(Palette).map((p) => {
            const meta = PALETTE_META[p];
            const isActive = palette === p;
            return (
              <button
                key={p}
                type="button"
                className={`${styles.paletteCard} ${isActive ? styles.paletteCardActive : ''}`}
                onClick={() => setPalette(p)}
                title={meta.label}
                aria-label={`${meta.label} colour palette`}
                aria-pressed={isActive}
              >
                <div className={styles.paletteCardSwatch}>
                  {meta.colors.map((c, i) => (
                    <span key={i} className={styles.paletteSwatchSeg} style={{ background: c }} />
                  ))}
                </div>
                {isActive && <span className={styles.paletteCardCheck}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Security tab (change password + active sessions) ────────────────────────

function SecurityTab() {
  const toast = useToast();
  const qc    = useQueryClient();

  const [current,  setCurrent]  = useState('');
  const [next,     setNext]     = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [cpSaving, setCpSaving] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) { toast.error('New password must be at least 8 characters.'); return; }
    if (next !== confirm) { toast.error('New passwords do not match.'); return; }
    setCpSaving(true);
    try {
      await changePassword(current, next);
      toast.success('Password changed successfully.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Failed to change password.';
      toast.error(msg);
    } finally {
      setCpSaving(false);
    }
  };

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn:  listSessions,
  });

  const revokeMut = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Session revoked.');
    },
    onError: () => toast.error('Failed to revoke session.'),
  });

  return (
    <>
      <div className={styles.settingsCard}>
        <div className={styles.settingsCardHeader}>
          <h2 className={styles.settingsCardTitle}>Change Password</h2>
          <p className={styles.settingsCardDesc}>Update your password. You'll stay logged in on this session.</p>
        </div>
        <div className={styles.settingsDivider} />
        <form onSubmit={handleChangePassword} noValidate style={{ padding: '0.25rem 0' }}>
          <div className={styles.settingsRow}>
            <div className={styles.settingsRowLeft}>
              <span className={styles.settingsRowTitle}>Current password</span>
            </div>
            <input type="password" className={styles.settingsInput} value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Your current password" autoComplete="current-password" />
          </div>
          <div className={styles.settingsDivider} />
          <div className={styles.settingsRow}>
            <div className={styles.settingsRowLeft}>
              <span className={styles.settingsRowTitle}>New password</span>
              <span className={styles.settingsRowDesc}>At least 8 characters</span>
            </div>
            <input type="password" className={styles.settingsInput} value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password" autoComplete="new-password" />
          </div>
          <div className={styles.settingsDivider} />
          <div className={styles.settingsRow}>
            <div className={styles.settingsRowLeft}>
              <span className={styles.settingsRowTitle}>Confirm new password</span>
            </div>
            <input type="password" className={styles.settingsInput} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat new password" autoComplete="new-password" />
          </div>
          {(current || next || confirm) && (
            <>
              <div className={styles.settingsDivider} />
              <div className={styles.settingsSaveRow}>
                <button type="submit" className={styles.settingsSaveBtn} disabled={cpSaving || !current || !next || !confirm}>
                  {cpSaving ? 'Saving…' : 'Change password'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>

      <div className={styles.settingsCard} style={{ marginTop: '1.25rem' }}>
        <div className={styles.settingsCardHeader}>
          <h2 className={styles.settingsCardTitle}>Active Sessions</h2>
          <p className={styles.settingsCardDesc}>All devices where you're currently logged in. Revoke any session you don't recognise.</p>
        </div>
        <div className={styles.settingsDivider} />
        {sessionsLoading ? (
          <div className={styles.settingsPlaceholderBody}>
            <div className={styles.settingsPlaceholderLine} style={{ width: '60%' }} />
            <div className={styles.settingsPlaceholderLine} style={{ width: '45%' }} />
          </div>
        ) : !sessions?.length ? (
          <div className={styles.settingsPlaceholderBody}>
            <span style={{ fontSize: 13, color: 'var(--text-lo)' }}>No active sessions found.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sessions.map((s, i) => (
              <React.Fragment key={s.sessionId}>
                {i > 0 && <div className={styles.settingsDivider} />}
                <div className={styles.settingsRow}>
                  <div className={styles.settingsRowLeft}>
                    <span className={styles.settingsRowTitle}>{s.deviceName}</span>
                    <span className={styles.settingsRowTitle} style={{ display: 'none' }}>
                      {s.sessionId.slice(0, 20)}…
                    </span>
                    <span className={styles.settingsRowDesc}>Expires {new Date(s.expiresAt).toLocaleString()}</span>
                  </div>
                  <button type="button" className={styles.settingsDangerBtn} onClick={() => revokeMut.mutate(s.sessionId)} disabled={revokeMut.isPending}>
                    Revoke
                  </button>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsView() {
  const location = useLocation();
  const initialTab = (): SettingsTab => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab && Object.values(SettingsTab).includes(tab as SettingsTab)) return tab as SettingsTab;
    return SettingsTab.Account;
  };

  const [activeTab,      setActiveTab]      = useState<SettingsTab>(initialTab);
  const [notifSound,     setNotifSound]     = useState(() => localStorage.getItem(NOTIFICATION_SOUND_KEY) === 'true');
  const [alertNotifs,    setAlertNotifs]    = useState(() => localStorage.getItem(ALERT_NOTIFICATIONS_KEY) !== 'false');
  const [rbac,           setRbac]           = useState(() => localStorage.getItem(RBAC_KEY) !== 'false');
  const [dlp,            setDlp]            = useState(() => localStorage.getItem(DLP_KEY) !== 'false');
  const [enforce2fa,     setEnforce2fa]     = useState(() => localStorage.getItem(ENFORCE_2FA_KEY) !== 'false');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab && Object.values(SettingsTab).includes(tab as SettingsTab)) setActiveTab(tab as SettingsTab);
  }, [location.search]);

  const { user, updateProfile } = useAuth();
  const canManageSecurity = hasPermission(user, 'settings.manage_security');
  const toast   = useToast();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email,       setEmail]       = useState(user?.email ?? '');
  const [saving,      setSaving]      = useState(false);
  const isDirty = displayName !== (user?.displayName ?? '') || email !== (user?.email ?? '');

  const handleSave = async () => {
    if (!displayName.trim()) { toast.error('Display name cannot be empty.'); return; }
    if (!email.trim())       { toast.error('Email address cannot be empty.'); return; }
    setSaving(true);
    try {
      await updateProfile({ displayName: displayName.trim(), email: email.trim() });
      toast.success('Profile updated successfully.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
        ?? 'Failed to update profile. Please try again.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleNotificationSoundToggle = () => {
    setNotifSound((enabled) => {
      const next = !enabled;
      localStorage.setItem(NOTIFICATION_SOUND_KEY, String(next));
      if (next) playNotificationSound();
      return next;
    });
  };

  const handleAlertNotificationsToggle = () => {
    setAlertNotifs((enabled) => {
      const next = !enabled;
      localStorage.setItem(ALERT_NOTIFICATIONS_KEY, String(next));
      return next;
    });
  };

  const handleRbacToggle = () => {
    setRbac((enabled) => {
      const next = !enabled;
      localStorage.setItem(RBAC_KEY, String(next));
      return next;
    });
  };

  const handleDlpToggle = () => {
    setDlp((enabled) => {
      const next = !enabled;
      localStorage.setItem(DLP_KEY, String(next));
      return next;
    });
  };

  const handleEnforce2faToggle = () => {
    setEnforce2fa((enabled) => {
      const next = !enabled;
      localStorage.setItem(ENFORCE_2FA_KEY, String(next));
      return next;
    });
  };

  return (
    <div className={styles.settingsPage}>

      {/* Tab navigation */}
      <div className={styles.settingsTabs}>
        {SETTINGS_TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={`${styles.settingsTab} ${activeTab === tab.id ? styles.settingsTabActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Account ── */}
      {activeTab === SettingsTab.Account && (
        <div className={styles.settingsCard}>
          

          <div className={styles.profileMenuHeader} style={{ padding: '1.1rem 1.4rem' }}>
            {user?.mailboxId
              ? <MailboxAvatar mailboxId={user.mailboxId} name={user.displayName ?? user.email} size={48} />
              : <Avatar name={user?.displayName ?? user?.email ?? '?'} size={48} />}
            <div className={styles.profileMenuInfo}>
              <span className={styles.profileMenuName}>{user?.displayName}</span>
              <span className={styles.profileMenuRole}>{user?.roleName ?? (user?.role != null ? (ROLE_LABEL[user.role as Role] ?? user.role) : '')}</span>
              <span className={styles.profileMenuEmail}>{user?.email}</span>
            </div>
          </div>
          <div className={styles.settingsDivider} />

          <div className={styles.settingsRow}>
            <div className={styles.settingsRowLeft}>
              <span className={styles.settingsRowTitle}>Display Name</span>
              <span className={styles.settingsRowDesc}>Your name shown across the platform</span>
            </div>
            <input className={styles.settingsInput} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your display name" />
          </div>
          <div className={styles.settingsDivider} />

          <div className={styles.settingsRow}>
            <div className={styles.settingsRowLeft}>
              <span className={styles.settingsRowTitle}>Email Address</span>
              <span className={styles.settingsRowDesc}>Used for login and notifications</span>
            </div>
            <input className={styles.settingsInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" />
          </div>
          <div className={styles.settingsDivider} />

          <div className={styles.settingsRow}>
            <div className={styles.settingsRowLeft}>
              <span className={styles.settingsRowTitle}>Role</span>
              <span className={styles.settingsRowDesc}>Your access level on this platform</span>
            </div>
            <span className={styles.settingsRoleBadge}>
              {user?.roleName ?? (user?.role != null ? (ROLE_LABEL[user.role as Role] ?? user.role) : '—')}
            </span>
          </div>

          {isDirty && (
            <>
              <div className={styles.settingsDivider} />
              <div className={styles.settingsSaveRow}>
                <button type="button" className={styles.settingsSaveBtn} onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Notifications ── */}
      {activeTab === SettingsTab.Notifications && (
        <div className={styles.settingsCard}>
          
          <div className={styles.settingsDivider} />
          <ToggleRow title="Alert notifications" desc="Email me when high-priority items are flagged" checked={alertNotifs} onChange={handleAlertNotificationsToggle} />
          <div className={styles.settingsDivider} />
          <ToggleRow title="Notification sound" desc="Play a chime when an alert arrives" checked={notifSound} onChange={handleNotificationSoundToggle} />
        </div>
      )}

      {/* ── Appearance (theme mode + color palette) ── */}
      {activeTab === SettingsTab.Appearance && <AppearanceTab />}

      {/* ── Security (change password + sessions + admin org controls) ── */}
      {activeTab === SettingsTab.Security && (
        <>
          {canManageSecurity && (
            <div className={styles.settingsCard} style={{ marginBottom: '1.25rem' }}>
              <div className={styles.settingsCardHeader}>
                <h2 className={styles.settingsCardTitle}>Organisation Security</h2>
                <p className={styles.settingsCardDesc}>Org-wide governance controls for security administrators.</p>
              </div>
              <div className={styles.settingsDivider} />
              <ToggleRow title="Role-based access control" desc="Restrict retrieval results to a user's authorised scope" checked={rbac} onChange={handleRbacToggle} />
              <div className={styles.settingsDivider} />
              <ToggleRow title="Data-loss prevention (DLP)" desc="Block external sharing of Restricted content" checked={dlp} onChange={handleDlpToggle} />
              <div className={styles.settingsDivider} />
              <ToggleRow title="Enforce 2-factor authentication" desc="Required for all users in the organisation" checked={enforce2fa} onChange={handleEnforce2faToggle} />
            </div>
          )}
          <SecurityTab />
        </>
      )}

    </div>
  );
}
