import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../useAuth';
import { setupOrg } from '../auth.api';
import { useFieldShake, isValidEmail, isEmailDomainAllowed, parseDomains } from '../useFieldShake';
import { setToken } from '@/shared/api/client';
import { useToast } from '@/shared/toast/useToast';
import { ProviderConnectionStep } from '@/features/provider-connection/components/ProviderConnectionStep';
import { fetchSetupStatus } from '@/features/setup/setup.api';
import { getOrg } from '@/features/organizations/organizations.api';
import type { SetupStatus } from '@/features/setup/setup.api';
import {
  getSyncConfig,
  updateSyncConfig,
  updateSyncSchedule,
  startSync,
} from '@/features/sync/sync.api';
import type { SyncMailboxEntry } from '@/features/sync/sync.api';
import { Role } from '@/shared/types/enums';
import { PasswordToggle, Combobox } from '@/shared/components/ui';
import { matchesSearchTerm, normalizeSearchTerm } from '@/shared/utils/search';
import logoUrl from '@/assets/icons/insight-hub-icon.png';
import { BRAND_NAME } from '@/shared/brand';
import { BrandText } from '@/shared/components/BrandText';
import IcCheck from '@/assets/icons/check.svg?react';
import IcChevronLeft from '@/assets/icons/chevron-left.svg?react';
import IcChevronRight from '@/assets/icons/chevron-right.svg?react';
import IcSearch from '@/assets/icons/search.svg?react';
import IcClose from '@/assets/icons/x.svg?react';
import styles from '@/styles/features/auth/pages/Setup.module.css';

/* ── Particle canvas ── */
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId: number;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    const pts = Array.from({ length: 70 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.6 + 0.6,
    }));
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 140) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(96,165,250,${0.15 * (1 - d / 140)})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.stroke();
          }
        }
      }
      pts.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(147,197,253,0.45)';
        ctx.fill();
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      });
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={canvasRef} className={styles.canvas} />;
}

/* ── Icons ── */
/* ── Password strength ── */
function pwStrength(pw: string) {
  if (!pw) return { level: 0, label: '', color: '' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (s <= 1) return { level: 1, label: 'Weak', color: '#ef4444' };
  if (s <= 3) return { level: 2, label: 'Fair', color: '#f59e0b' };
  if (s === 4) return { level: 3, label: 'Good', color: '#3b82f6' };
  return { level: 4, label: 'Strong', color: '#22c55e' };
}

const STEPS = [
  { id: 1, label: 'Organization' },
  { id: 2, label: 'Security' },
  { id: 3, label: 'Mailboxes' },
  { id: 4, label: 'Sync' },
];

/* ── Page ── */
export function Setup() {
  const { user, loading: authLoading, completeSetup } = useAuth();
  const navigate = useNavigate();

  // Wizard navigation
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [animating, setAnimating] = useState(false);

  // Status check for resumability
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Step 1 — org
  const [companyName, setCompanyName] = useState('');
  const [domains, setDomains] = useState('');
  const [email, setEmail] = useState('');

  // Step 4 — sync
  const [syncMailboxes, setSyncMailboxes] = useState<SyncMailboxEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mailboxSearch, setMailboxSearch] = useState('');
  const [loadingMailboxes, setLoadingMailboxes] = useState(false);
  const [initialSyncDays, setInitialSyncDays] = useState<number | null>(90);
  const [businessHoursIntervalMin, setBusinessHoursInterval] = useState(5);
  const [offHoursIntervalMin, setOffHoursInterval] = useState(60);
  // Auto-detected, no manual override on this step — kept simple during setup.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Step 2 — password
  const [newPassword, setNewPassword] = useState('');
  const [retypePassword, setRetypePassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showRetype, setShowRetype] = useState(false);

  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [setupResult, setSetupResult] = useState<import('../auth.types').SetupResponse | null>(
    null,
  );

  const strength = pwStrength(newPassword);
  const pwMatch = retypePassword.length > 0 && newPassword === retypePassword;
  const pwMismatch = retypePassword.length > 0 && newPassword !== retypePassword;

  const { fieldErrors, shakeField, triggerShake, clearFieldError } = useFieldShake<
    'companyName' | 'domains' | 'email' | 'newPassword' | 'retypePassword'
  >();

  useEffect(() => {
    if (user?.email) setEmail(user.email);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchSetupStatus()
      .then((status) => {
        setSetupStatus(status);
        if (status.complete) {
          navigate('/dashboard', { replace: true });
          return;
        }
        const { steps } = status;
        if (steps.organization.done && steps.admin.done) {
          setStep(3);
        } else {
          setStep(1);
        }
      })
      .catch(() => setStep(1))
      .finally(() => setStatusLoading(false));
  }, [navigate, user]);

  // ── Guards ───────────────────────────────────────────────────────────────────

  if (authLoading || statusLoading) {
    return (
      <div className={styles.spinWrap}>
        <span className={styles.spinner} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== Role.SuperAdmin) return <Navigate to="/dashboard" replace />;
  if (setupStatus?.complete && !setupResult) return <Navigate to="/dashboard" replace />;

  // ── Navigation ───────────────────────────────────────────────────────────────

  const goTo = (next: number) => {
    if (animating) return;
    setDirection(next > step ? 'forward' : 'back');
    setAnimating(true);
    setTimeout(() => {
      setStep(next);
      setAnimating(false);
    }, 220);
  };

  const handleBack = () => goTo(step - 1);

  // ── Step 1: Organization ─────────────────────────────────────────────────────

  const validateStep1 = () => {
    if (!companyName.trim()) {
      triggerShake('companyName', 'Please enter your company name');
      return false;
    }
    if (!domains.trim()) {
      triggerShake('domains', 'Please enter at least one domain');
      return false;
    }
    if (!email.trim()) {
      triggerShake('email', 'Please enter an admin email');
      return false;
    }
    if (!isValidEmail(email)) {
      triggerShake('email', 'Please enter a valid email address');
      return false;
    }
    if (!isEmailDomainAllowed(email, domains)) {
      triggerShake(
        'email',
        `Admin email must match one of your domains: ${parseDomains(domains).join(', ')}`,
      );
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep1()) return;
    goTo(2);
  };

  // ── Step 2: Security ─────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword) {
      triggerShake('newPassword', 'Please enter a new password');
      return;
    }
    if (!retypePassword) {
      triggerShake('retypePassword', 'Please retype your password');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== retypePassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await setupOrg({ companyName, domains, email, newPassword });
      setSetupResult(result);
      setToken(result.tokens.accessToken);
      goTo(3);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response
        ?.data?.error?.message;
      toast.error(msg ?? 'Failed to save. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: Mailboxes ────────────────────────────────────────────────────────

  const handleFinish = () => {
    // Load mailboxes for the sync step before navigating to it
    setLoadingMailboxes(true);
    getSyncConfig()
      .then((cfg) => {
        setSyncMailboxes(cfg.mailboxes);
        // Pre-select all sync-enabled mailboxes
        setSelectedIds(new Set(cfg.mailboxes.filter((m) => m.syncEnabled).map((m) => m.id)));
      })
      .catch(() => {})
      .finally(() => setLoadingMailboxes(false));
    goTo(4);
  };

  // ── Step 4: Sync ─────────────────────────────────────────────────────────────

  const mailboxQuery = normalizeSearchTerm(mailboxSearch);
  const filteredMailboxes = mailboxQuery
    ? syncMailboxes.filter((m) =>
        matchesSearchTerm([m.address, m.displayName, m.provider], mailboxQuery),
      )
    : syncMailboxes;

  // "Select all" acts on the currently visible (filtered) mailboxes.
  const allSelected =
    filteredMailboxes.length > 0 && filteredMailboxes.every((m) => selectedIds.has(m.id));

  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) filteredMailboxes.forEach((m) => next.delete(m.id));
      else filteredMailboxes.forEach((m) => next.add(m.id));
      return next;
    });
  };

  const toggleMailbox = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDefaultSync = async () => {
    try {
      // Read the saved organization admin address, not the signed-in user's login email.
      const org = await getOrg();
      const adminEmail = org.adminEmail.trim().toLowerCase();
      const adminMailbox = syncMailboxes.find(
        (mailbox) => mailbox.address.trim().toLowerCase() === adminEmail,
      );

      if (!adminMailbox) {
        toast.warning(
          `No discovered mailbox matches the organization admin email (${org.adminEmail}). Connect or discover that mailbox first.`,
          'Admin mailbox not found',
        );
        return;
      }

      void handleSaveSchedule(true, {
        mailboxIds: [adminMailbox.id],
        initialSyncDays: null,
        businessHoursIntervalMin: 5,
        offHoursIntervalMin: 60,
      });
    } catch {
      toast.error('Could not load the organization admin email. Please try again.');
    }
  };

  const handleSaveSchedule = async (
    andStart: boolean,
    overrides?: {
      mailboxIds: string[];
      initialSyncDays: number | null;
      businessHoursIntervalMin: number;
      offHoursIntervalMin: number;
    },
  ) => {
    setSavingSchedule(true);
    try {
      const mailboxIds = overrides?.mailboxIds ?? Array.from(selectedIds);
      // 1. Enable/disable sync per mailbox based on selection
      const patches = syncMailboxes.map((m) => ({
        id: m.id,
        syncEnabled: mailboxIds.includes(m.id),
      }));
      await updateSyncConfig({ mailboxes: patches });

      // 2. Save schedule settings
      await updateSyncSchedule({
        timezone,
        initialSyncDays: overrides ? overrides.initialSyncDays : initialSyncDays,
        businessHoursIntervalMin: overrides?.businessHoursIntervalMin ?? businessHoursIntervalMin,
        offHoursIntervalMin: overrides?.offHoursIntervalMin ?? offHoursIntervalMin,
      });

      // 3. Kick off sync if requested (non-fatal — collector may not be up yet)
      if (andStart && mailboxIds.length > 0) {
        // Always send the explicit selection. An unscoped start means "all
        // enabled mailboxes" and can become broader than this setup choice if
        // another mailbox update races the request.
        await startSync(mailboxIds).catch(() => {});
      }
    } catch {
      // schedule can always be updated from Dashboard → Sync
    } finally {
      setSavingSchedule(false);
    }
    if (setupResult) completeSetup(setupResult.tokens, setupResult.user);
    navigate('/dashboard');
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <ParticleCanvas />

      {/* Card widens on step 3 (provider connection) and step 4 (mailbox list) */}
      <div className={`${styles.card} ${step === 3 || step === 4 ? styles.cardWide : ''}`}>
        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <img src={logoUrl} alt={`${BRAND_NAME} logo`} />
          </div>
          <BrandText className={styles.brandCopy} />
        </div>

        {/* Step tracker */}
        <div className={styles.stepper}>
          {STEPS.map((s, i) => {
            const done = step > s.id;
            const active = step === s.id;
            return (
              <React.Fragment key={s.id}>
                <div className={styles.stepItem}>
                  <div
                    className={`${styles.stepCircle} ${active ? styles.stepActive : ''} ${done ? styles.stepDone : ''}`}
                  >
                    {done ? <IcCheck width={11} height={11} /> : s.id}
                  </div>
                  <span className={`${styles.stepLabel} ${active ? styles.stepLabelActive : ''}`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`${styles.stepLine} ${done ? styles.stepLineDone : ''}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step content */}
        <div
          className={`${styles.stepBody} ${animating ? (direction === 'forward' ? styles.slideOutLeft : styles.slideOutRight) : ''}`}
        >
          {/* ── Step 1: Organization ── */}
          {step === 1 && (
            <>
              <div className={styles.stepHeading}>
                <h2>Organization Details</h2>
                <p>Tell us about your company to personalize your workspace.</p>
              </div>

              <div className={styles.field}>
                <label htmlFor="companyName">
                  Company Name <span className={styles.requiredMark}>*</span>
                </label>
                <input
                  id="companyName"
                  type="text"
                  className={shakeField === 'companyName' ? styles.inputShake : undefined}
                  value={companyName}
                  onChange={(e) => {
                    setCompanyName(e.target.value);
                    clearFieldError('companyName');
                  }}
                  placeholder="Acme Corporation"
                  autoComplete="organization"
                  aria-invalid={!!fieldErrors.companyName}
                />
                {fieldErrors.companyName && (
                  <span className={styles.hintError}>{fieldErrors.companyName}</span>
                )}
              </div>

              <div className={styles.field}>
                <label htmlFor="domains">
                  Domains <span className={styles.requiredMark}>*</span>
                </label>
                <input
                  id="domains"
                  type="text"
                  className={shakeField === 'domains' ? styles.inputShake : undefined}
                  value={domains}
                  onChange={(e) => {
                    setDomains(e.target.value);
                    clearFieldError('domains');
                  }}
                  placeholder="acme.com, mail.acme.com"
                  aria-invalid={!!fieldErrors.domains}
                />
                {fieldErrors.domains ? (
                  <span className={styles.hintError}>{fieldErrors.domains}</span>
                ) : (
                  <span className={styles.hint}>Separate multiple domains with commas</span>
                )}
              </div>

              <div className={styles.field}>
                <label htmlFor="email">
                  Admin Email <span className={styles.requiredMark}>*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  className={shakeField === 'email' ? styles.inputShake : undefined}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldError('email');
                  }}
                  placeholder="admin@acme.com"
                  autoComplete="email"
                  aria-invalid={!!fieldErrors.email}
                />
                {fieldErrors.email && <span className={styles.hintError}>{fieldErrors.email}</span>}
              </div>

              <button type="button" className={styles.btnPrimary} onClick={handleNext}>
                Next
                <IcChevronRight width={16} height={16} />
              </button>
            </>
          )}

          {/* ── Step 2: Security ── */}
          {step === 2 && (
            <form onSubmit={handleSubmit} noValidate>
              <div className={styles.stepHeading}>
                <h2>Secure Your Account</h2>
                <p>Set a strong password to protect your super admin account.</p>
              </div>

              <div className={styles.field}>
                <label htmlFor="newPassword">
                  New Password <span className={styles.requiredMark}>*</span>
                </label>
                <div className={styles.pwWrap}>
                  <input
                    id="newPassword"
                    type={showNew ? 'text' : 'password'}
                    className={shakeField === 'newPassword' ? styles.inputShake : undefined}
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      clearFieldError('newPassword');
                    }}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    aria-invalid={!!fieldErrors.newPassword}
                  />
                  <PasswordToggle
                    className={styles.eyeBtn}
                    visible={showNew}
                    onToggle={() => setShowNew((v) => !v)}
                  />
                </div>
                {fieldErrors.newPassword && (
                  <span className={styles.hintError}>{fieldErrors.newPassword}</span>
                )}
                {newPassword && (
                  <div className={styles.strengthRow}>
                    <div className={styles.bars}>
                      {[1, 2, 3, 4].map((n) => (
                        <div
                          key={n}
                          className={styles.bar}
                          style={{ background: strength.level >= n ? strength.color : '#e5e7eb' }}
                        />
                      ))}
                    </div>
                    <span className={styles.strengthLabel} style={{ color: strength.color }}>
                      {strength.label}
                    </span>
                  </div>
                )}
              </div>

              <div className={styles.field}>
                <label htmlFor="retypePassword">
                  Retype New Password <span className={styles.requiredMark}>*</span>
                </label>
                <div
                  className={`${styles.pwWrap} ${pwMismatch ? styles.pwError : ''} ${pwMatch ? styles.pwSuccess : ''}`}
                >
                  <input
                    id="retypePassword"
                    type={showRetype ? 'text' : 'password'}
                    className={shakeField === 'retypePassword' ? styles.inputShake : undefined}
                    value={retypePassword}
                    onChange={(e) => {
                      setRetypePassword(e.target.value);
                      clearFieldError('retypePassword');
                    }}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    aria-invalid={!!fieldErrors.retypePassword}
                  />
                  <PasswordToggle
                    className={styles.eyeBtn}
                    visible={showRetype}
                    onToggle={() => setShowRetype((v) => !v)}
                  />
                </div>
                {fieldErrors.retypePassword && (
                  <span className={styles.hintError}>{fieldErrors.retypePassword}</span>
                )}
                {pwMismatch && <span className={styles.hintError}>Passwords do not match</span>}
                {pwMatch && <span className={styles.hintSuccess}>Passwords match</span>}
              </div>

              <div className={styles.navRow}>
                <button type="button" className={styles.btnBack} onClick={handleBack}>
                  <IcChevronLeft width={16} height={16} />
                  Back
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={loading}>
                  {loading ? 'Saving…' : 'Save & Continue'}
                </button>
              </div>
            </form>
          )}

          {/* ── Step 3: Connect Mailboxes ── */}
          {step === 3 && (
            <>
              <div className={styles.stepHeading}>
                <h2>Connect Mailboxes</h2>
                <p>
                  Connect Microsoft 365 or Google Workspace so the platform can index your team's
                  emails. You can skip this and connect later from the dashboard.
                </p>
              </div>

              <ProviderConnectionStep
                onConnected={handleFinish}
                onSkip={handleFinish}
                onBack={handleBack}
              />
            </>
          )}

          {/* ── Step 4: Configure & Start Sync ── */}
          {step === 4 && (
            <>
              <div className={styles.stepHeading}>
                <h2>Configure Sync</h2>
                <p>
                  Choose which mailboxes to sync, how far back to pull emails, and how often to
                  check for new ones.
                </p>
              </div>

              {/* ── Mailbox selection ── */}
              <div className={styles.field}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <label style={{ margin: 0 }}>Mailboxes to sync</label>
                  {syncMailboxes.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      style={{
                        fontSize: 12,
                        color: 'var(--d-text-lo,#94a3b8)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px 4px',
                      }}
                    >
                      {allSelected ? 'Deselect all' : 'Select all'}
                    </button>
                  )}
                </div>

                {syncMailboxes.length > 0 && (
                  <div style={{ position: 'relative', marginBottom: 8 }}>
                    <IcSearch
                      width={14}
                      height={14}
                      style={{
                        position: 'absolute',
                        left: 11,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--d-text-lo,#94a3b8)',
                        pointerEvents: 'none',
                      }}
                    />
                    <input
                      type="text"
                      value={mailboxSearch}
                      onChange={(e) => setMailboxSearch(e.target.value)}
                      placeholder="Search mailboxes by email…"
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '8px 12px 8px 32px',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,.1)',
                        background: 'rgba(0,0,0,.15)',
                        color: 'var(--d-text-hi,#e2e8f0)',
                        fontSize: 13,
                        outline: 'none',
                        fontFamily: 'inherit',
                      }}
                    />
                    {mailboxSearch && (
                      <button
                        type="button"
                        onClick={() => setMailboxSearch('')}
                        aria-label="Clear search"
                        style={{
                          position: 'absolute',
                          right: 8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--d-text-lo,#94a3b8)',
                          cursor: 'pointer',
                          fontSize: 14,
                          lineHeight: 1,
                          padding: 4,
                        }}
                      >
                        <IcClose width={16} height={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}

                {loadingMailboxes ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '16px 0',
                      color: 'var(--d-text-lo,#94a3b8)',
                      fontSize: 13,
                    }}
                  >
                    Loading mailboxes…
                  </div>
                ) : syncMailboxes.length === 0 ? (
                  <div
                    style={{
                      padding: '14px 16px',
                      borderRadius: 8,
                      border: '1px solid rgba(255,255,255,.08)',
                      background: 'rgba(0,0,0,.15)',
                      fontSize: 13,
                      color: 'var(--d-text-lo,#94a3b8)',
                    }}
                  >
                    No mailboxes connected yet. You can configure sync later from Dashboard → Sync.
                  </div>
                ) : filteredMailboxes.length === 0 ? (
                  <div
                    style={{
                      padding: '14px 16px',
                      borderRadius: 8,
                      border: '1px solid rgba(255,255,255,.08)',
                      background: 'rgba(0,0,0,.15)',
                      fontSize: 13,
                      color: 'var(--d-text-lo,#94a3b8)',
                    }}
                  >
                    No mailboxes match “{mailboxSearch.trim()}”.
                  </div>
                ) : (
                  <div
                    style={{
                      maxHeight: 220,
                      overflowY: 'auto',
                      borderRadius: 8,
                      border: '1px solid rgba(255,255,255,.1)',
                      background: 'rgba(0,0,0,.15)',
                    }}
                  >
                    {filteredMailboxes.map((m, i) => {
                      const checked = selectedIds.has(m.id);
                      const isLast = i === filteredMailboxes.length - 1;
                      return (
                        <label
                          key={m.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 14px',
                            borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,.06)',
                            cursor: 'pointer',
                            transition: 'background .1s',
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = 'rgba(255,255,255,.04)')
                          }
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMailbox(m.id)}
                            style={{
                              width: 15,
                              height: 15,
                              accentColor: '#3b82f6',
                              flexShrink: 0,
                              cursor: 'pointer',
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: 'var(--d-text-hi,#e2e8f0)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {m.address}
                            </div>
                            <div
                              style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  background:
                                    m.provider === 'm365'
                                      ? 'rgba(0,120,212,.2)'
                                      : 'rgba(234,67,53,.15)',
                                  color: m.provider === 'm365' ? '#60a5fa' : '#f87171',
                                  fontWeight: 600,
                                }}
                              >
                                {m.provider === 'm365' ? 'M365' : 'Google'}
                              </span>
                              {m.emailCountEstimate != null && (
                                <span style={{ fontSize: 11, color: 'var(--d-text-lo,#94a3b8)' }}>
                                  ~{m.emailCountEstimate.toLocaleString()} emails
                                </span>
                              )}
                              {m.earliestEmailAt && (
                                <span style={{ fontSize: 11, color: 'var(--d-text-lo,#94a3b8)' }}>
                                  from{' '}
                                  {new Date(m.earliestEmailAt).toLocaleDateString('en-US', {
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
                {syncMailboxes.length > 0 && (
                  <span className={styles.hint}>
                    {selectedIds.size === 0
                      ? 'No mailboxes selected — sync will not start.'
                      : `${selectedIds.size} of ${syncMailboxes.length} mailbox${syncMailboxes.length !== 1 ? 'es' : ''} will be synced.`}
                  </span>
                )}
              </div>

              {/* ── Date range ── */}
              <div className={styles.field}>
                <label>Initial sync range</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(
                    [
                      { label: '30 days', value: 30 },
                      { label: '3 months', value: 90 },
                      { label: '6 months', value: 180 },
                      { label: '1 year', value: 365 },
                      { label: 'All time', value: null },
                    ] as { label: string; value: number | null }[]
                  ).map(({ label, value }) => {
                    const active = initialSyncDays === value;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setInitialSyncDays(value)}
                        style={{
                          padding: '6px 13px',
                          borderRadius: 7,
                          fontSize: 13,
                          cursor: 'pointer',
                          border: `1.5px solid ${active ? '#3b82f6' : 'rgba(255,255,255,.12)'}`,
                          background: active ? 'rgba(59,130,246,.15)' : 'transparent',
                          color: active ? '#93c5fd' : 'var(--d-text-lo,#94a3b8)',
                          transition: 'border-color .15s,background .15s',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <span className={styles.hint}>
                  {initialSyncDays
                    ? `Only emails from the last ${initialSyncDays} days are synced initially.`
                    : 'All available emails will be synced — may take longer for large mailboxes.'}
                </span>
              </div>

              {/* ── Intervals + Timezone (two columns) ── */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  marginBottom: 4,
                }}
              >
                <div className={styles.field} style={{ margin: 0 }}>
                  <label>Business hours interval</label>
                  <Combobox
                    searchable={false}
                    value={String(businessHoursIntervalMin)}
                    onChange={(v) => setBusinessHoursInterval(Number(v))}
                    options={[
                      { value: '5', label: 'Every 5 min' },
                      { value: '15', label: 'Every 15 min' },
                      { value: '30', label: 'Every 30 min' },
                      { value: '60', label: 'Every hour' },
                    ]}
                  />
                </div>
                <div className={styles.field} style={{ margin: 0 }}>
                  <label>Off-hours interval</label>
                  <Combobox
                    searchable={false}
                    value={String(offHoursIntervalMin)}
                    onChange={(v) => setOffHoursInterval(Number(v))}
                    options={[
                      { value: '60', label: 'Every hour' },
                      { value: '240', label: 'Every 4 hours' },
                      { value: '480', label: 'Every 8 hours' },
                      { value: '1440', label: 'Once daily' },
                    ]}
                  />
                </div>
              </div>

              <div className={styles.navRow}>
                <button type="button" className={styles.btnBack} onClick={handleBack}>
                  <IcChevronLeft width={16} height={16} />
                  Back
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className={styles.btnBack}
                    onClick={() => handleSaveSchedule(false)}
                    disabled={savingSchedule}
                    hidden
                    style={{ display: 'none' }}
                  >
                    Skip for now old
                  </button>
                  <button
                    type="button"
                    className={styles.btnBack}
                    onClick={handleDefaultSync}
                    disabled={savingSchedule || loadingMailboxes}
                    style={{ fontSize: 13 }}
                  >
                    Skip for now
                  </button>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={() => handleSaveSchedule(true)}
                    disabled={savingSchedule || selectedIds.size === 0}
                  >
                    {savingSchedule
                      ? 'Starting…'
                      : selectedIds.size === 0
                        ? 'Select mailboxes to sync'
                        : `Start Sync  (${selectedIds.size})`}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <p className={styles.copyright}>© 2026 INTELLIGENCE LABS INC.</p>
      </div>
    </div>
  );
}
