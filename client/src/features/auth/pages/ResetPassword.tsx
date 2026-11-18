import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../auth.api';
import { useFieldShake } from '../useFieldShake';
import logoUrl from '@/assets/icons/insight-hub-icon.png';
import { BRAND_NAME } from '@/shared/brand';
import { BrandText } from '@/shared/components/BrandText';
import styles from '@/styles/features/auth/pages/Login.module.css';

export function ResetPassword() {
  const [searchParams]          = useSearchParams();
  const token                   = searchParams.get('token') ?? '';
  const navigate                = useNavigate();

  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(false);
  const { fieldErrors, shakeField, triggerShake, clearFieldError } = useFieldShake<'password' | 'confirm'>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) { triggerShake('password', 'Please enter a new password'); return; }
    if (!confirm)  { triggerShake('confirm', 'Please confirm your new password'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (!token) { setError('Invalid or missing reset token. Please request a new link.'); return; }

    setLoading(true);
    setError('');
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message;
      setError(msg ?? 'This reset link is invalid or has expired. Please request a new one.');
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
            <h1>Set a new password</h1>
            <p>Choose a strong password you haven't used before. It must be at least 8 characters long.</p>
          </div>
        </div>
      </div>

      <div className={styles.loginRight}>
        <div className={styles.loginFormContainer}>
          {done ? (
            <>
              <div className={styles.formHeader}>
                <h2>Password updated</h2>
                <p>Your password has been changed successfully. You can now sign in with your new password.</p>
              </div>
              <button className={styles.ssoBtn} onClick={() => navigate('/login')}>
                Go to sign in
              </button>
            </>
          ) : (
            <>
              <div className={styles.formHeader}>
                <h2>Create new password</h2>
                <p>Enter and confirm your new password below.</p>
              </div>

              {error && <p className={styles.errorMsg}>{error}</p>}

              {!token ? (
                <p className={styles.errorMsg}>
                  No reset token found. Please use the link from your email or{' '}
                  <Link to="/forgot-password">request a new one</Link>.
                </p>
              ) : (
                <form onSubmit={handleSubmit} noValidate>
                  <div className={styles.formField}>
                    <label htmlFor="password">New password <span className={styles.requiredMark}>*</span></label>
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
                        placeholder="Repeat your new password"
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
                    {loading ? 'Saving…' : 'Set new password'}
                  </button>
                </form>
              )}

              <div className={styles.formFooter} style={{ marginTop: 16 }}>
                <Link to="/login" style={{ fontSize: 13, color: 'var(--text-lo)', textDecoration: 'none' }}>
                  ← Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
