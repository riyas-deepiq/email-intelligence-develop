import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  connectProvider,
  getProviderConfig,
  testProviderConnection,
} from '../provider-connection.api';
import type { GoogleFormValues } from './GoogleForm';
import type { M365FormValues } from './M365Form';
import { ConnectionTestResult } from './ConnectionTestResult';
import { GoogleForm } from './GoogleForm';
import { M365Form } from './M365Form';
import { Button } from '@/shared/components/ui';
import styles from '@/styles/features/provider-connection/components/ProviderConnectionStep.module.css';
import type { TestConnectionResponse } from '../provider-connection.types';
import { useToast } from '@/shared/toast/useToast';
import GoogleIcon from '@/assets/icons/google.svg?react';
import MicrosoftIcon from '@/assets/icons/microsoft.svg?react';

type ProviderTab = 'm365' | 'google';
type UiState = 'idle' | 'testing' | 'tested' | 'connecting' | 'connected';

interface Props {
  onConnected: () => void;
  onSkip?: () => void;
  onBack?: () => void;
  /** Which provider the form opens on. Lets a caller (e.g. the provider strip
   *  on the Mailboxes page) deep-link straight to the tile that was clicked. */
  initialTab?: ProviderTab;
  /** Hides the built-in Microsoft/Google tab row — for callers that already
   *  did the picking themselves and would otherwise show it twice. */
  hideProviderPicker?: boolean;
  /** When supplied, a "+" tile is appended to the provider row that opens the
   *  caller's own catalogue picker (Okta, IMAP, …). */
  onAddProvider?: () => void;
}

export function ProviderConnectionStep({
  onConnected,
  onSkip,
  initialTab = 'm365',
  hideProviderPicker = false,
  onAddProvider,
}: Props) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<ProviderTab>(initialTab);
  const [uiState, setUiState] = useState<UiState>('idle');
  const [testResult, setTestResult] = useState<TestConnectionResponse | null>(null);

  const [m365Values, setM365Values] = useState<M365FormValues>({
    tenantId: '',
    clientId: '',
    clientSecret: '',
  });
  const [googleValues, setGoogleValues] = useState<GoogleFormValues>({
    serviceAccountJson: '',
    adminEmail: '',
    customerId: 'my_customer',
  });

  // Load the saved (non-secret) config so an already-connected provider shows its
  // status and prefilled credentials instead of an empty form.
  const { data: config } = useQuery({ queryKey: ['provider-config'], queryFn: getProviderConfig });

  useEffect(() => {
    if (config?.m365) {
      setM365Values((v) => ({
        ...v,
        tenantId: v.tenantId || (config.m365.tenantId ?? ''),
        clientId: v.clientId || (config.m365.clientId ?? ''),
      }));
    }
    if (config?.google) {
      setGoogleValues((v) => ({
        ...v,
        adminEmail: v.adminEmail || (config.google.adminEmail ?? ''),
        customerId:
          v.customerId === 'my_customer'
            ? (config.google.customerId ?? 'my_customer')
            : v.customerId,
      }));
    }
  }, [config]);

  const connected = activeTab === 'm365' ? !!config?.m365?.connected : !!config?.google?.connected;
  const hasSavedSecret =
    activeTab === 'm365' ? !!config?.m365?.hasClientSecret : !!config?.google?.hasServiceAccount;

  const handleTabChange = (tab: ProviderTab) => {
    setActiveTab(tab);
    setUiState('idle');
    setTestResult(null);
  };

  const handleTest = async () => {
    setUiState('testing');
    setTestResult(null);
    try {
      const payload =
        activeTab === 'm365'
          ? { provider: 'm365' as const, ...m365Values }
          : { provider: 'google' as const, ...googleValues };
      const result = await testProviderConnection(payload);
      setTestResult(result);
      setUiState('tested');
    } catch (err: unknown) {
      const axiosMsg = (err as { response?: { data?: { error?: { message?: string } } } }).response
        ?.data?.error?.message;
      const errMsg =
        axiosMsg ??
        (err instanceof Error ? err.message : 'Request failed — check network and server.');
      setTestResult({
        valid: false,
        permissions: { canListUsers: false, canReadMail: false },
        userCount: 0,
        sampleUsers: [],
        error: errMsg,
      });
      setUiState('tested');
    }
  };

  const handleConnect = async () => {
    setUiState('connecting');
    try {
      const payload =
        activeTab === 'm365'
          ? { provider: 'm365' as const, ...m365Values, confirmed: true as const }
          : { provider: 'google' as const, ...googleValues, confirmed: true as const };
      const result = await connectProvider(payload);
      setUiState('connected');
      if (result.mailboxesDiscovered === 0) {
        toast.warning(
          "Connected, but no mailboxes were found. Check that your organisation's domain matches the tenant.",
          'No mailboxes created',
        );
      } else {
        toast.success(
          `${result.mailboxesDiscovered} mailbox${result.mailboxesDiscovered === 1 ? '' : 'es'} discovered successfully${result.mailboxesCreated < result.mailboxesDiscovered ? ` (${result.mailboxesCreated} new)` : ''}.`,
          'Provider connected',
        );
      }
      onConnected();
    } catch (err: unknown) {
      setUiState('tested');
      const msg = err instanceof Error ? err.message : 'Connection failed — please try again.';
      toast.error(msg, 'Connect failed');
    }
  };

  const canTest =
    activeTab === 'm365'
      ? !!(
          m365Values.tenantId &&
          m365Values.clientId &&
          (m365Values.clientSecret || hasSavedSecret)
        )
      : !!(
          (googleValues.serviceAccountJson || hasSavedSecret) &&
          googleValues.adminEmail &&
          googleValues.customerId
        );

  const isWorking = uiState === 'testing' || uiState === 'connecting';

  return (
    <div>
      {/* Provider picker */}
      {!hideProviderPicker && (
        <div className={styles.providerPicker}>
          <button
            type="button"
            className={`${styles.providerTab} ${activeTab === 'm365' ? styles.providerTabActive : ''}`}
            onClick={() => handleTabChange('m365')}
            disabled={isWorking}
          >
            <span className={styles.providerTabIcon}>
              <MicrosoftIcon />
            </span>
            Microsoft 365
          </button>
          <button
            type="button"
            className={`${styles.providerTab} ${activeTab === 'google' ? styles.providerTabActive : ''}`}
            onClick={() => handleTabChange('google')}
            disabled={isWorking}
          >
            <span className={styles.providerTabIcon}>
              <GoogleIcon />
            </span>
            Google Workspace
          </button>

          {onAddProvider && (
            <button
              type="button"
              className={styles.providerAddTab}
              onClick={onAddProvider}
              disabled={isWorking}
              title="Add another provider"
              aria-label="Add another provider"
            >
              +
            </button>
          )}
        </div>
      )}

      {/* Connected status */}
      {connected && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            marginBottom: '1rem',
            borderRadius: 8,
            background: 'rgba(34,197,94,0.12)',
            border: '1px solid rgba(34,197,94,0.35)',
            color: '#22c55e',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#22c55e',
              flexShrink: 0,
            }}
          />
          {activeTab === 'm365' ? 'Microsoft 365' : 'Google Workspace'} connected — re-enter to
          update, or re-test below.
        </div>
      )}

      {/* Form */}
      {activeTab === 'm365' ? (
        <M365Form values={m365Values} onChange={setM365Values} hasSavedSecret={hasSavedSecret} />
      ) : (
        <GoogleForm
          values={googleValues}
          onChange={setGoogleValues}
          hasSavedSecret={hasSavedSecret}
        />
      )}

      {/* Test result */}
      {testResult && <ConnectionTestResult result={testResult} />}

      {/* Actions */}
      <div className={styles.actions}>
        {onSkip && (
          <Button variant="ghost" onClick={onSkip} disabled={isWorking}>
            Skip for now
          </Button>
        )}

        <div className={styles.actionsRight}>
          <Button
            variant="secondary"
            loading={uiState === 'testing'}
            disabled={!canTest || isWorking}
            onClick={handleTest}
          >
            Test Connection
          </Button>

          {testResult?.valid && (
            <Button
              variant="primary"
              loading={uiState === 'connecting'}
              disabled={isWorking}
              onClick={handleConnect}
            >
              Connect & Discover →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
