import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../useAuth';
import { fetchEnabledProviders } from '../auth.api';
import { useFieldShake, isValidEmail } from '../useFieldShake';
import { useToast } from '@/shared/toast/useToast';
import { useTheme } from '@/app/theme/useTheme';
import { PasswordToggle } from '@/shared/components/ui';
import logoUrl from '@/assets/icons/insight-hub-icon.png';
import { BRAND_NAME } from '@/shared/brand';
import { BrandText } from '@/shared/components/BrandText';
import GoogleIcon from '@/assets/icons/google.svg?react';
import MicrosoftIcon from '@/assets/icons/microsoft.svg?react';
import IcActivity from '@/assets/icons/activity.svg?react';
import IcMail from '@/assets/icons/mail.svg?react';
import IcMoon from '@/assets/icons/moon.svg?react';
import IcSearch from '@/assets/icons/search.svg?react';
import IcShield from '@/assets/icons/shield-outline.svg?react';
import IcSparkles from '@/assets/icons/sparkles.svg?react';
import IcSun from '@/assets/icons/sun.svg?react';
import styles from '@/styles/features/auth/pages/Login.module.css';

/* ── Inline icons ── */
/* ── Page ── */
export function Login() {
  const { login, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { resolvedTheme, toggleTheme } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<{ provider: string }[]>([]);
  const { fieldErrors, shakeField, triggerShake, clearFieldError } = useFieldShake<
    'email' | 'password'
  >();

  const isFormFilled = email.trim() !== '' && password !== '';

  useEffect(() => {
    fetchEnabledProviders()
      .then(setProviders)
      .catch(() => {
        /* silently ignore */
      });
  }, []);

  if (authLoading) {
    return (
      <div className={styles.loadingScreen}>
        <span className={styles.loadingSpinner} />
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      triggerShake('email', 'Please enter your email');
      return;
    }
    if (!isValidEmail(email)) {
      triggerShake('email', 'Please enter a valid email address');
      return;
    }
    if (!password) {
      triggerShake('password', 'Please enter your password');
      return;
    }

    setLoading(true);
    try {
      const result = await login({ email, password });
      navigate(result.requiresSetup ? '/setup' : '/dashboard');
    } catch {
      toast.error('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginPage}>
      {/* ── Top navbar ── */}
      <nav className={styles.loginNav}>
        <div className={styles.navBrand}>
          <div className={styles.navBrandIcon}>
            <img src={logoUrl} alt={`${BRAND_NAME} logo`} />
          </div>
          <BrandText className={styles.navBrandCopy} />
        </div>
        <div className={styles.navActions}>
          <button
            type="button"
            className={styles.navThemeToggle}
            onClick={toggleTheme}
            title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {resolvedTheme === 'dark' ? <IcSun /> : <IcMoon />}
          </button>
          <a href="/contact" className={styles.navSupportLink}>
            Contact Support
          </a>
        </div>
      </nav>

      {/* ── Split body ── */}
      <div className={styles.loginBody}>
        {/* ── Left hero panel ── */}
        <div className={styles.loginLeft}>
          <div className={styles.heroContent}>
            <div className={styles.heroBadge}>
              <IcSparkles width={13} height={13} /> AI-POWERED BUSINESS INTELLIGENCE
            </div>
            <h1 className={styles.heroHeadline}>
              The fastest way to index <span className={styles.heroAccent}>enterprise email</span>
            </h1>
            <p className={styles.heroSubline}>
              Empower your team to work faster and more confidently with AI-driven email search,
              analysis, and organizational memory.
            </p>
            <div className={styles.heroFeatures}>
              <span className={styles.featureChip}>
                <IcShield width={13} height={13} /> Enterprise security
              </span>
              <span className={styles.featureChip}>
                <IcSparkles width={13} height={13} /> AI summaries
              </span>
              <span className={styles.featureChip}>
                <IcSearch width={13} height={13} /> Semantic search
              </span>
              <span className={styles.featureChip}>
                <IcActivity width={13} height={13} /> Real-time monitoring
              </span>
            </div>
          </div>

          {/* Floating product preview cards */}
          <div className={styles.floatingCards}>
            {/* Stats card */}
            <div className={styles.previewCard}>
              <div className={styles.previewCardHead}>
                <div className={styles.previewCardTitle}>
                  <IcMail width={13} height={13} /> Email Overview
                </div>
                <span className={styles.previewCardBadge}>Live</span>
              </div>
              <div className={styles.previewStatRow}>
                <div className={styles.previewStat}>
                  <span className={styles.previewStatVal}>1.9M</span>
                  <span className={styles.previewStatLab}>Emails</span>
                </div>
                <div className={styles.previewStat}>
                  <span className={styles.previewStatVal}>486K</span>
                  <span className={styles.previewStatLab}>Indexed</span>
                </div>
                <div className={styles.previewStat}>
                  <span className={styles.previewStatVal}>2,341</span>
                  <span className={styles.previewStatLab}>Users</span>
                </div>
                <div className={styles.previewStat}>
                  <span className={styles.previewStatVal}>12</span>
                  <span className={styles.previewStatLab}>Orgs</span>
                </div>
              </div>
              <div className={styles.previewBar}>
                <div
                  className={styles.previewBarSegment}
                  style={{ background: '#4f46e5', flex: 3 }}
                />
                <div
                  className={styles.previewBarSegment}
                  style={{ background: '#7c3aed', flex: 2 }}
                />
                <div
                  className={styles.previewBarSegment}
                  style={{ background: '#0891b2', flex: 1.5 }}
                />
                <div
                  className={styles.previewBarSegment}
                  style={{ background: '#e5e7eb', flex: 2 }}
                />
              </div>
            </div>

            {/* Search preview */}
            <div className={styles.previewCard}>
              <div className={styles.previewSearchRow}>
                <IcSearch width={13} height={13} />
                <span>Ask anything about your email knowledge base…</span>
                <kbd className={styles.previewSearchKbd}>⌘K</kbd>
              </div>
            </div>

            {/* Activity card */}
            <div className={styles.previewCard}>
              <div className={styles.previewCardHead}>
                <div className={styles.previewCardTitle}>
                  <IcActivity width={13} height={13} /> Recent Activity
                </div>
              </div>
              <div className={styles.previewActivityRows}>
                {[
                  { label: 'Q3 Budget Review indexed', color: '#4f46e5', time: '2m ago' },
                  {
                    label: 'AI summary generated for 14 threads',
                    color: '#16a34a',
                    time: '5m ago',
                  },
                  { label: 'New user joined: sarah@acme.com', color: '#0891b2', time: '12m ago' },
                ].map((a, i) => (
                  <div key={i} className={styles.previewActivityRow}>
                    <div className={styles.previewActivityDot} style={{ background: a.color }} />
                    <span>{a.label}</span>
                    <span className={styles.previewActivityTime}>{a.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right form panel ── */}
        <div className={styles.loginRight}>
          <div className={styles.loginFormContainer}>
            <div className={styles.formHeader}>
              <h2>Welcome back</h2>
              <p>Sign in to access your organization's knowledge base.</p>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div className={styles.formField}>
                <label htmlFor="email">
                  Email <span className={styles.requiredMark}>*</span>
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="email"
                    type="email"
                    className={shakeField === 'email' ? styles.inputShake : undefined}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearFieldError('email');
                    }}
                    placeholder="admin@yourcompany.com"
                    autoComplete="email"
                    aria-invalid={!!fieldErrors.email}
                  />
                </div>
                {fieldErrors.email && <p className={styles.fieldErrorMsg}>{fieldErrors.email}</p>}
              </div>

              <div className={styles.formField}>
                <label htmlFor="password">
                  Password <span className={styles.requiredMark}>*</span>
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    className={shakeField === 'password' ? styles.inputShake : undefined}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearFieldError('password');
                    }}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    aria-invalid={!!fieldErrors.password}
                  />
                  <PasswordToggle
                    className={styles.eyeToggle}
                    visible={showPassword}
                    onToggle={() => setShowPassword((v) => !v)}
                  />
                </div>
                {fieldErrors.password && (
                  <p className={styles.fieldErrorMsg}>{fieldErrors.password}</p>
                )}
                <div className={styles.forgotLink}>
                  <Link to="/forgot-password">Forgot password?</Link>
                </div>
              </div>

              <button
                type="submit"
                className={`${styles.ssoBtn} ${!isFormFilled ? styles.ssoBtnInactive : ''}`}
                disabled={loading}
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            {providers.length > 0 && (
              <>
                <div className={styles.divider}>
                  <span>OR CONTINUE WITH</span>
                </div>
                <div className={styles.oauthButtons}>
                  {providers.some((p) => p.provider === 'm365') && (
                    <a href="/api/v1/auth/oidc/m365" className={styles.oauthBtn}>
                      <MicrosoftIcon /> Microsoft
                    </a>
                  )}
                  {providers.some((p) => p.provider === 'google') && (
                    <a href="/api/v1/auth/oidc/google" className={styles.oauthBtn}>
                      <GoogleIcon /> Google
                    </a>
                  )}
                </div>
              </>
            )}

            <div className={styles.formFooter}>
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
              <a href="/contact">Contact Support</a>
            </div>
            <p className={styles.copyright}>© 2026 INTELLIGENCE LABS INC.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
