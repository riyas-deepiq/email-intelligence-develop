import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { OidcConfig } from '@/features/oidc/OidcConfig';
import { fetchJitConfig, updateJitConfig } from '@/features/oidc/oidc.api';
import { useToast } from '@/shared/toast/useToast';
import styles from '@/styles/features/dashboard/pages/Dashboard.module.css';

function JitProvisioningCard() {
  const toast = useToast();
  const qc    = useQueryClient();

  const { data: jit, isLoading } = useQuery({
    queryKey: ['jit-config'],
    queryFn:  fetchJitConfig,
  });

  const [jitEnabled, setJitEnabled] = useState<boolean>(false);
  // No longer editable in the UI, but still round-tripped: PATCH /organizations/jit
  // validates jitDefaultRole and rejects anything other than 'employee' | 'admin',
  // so it has to be read from the server and sent back untouched on save.
  const [jitDefaultRole, setJitDefaultRole] = useState<'employee' | 'admin'>('employee');
  const [dirty, setDirty] = useState(false);

  React.useEffect(() => {
    if (jit) {
      setJitEnabled(jit.jitEnabled);
      setJitDefaultRole(jit.jitDefaultRole);
      setDirty(false);
    }
  }, [jit]);

  const mutation = useMutation({
    mutationFn: updateJitConfig,
    onSuccess: (updated) => {
      qc.setQueryData(['jit-config'], updated);
      setDirty(false);
      toast.success('JIT provisioning settings saved.');
    },
    onError: () => toast.error('Failed to save JIT settings.'),
  });

  return (
    <div className={styles.settingsCard}>
      <div className={styles.settingsCardHeader}>
        <h2 className={styles.settingsCardTitle}>Just-in-Time Provisioning</h2>
        <p className={styles.settingsCardDesc}>
          When enabled, users whose email domain matches your organisation's configured domains
          will be automatically created on their first SSO sign-in.
        </p>
      </div>
      <div className={styles.settingsDivider} />

      {isLoading ? (
        <div className={styles.settingsPlaceholderBody}>
          <div className={styles.settingsPlaceholderLine} style={{ width: '55%' }} />
          <div className={styles.settingsPlaceholderLine} style={{ width: '38%' }} />
        </div>
      ) : (
        <>
          <div className={styles.settingsRow}>
            <div className={styles.settingsRowLeft}>
              <span className={styles.settingsRowTitle}>Enable JIT Provisioning</span>
              <span className={styles.settingsRowDesc}>
                Automatically create accounts for first-time SSO sign-ins from allowed domains
                {jit?.domains ? `: ${jit.domains}` : ''}
              </span>
            </div>
            <button
              role="switch"
              aria-checked={jitEnabled}
              className={`${styles.toggle} ${jitEnabled ? styles.toggleOn : ''}`}
              onClick={() => { setJitEnabled(v => !v); setDirty(true); }}
            />
          </div>

          {dirty && (
            <>
              <div className={styles.settingsDivider} />
              <div className={styles.settingsSaveRow}>
                <button
                  className={styles.settingsSaveBtn}
                  onClick={() => mutation.mutate({ jitEnabled, jitDefaultRole })}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function SsoSettingsView() {
  return (
    <div className={styles.settingsPage}>
      <OidcConfig />
      <JitProvisioningCard />
    </div>
  );
}
