import React, { useState, useEffect } from 'react';
import styles from '@/styles/features/oidc/OidcConfig.module.css';
import {
  testOidcConnector,
  saveOidcConnector,
  fetchAuthProviders,
  disconnectOidcProvider,
  ConnectorStatus,
} from './oidc.api';
import { useToast } from '@/shared/toast/useToast';
import GoogleLogo from '@/assets/icons/google.svg?react';
import MicrosoftLogo from '@/assets/icons/microsoft.svg?react';
import OktaLogo from '@/assets/icons/okta.svg?react';
import KeycloakLogo from '@/assets/icons/keycloak.svg?react';
import IcFlash from '@/assets/icons/flash.svg?react';
import IcSave from '@/assets/icons/save.svg?react';
import IcEye from '@/assets/icons/eye.svg?react';
import IcEyeOff from '@/assets/icons/eye-off.svg?react';
import IcChevronDown from '@/assets/icons/chevron-down.svg?react';

// ─── Enums ───────────────────────────────────────────────────────────────────

enum ProviderId {
  Google = 'google',
  Azure = 'azure',
  Okta = 'okta',
  Keycloak = 'keycloak',
}

enum TestState {
  Idle = 'idle',
  Testing = 'testing',
  Saving = 'saving',
  Saved = 'saved',
  Fail = 'fail',
}

// ─── Provider catalogue ───────────────────────────────────────────────────────

const PROVIDERS = [
  { id: ProviderId.Google, name: 'Google', color: '#4285f4' },
  { id: ProviderId.Azure, name: 'Azure AD', color: '#0078d4' },
  { id: ProviderId.Okta, name: 'Okta', color: '#007dc1' },
  { id: ProviderId.Keycloak, name: 'Keycloak', color: '#e8441a' },
] as const;

const PROVIDER_LOGOS: Record<ProviderId, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  [ProviderId.Google]: GoogleLogo,
  [ProviderId.Azure]: MicrosoftLogo,
  [ProviderId.Okta]: OktaLogo,
  [ProviderId.Keycloak]: KeycloakLogo,
};

// ─── Per-connector state ──────────────────────────────────────────────────────

type ConnectorData = {
  name: string;
  // Smart issuer inputs — provider-specific
  tenantId: string; // Azure AD
  oktaDomain: string; // Okta (e.g. your-org.okta.com)
  keycloakHost: string; // Keycloak host URL
  keycloakRealm: string; // Keycloak realm
  // Common credentials
  clientId: string;
  clientSecret: string; // empty = unchanged (server keeps existing when empty)
  hasClientSecret: boolean; // true = server has a saved secret already
  scopes: string[];
  redirectUri: string;
  status: ConnectorStatus;
  createdAt: string | null;
  savedAt: string | null;
};

const REDIRECT_URI = `${window.location.origin}/auth/callback`;

function makeDefault(_id: ProviderId, name: string): ConnectorData {
  return {
    name: `${name} OIDC Connector`,
    tenantId: '',
    oktaDomain: '',
    keycloakHost: '',
    keycloakRealm: '',
    clientId: '',
    clientSecret: '',
    hasClientSecret: false,
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    redirectUri: REDIRECT_URI,
    status: ConnectorStatus.Inactive,
    createdAt: null,
    savedAt: null,
  };
}

// Derives the issuer URL from smart inputs — no manual URL entry needed.
function computeIssuer(id: ProviderId, data: ConnectorData): string {
  switch (id) {
    case ProviderId.Google:
      return 'https://accounts.google.com';
    case ProviderId.Azure: {
      const t = data.tenantId.trim();
      return t ? `https://login.microsoftonline.com/${t}/v2.0` : '';
    }
    case ProviderId.Okta: {
      const d = data.oktaDomain
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
      return d ? `https://${d}/oauth2/default` : '';
    }
    case ProviderId.Keycloak: {
      const h = data.keycloakHost.trim().replace(/\/$/, '');
      const r = data.keycloakRealm.trim();
      return h && r ? `${h}/realms/${r}` : '';
    }
  }
}

const REVERSE_PROVIDER_MAP: Partial<Record<string, ProviderId>> = {
  google: ProviderId.Google,
  m365: ProviderId.Azure,
};

const INITIAL: Record<ProviderId, ConnectorData> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, makeDefault(p.id, p.name)]),
) as Record<ProviderId, ConnectorData>;

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className={styles.copyBtn} onClick={handleCopy} type="button" disabled={!text}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// ─── Smart issuer inputs per provider ────────────────────────────────────────

function SmartIssuerInputs({
  providerId,
  data,
  update,
}: {
  providerId: ProviderId;
  data: ConnectorData;
  update: (patch: Partial<ConnectorData>) => void;
}) {
  switch (providerId) {
    case ProviderId.Google:
      return null; // Google issuer is fixed — no input needed

    case ProviderId.Azure:
      return (
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Tenant ID</label>
          <input
            className={styles.fieldInput}
            value={data.tenantId}
            onChange={(e) => update({ tenantId: e.target.value })}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
          <span className={styles.fieldHint}>
            Found in Azure Portal → Azure Active Directory → Overview
          </span>
        </div>
      );

    case ProviderId.Okta:
      return (
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Okta Domain</label>
          <input
            className={styles.fieldInput}
            value={data.oktaDomain}
            onChange={(e) => update({ oktaDomain: e.target.value })}
            placeholder="your-company.okta.com"
          />
          <span className={styles.fieldHint}>
            Your Okta org domain — found in Admin Console → Settings → Account
          </span>
        </div>
      );

    case ProviderId.Keycloak:
      return (
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Host URL</label>
            <input
              className={styles.fieldInput}
              value={data.keycloakHost}
              onChange={(e) => update({ keycloakHost: e.target.value })}
              placeholder="https://keycloak.your-company.com"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Realm</label>
            <input
              className={styles.fieldInput}
              value={data.keycloakRealm}
              onChange={(e) => update({ keycloakRealm: e.target.value })}
              placeholder="master"
            />
          </div>
        </div>
      );
  }
}

// ─── OidcConfig ───────────────────────────────────────────────────────────────

export function OidcConfig({ onSave }: { onSave?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Record<ProviderId, ConnectorData>>(INITIAL);
  const [selectedId, setSelectedId] = useState<ProviderId>(ProviderId.Google);
  const [showSecret, setShowSecret] = useState(false);
  const [scopeInput, setScopeInput] = useState('');
  const [testState, setTestState] = useState<TestState>(TestState.Idle);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    fetchAuthProviders()
      .then((providers) => {
        setData((d) => {
          const next = { ...d };
          for (const ap of providers) {
            const pid = REVERSE_PROVIDER_MAP[ap.provider];
            if (!pid) continue;
            next[pid] = {
              ...next[pid],
              status: ap.enabled ? ConnectorStatus.Active : next[pid].status,
              createdAt: ap.createdAt,
              savedAt: ap.updatedAt,
              clientId: ap.clientId ?? next[pid].clientId,
              redirectUri: ap.redirectUri ?? next[pid].redirectUri,
              tenantId: ap.tenantId ?? next[pid].tenantId,
              hasClientSecret: ap.hasClientSecret,
              clientSecret: '', // never returned by server; empty = keep existing on next save
            };
          }
          return next;
        });
      })
      .catch(() => {});
  }, []);

  const provider = PROVIDERS.find((p) => p.id === selectedId)!;
  const form = data[selectedId];
  const issuer = computeIssuer(selectedId, form);

  const update = (patch: Partial<ConnectorData>) =>
    setData((d) => ({ ...d, [selectedId]: { ...d[selectedId], ...patch } }));

  const addScope = (raw: string) => {
    const s = raw.trim().toLowerCase();
    if (s && !form.scopes.includes(s)) update({ scopes: [...form.scopes, s] });
  };
  const removeScope = (s: string) => update({ scopes: form.scopes.filter((x) => x !== s) });
  const handleScopesKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
      e.preventDefault();
      addScope(scopeInput);
      setScopeInput('');
    }
    if (e.key === 'Backspace' && !scopeInput && form.scopes.length > 0)
      update({ scopes: form.scopes.slice(0, -1) });
  };

  const handleTestAndSave = async () => {
    if (!form.name.trim()) {
      toast.error('Connector name is required.');
      return;
    }
    if (!issuer) {
      toast.error('Please fill in all issuer fields.');
      return;
    }
    if (!form.clientId.trim()) {
      toast.error('Client ID is required.');
      return;
    }
    if (!form.clientSecret.trim() && !form.hasClientSecret) {
      toast.error('Client Secret is required.');
      return;
    }

    const payload = {
      provider: selectedId,
      name: form.name,
      issuer,
      clientId: form.clientId,
      clientSecret: form.clientSecret,
      scopes: form.scopes,
      redirectUri: form.redirectUri,
    };
    type AxiosLike = { response?: { data?: { message?: string } } };

    setTestState(TestState.Testing);
    try {
      const result = await testOidcConnector(payload);
      if (!result.success) {
        setTestState(TestState.Fail);
        toast.error(result.message || 'Connection test failed. Check your credentials.');
        setTimeout(() => setTestState(TestState.Idle), 4000);
        return;
      }
    } catch (err: unknown) {
      setTestState(TestState.Fail);
      toast.error((err as AxiosLike).response?.data?.message ?? 'Connection test failed.');
      setTimeout(() => setTestState(TestState.Idle), 4000);
      return;
    }

    setTestState(TestState.Saving);
    try {
      const connector = await saveOidcConnector(payload);
      update({
        status: ConnectorStatus.Active,
        createdAt: connector.createdAt,
        savedAt: connector.updatedAt,
      });
      setTestState(TestState.Saved);
      toast.success('Connection verified and configuration saved.');
      onSave?.();
      setTimeout(() => setTestState(TestState.Idle), 4000);
    } catch (err: unknown) {
      setTestState(TestState.Fail);
      toast.error(
        (err as AxiosLike).response?.data?.message ?? 'Configuration could not be saved.',
      );
      setTimeout(() => setTestState(TestState.Idle), 4000);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const result = await disconnectOidcProvider(selectedId);
      update({
        status: ConnectorStatus.Inactive,
        clientId: '',
        clientSecret: '',
        hasClientSecret: false,
        tenantId: '',
        oktaDomain: '',
        keycloakHost: '',
        keycloakRealm: '',
        createdAt: null,
        savedAt: null,
      });
      toast.success(
        result.mailboxesDeleted > 0
          ? `Provider disconnected. ${result.mailboxesDeleted} mailbox(es) removed.`
          : 'Provider disconnected.',
      );
    } catch {
      toast.error('Failed to disconnect provider.');
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  };

  const isActive = form.status === ConnectorStatus.Active;
  const isBusy = testState === TestState.Testing || testState === TestState.Saving;

  return (
    <div className={styles.page}>
      {/* ── Provider picker ────────────────────────────────────────────────── */}
      <div className={styles.providerPicker}>
        {PROVIDERS.map((p) => {
          const Logo = PROVIDER_LOGOS[p.id];
          const active = data[p.id].status === ConnectorStatus.Active;
          const selected = selectedId === p.id;
          return (
            <button
              key={p.id}
              className={`${styles.providerCard} ${selected ? styles.providerCardSelected : ''}`}
              onClick={() => {
                setSelectedId(p.id);
                setShowSecret(false);
                setTestState(TestState.Idle);
                setConfirmDisconnect(false);
              }}
            >
              <div className={styles.providerCardLogo} style={{ borderColor: p.color }}>
                <Logo width={22} height={22} />
              </div>
              <span className={styles.providerCardName}>{p.name}</span>
              {active && (
                <span
                  className={styles.providerCardStatus}
                  aria-label="Connected"
                  title="Connected"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Config form ────────────────────────────────────────────────────── */}
      <div className={styles.formCard}>
        {/* Header */}
        <div className={styles.formHeader}>
          <div className={styles.formHeaderLeft}>
            <h2 className={styles.formTitle}>General Settings</h2>
            <p className={styles.formSubtitle}>{provider.name} OIDC connector</p>
          </div>
          <div className={styles.formHeaderRight}>
            <span className={isActive ? styles.statusPillActive : styles.statusPillInactive}>
              <span className={styles.statusDot} />
              {isActive ? 'Active' : 'Inactive'}
            </span>
            <button
              className={`${styles.saveBtn} ${testState === TestState.Fail ? styles.saveBtnFail : testState === TestState.Saved ? styles.saveBtnSaved : ''}`}
              onClick={handleTestAndSave}
              disabled={isBusy}
            >
              {testState === TestState.Testing && (
                <>
                  <IcFlash /> Testing…
                </>
              )}
              {testState === TestState.Saving && (
                <>
                  <IcSave /> Saving…
                </>
              )}
              {testState === TestState.Saved && (
                <>
                  <IcSave /> Saved ✓
                </>
              )}
              {testState === TestState.Fail && (
                <>
                  <IcFlash /> Test Failed
                </>
              )}
              {testState === TestState.Idle && (
                <>
                  <IcFlash /> Test & Save
                </>
              )}
            </button>
          </div>
        </div>

        <div className={styles.formDivider} />

        {/* Connector Name */}
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Connector Name</label>
          <input
            className={styles.fieldInput}
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="e.g. Production Azure AD"
          />
        </div>

        {/* Smart issuer inputs (provider-specific) */}
        <SmartIssuerInputs providerId={selectedId} data={form} update={update} />

        {/* Client ID + Secret */}
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Client ID</label>
            <input
              className={styles.fieldInput}
              value={form.clientId}
              onChange={(e) => update({ clientId: e.target.value })}
              placeholder="Enter client ID"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>
              Client Secret
              {form.hasClientSecret && !form.clientSecret && (
                <span className={styles.secretSavedBadge}>Saved</span>
              )}
            </label>
            <div className={styles.secretWrap}>
              <input
                className={`${styles.fieldInput} ${styles.secretInput}`}
                type={showSecret ? 'text' : 'password'}
                value={form.clientSecret}
                onChange={(e) => update({ clientSecret: e.target.value })}
                placeholder={
                  form.hasClientSecret
                    ? 'Enter new secret to replace saved one'
                    : 'Enter client secret'
                }
              />
              <button
                className={styles.eyeBtn}
                onClick={() => setShowSecret((s) => !s)}
                type="button"
              >
                {showSecret ? <IcEyeOff /> : <IcEye />}
              </button>
            </div>
          </div>
        </div>

        {/* Scopes */}
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Scopes</label>
          <div className={styles.scopesBox}>
            {form.scopes.map((s) => (
              <span key={s} className={styles.scopeTag}>
                {s}
                <button className={styles.scopeX} onClick={() => removeScope(s)} type="button">
                  ×
                </button>
              </span>
            ))}
            <input
              className={styles.scopeInput}
              placeholder="Add scope…"
              value={scopeInput}
              onChange={(e) => setScopeInput(e.target.value)}
              onKeyDown={handleScopesKey}
            />
            <span className={styles.scopeChevron}>
              <IcChevronDown />
            </span>
          </div>
        </div>

        {/* Auto-generated URLs */}
        <div className={styles.formDivider} />
        <div className={styles.generatedSection}>
          <span className={styles.generatedLabel}>AUTO-GENERATED</span>
          <div className={styles.generatedFields}>
            <div className={styles.generatedField}>
              <span className={styles.generatedFieldLabel}>Issuer URL</span>
              <div className={styles.generatedRow}>
                <span
                  className={`${styles.generatedUrl} ${!issuer ? styles.generatedUrlEmpty : ''}`}
                >
                  {issuer || 'Fill in the fields above to generate the issuer URL'}
                </span>
                <CopyButton text={issuer} />
              </div>
            </div>
            <div className={styles.generatedField}>
              <span className={styles.generatedFieldLabel}>Redirect URI</span>
              <div className={styles.generatedRow}>
                <span className={styles.generatedUrl}>{form.redirectUri}</span>
                <CopyButton text={form.redirectUri} />
              </div>
              <span className={styles.fieldHint}>Register this URL in your identity provider</span>
            </div>
          </div>
        </div>

        {/* Disconnect */}
        {isActive && (
          <>
            <div className={styles.formDivider} />
            <div className={styles.disconnectSection}>
              {confirmDisconnect ? (
                <div className={styles.disconnectConfirm}>
                  <p className={styles.disconnectWarning}>
                    This will remove all credentials and delete connected mailboxes. Are you sure?
                  </p>
                  <div className={styles.disconnectActions}>
                    <button
                      className={styles.disconnectBtn}
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                    >
                      {disconnecting ? 'Disconnecting…' : 'Yes, disconnect'}
                    </button>
                    <button
                      className={styles.disconnectCancelBtn}
                      onClick={() => setConfirmDisconnect(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button className={styles.disconnectBtn} onClick={() => setConfirmDisconnect(true)}>
                  Disconnect provider
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
