import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { acceptInvite } from '../auth.api';
import { useAuth } from '../useAuth';
import { useFieldShake } from '../useFieldShake';
import logoUrl from '@/assets/icons/insight-hub-icon.png';
import { BRAND_NAME } from '@/shared/brand';
import { BrandText } from '@/shared/components/BrandText';
import styles from '@/styles/features/auth/pages/Login.module.css';

export function AcceptInvite() {
  const [searchParams]          = useSearchParams();
  const token                   = searchParams.get('token') ?? '';
  const navigate                = useNavigate();
  const { loginFromOidc }       = useAuth();

  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const { fieldErrors, shakeField, triggerShake, clearFieldError } = useFieldShake<'password' | 'confirm'>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) { triggerShake('password', 'Please enter a password'); return; }
    if (!confirm)  { triggerShake('confirm', 'Please confirm your password'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (!token) { setError('Invalid or missing invite token.'); return; }

    setLoading(true);
    setError('');
    try {
      const { tokens, user } = await acceptInvite(token, password);
      loginFromOidc(tokens, user);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message;
      setError(msg ?? 'This invite link is invalid or has expired. Please contact your administrator.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginLeft}>
        <div className={styles.loginLeftContent}>
          <div className={styles.brandLogo}>
            <div className={styles.brandIcon}>
              <img src={logoUrl} alt={`${BRAND_NAME} logo`} />
            </div>
            <BrandText className={styles.brandCopy} />
          </div>
          <div className={styles.heroText}>
            <h1>You've been invited</h1>
            <p>Set a password to activate your account and get access to your organization's knowledge base.</p>
          </div>
        </div>
      </div>

      <div className={styles.loginRight}>
        <div className={styles.loginFormContainer}>
          <div className={styles.formHeader}>
            <h2>Activate your account</h2>
            <p>Choose a strong password to complete your setup.</p>
          </div>

          {error && <p className={styles.errorMsg}>{error}</p>}

          {!token ? (
            <p className={styles.errorMsg}>
              No invite token found. Please use the link from your invitation email or contact your administrator.
            </p>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className={styles.formField}>
                <label htmlFor="password">Password <span className={styles.requiredMark}>*</span></label>
                <div className={styles.inputWrapper}>
                  <input
                    id="password"
                    type="password"
                    className={shakeField === 'password' ? styles.inputShake : undefined}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); clearFieldError('password'); }}
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                    aria-invalid={!!fieldErrors.password}
                  />
                </div>
                {fieldErrors.password && <p className={styles.fieldErrorMsg}>{fieldErrors.password}</p>}
              </div>

              <div className={styles.formField}>
                <label htmlFor="confirm">Confirm password <span className={styles.requiredMark}>*</span></label>
                <div className={styles.inputWrapper}>
                  <input
                    id="confirm"
                    type="password"
                    className={shakeField === 'confirm' ? styles.inputShake : undefined}
                    value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); clearFieldError('confirm'); }}
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                    aria-invalid={!!fieldErrors.confirm}
                  />
                </div>
                {fieldErrors.confirm && <p className={styles.fieldErrorMsg}>{fieldErrors.confirm}</p>}
              </div>

              <button
                type="submit"
                className={`${styles.ssoBtn} ${(!password || !confirm) ? styles.ssoBtnInactive : ''}`}
                disabled={loading}
              >
                {loading ? 'Activating…' : 'Activate account'}
              </button>
            </form>
          )}

          <div className={styles.formFooter} style={{ marginTop: 16 }}>
            <Link to="/login" style={{ fontSize: 13, color: 'var(--text-lo)', textDecoration: 'none' }}>
              ← Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
