import React, { useCallback, useEffect, useState } from 'react';
import { fetchMe, login as loginApi, logoutApi } from './auth.api';
import { updateUser } from '../users/users.api';
import { setToken, clearToken } from '@/shared/api/client';
import { queryClient } from '@/app/query/queryClient';
import { Role } from '@/shared/types/enums';
import type { LoginPayload, TokenPair, User } from './auth.types';
import { AuthContext } from './auth.context';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [requiresSetup, setRequiresSetup] = useState(
    () => sessionStorage.getItem('requiresFirstLoginSetup') === 'true',
  );

  useEffect(() => {
    const handleUnauthorized = () => {
      clearToken();
      sessionStorage.removeItem('requiresFirstLoginSetup');
      setRequiresSetup(false);
      setUser(null);
      setLoading(false);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    fetchMe()
      .then((me) => {
        setUser(me);
        const serverNeedsSetup = !!me.isFirstLogin;
        if (serverNeedsSetup) {
          sessionStorage.setItem('requiresFirstLoginSetup', 'true');
        } else {
          sessionStorage.removeItem('requiresFirstLoginSetup');
        }
        setRequiresSetup(serverNeedsSetup);
      })
      .catch(() => {
        clearToken();
        sessionStorage.removeItem('requiresFirstLoginSetup');
        setRequiresSetup(false);
        queryClient.clear();
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const { tokens, user: me, isFirstLogin } = await loginApi(payload);
    setToken(tokens.accessToken);
    const needsSetup = !!(isFirstLogin && me.role === Role.SuperAdmin);
    if (needsSetup) {
      sessionStorage.setItem('requiresFirstLoginSetup', 'true');
    } else {
      sessionStorage.removeItem('requiresFirstLoginSetup');
    }
    setRequiresSetup(needsSetup);
    setUser(me);
    return { requiresSetup: needsSetup };
  }, []);

  const logout = useCallback(async () => {
    await logoutApi().catch(() => undefined);
    clearToken();
    sessionStorage.removeItem('requiresFirstLoginSetup');
    setRequiresSetup(false);
    setUser(null);
    queryClient.clear();
  }, []);

  const loginFromOidc = useCallback((tokens: TokenPair, oidcUser: User) => {
    setToken(tokens.accessToken);
    setUser(oidcUser);
  }, []);

  const completeSetup = useCallback((tokens: TokenPair, updatedUser: User) => {
    setToken(tokens.accessToken);
    sessionStorage.removeItem('requiresFirstLoginSetup');
    setRequiresSetup(false);
    setUser(updatedUser);
  }, []);

  const updateProfile = useCallback(
    async (patch: { displayName?: string; email?: string }) => {
      if (!user) return;
      const updated = await updateUser(user.id, patch);
      setUser((prev) =>
        prev ? { ...prev, displayName: updated.displayName, email: updated.email } : prev,
      );
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        requiresSetup,
        login,
        loginFromOidc,
        logout,
        completeSetup,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
