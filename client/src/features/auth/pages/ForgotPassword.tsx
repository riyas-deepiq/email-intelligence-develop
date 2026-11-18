import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../auth.api';
import { useFieldShake, isValidEmail } from '../useFieldShake';
import logoUrl from '@/assets/icons/insight-hub-icon.png';
import { BRAND_NAME, BRAND_TAGLINE } from '@/shared/brand';
import styles from '@/styles/features/auth/pages/ForgotPassword.module.css';

export function ForgotPassword() {
  const [email, setEmail]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]       = useState('');
  const { fieldErrors, shakeField, triggerShake, clearFieldError } = useFieldShake<'email'>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { triggerShake('email', 'Please enter your email'); return; }
    if (!isValidEmail(email)) { triggerShake('email', 'Please enter a valid email address'); return; }
    setLoading(true);
    setError('');
    try {
      await forgotPassword(email.trim());
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img src={logoUrl} alt={`${BRAND_NAME} — ${BRAND_TAGLINE}`} className={styles.logo} />

        {submitted ? (
          <>
            <h2 className={styles.heading}>Check your inbox</h2>
            <p className={styles.subtitle}>
              If an account exists for <strong>{email}</strong>, you'll receive a password reset link shortly. The link expires in 1 hour.
            </p>
            <hr className={styles.divider} />
            <Link to="/login" className={styles.backLink}>Back to login form</Link>
          </>
        ) : (
          <>
            <h2 className={styles.heading}>Reset password</h2>
            <p className={styles.subtitle}>
              Enter your email address and we'll send you a link to reset your password.
            </p>

            {error && <p className={styles.errorMsg}>{error}</p>}

            <form onSubmit={handleSubmit} noValidate>
              <div className={styles.field}>
                <input
                  id="email"
                  type="email"
                  className={`${styles.input} ${shakeField === 'email' ? styles.inputShake : ''}`}
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); clearFieldError('email'); }}
                  placeholder="Email address"
                  autoComplete="email"
                  aria-invalid={!!fieldErrors.email}
                />
                {fieldErrors.email && <p className={styles.fieldErrorMsg}>{fieldErrors.email}</p>}
              </div>

              <button
                type="submit"
                className={`${styles.submitBtn} ${!email.trim() ? styles.submitBtnInactive : ''}`}
                disabled={loading}
              >
                {loading ? 'Sending…' : 'Send Reset Email'}
              </button>
            </form>

            <hr className={styles.divider} />
            <Link to="/login" className={styles.backLink}>Back to login form</Link>
          </>
        )}
      </div>
    </div>
  );
}
