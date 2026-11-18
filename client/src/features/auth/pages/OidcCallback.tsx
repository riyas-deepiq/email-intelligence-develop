import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { completeOidcFlow, exchangeOidcCode } from '../auth.api';
import { useAuth } from '../useAuth';
import { useToast } from '@/shared/toast/useToast';

export function OidcCallback() {
  const [params] = useSearchParams();
  const { loginFromOidc } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const handled = useRef(false);
  const code = params.get('code');
  const state = params.get('state');
  const errorMessage = params.get('error');

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    if (errorMessage) {
      toast.error(decodeURIComponent(errorMessage), 'Sign-in failed');
      navigate('/login', { replace: true });
      return;
    }

    if (!code) {
      navigate('/login', { replace: true });
      return;
    }

    const exchange = state
      ? completeOidcFlow(code, state) // frontend-redirect: code+state from provider
      : exchangeOidcCode(code); // server-redirect: one-time code from our server

    exchange
      .then(({ tokens, user }) => {
        loginFromOidc(tokens, user);
        toast.success(`Welcome back, ${user.displayName}`, 'Signed in');
        navigate('/dashboard', { replace: true });
      })
      .catch((err: unknown) => {
        const msg =
          (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
            ?.message ?? 'Authentication failed. Please try again.';
        toast.error(msg, 'Sign-in failed');
        navigate('/login', { replace: true });
      });
  }, [code, errorMessage, loginFromOidc, navigate, state, toast]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--auth-spinner-bg, #0f172a)',
        gap: '1rem',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          border: '3px solid #334155',
          borderTopColor: '#4f46e5',
          borderRadius: '50%',
          display: 'inline-block',
          animation: 'spin 0.7s linear infinite',
        }}
      />
      <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>Completing sign-in…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
