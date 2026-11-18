import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { ProviderConnectionStep } from '@/features/provider-connection/components/ProviderConnectionStep';
import {
  ProviderCatalogueModal, type ProviderId,
} from '@/features/provider-connection/components/ProviderCatalogue';
import { getProviderConfig } from '@/features/provider-connection/provider-connection.api';
import { useToast } from '@/shared/toast/useToast';
import { View, viewPath } from '../dashboard.types';
import { RolesView } from './RolesView';
import { SsoSettingsView } from './SsoSettingsView';
import styles from '@/styles/features/dashboard/pages/Dashboard.module.css';

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TAB_PROVIDERS = 'providers';
const TAB_SSO       = 'sso';
const TAB_ROLES     = 'roles';

const TABS = [
  { id: TAB_PROVIDERS, label: 'Email Providers' },
  { id: TAB_SSO,       label: 'SSO Settings' },
  { id: TAB_ROLES,     label: 'Roles & Permissions' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Bare /admin-console lands here. */
const DEFAULT_TAB: TabId = TAB_PROVIDERS;

function isTabId(v: string): v is TabId {
  return TABS.some((t) => t.id === v);
}

// ─── Email providers tab ──────────────────────────────────────────────────────

/**
 * The full provider credential form, as it appeared on the old standalone
 * /email-providers page. The compact strip on Sync Mail covers the quick path;
 * this is the expanded view for setting a provider up from scratch.
 */
function EmailProvidersPanel() {
  const qc    = useQueryClient();
  const toast = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [provider,   setProvider]   = useState<ProviderId>('m365');

  const { data: config } = useQuery({ queryKey: ['provider-config'], queryFn: getProviderConfig });

  const isConnected = (id: ProviderId) =>
    id === 'm365' ? !!config?.m365?.connected : !!config?.google?.connected;

  const handleConnected = () => {
    qc.invalidateQueries({ queryKey: ['mailboxes'] });
    qc.invalidateQueries({ queryKey: ['provider-status'] });
    qc.invalidateQueries({ queryKey: ['provider-config'] });
    toast.success('Provider connected. Mailboxes are being imported.');
  };

  return (
    <div className={styles.adminPanel}>
      <div className={styles.settingsCard}>
        <div className={styles.settingsCardHeader}>
          <h2 className={styles.settingsCardTitle}>Email Providers</h2>
          <p className={styles.settingsCardDesc}>
            Connect Microsoft 365 or Google Workspace. Credentials are stored encrypted;
            connecting imports every mailbox on your allowed domains.
          </p>
        </div>
        <div className={styles.settingsDivider} />
        {/* settingsCard pads its header but not its body — without this wrapper
            the form sits flush against the card edge, misaligned with the title. */}
        <div className={styles.settingsCardBody}>
          <ProviderConnectionStep
            key={provider}
            initialTab={provider}
            onConnected={handleConnected}
            onAddProvider={() => setPickerOpen(true)}
          />
        </div>
      </div>

      <ProviderCatalogueModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(id) => { setProvider(id); setPickerOpen(false); }}
        isConnected={isConnected}
      />
    </div>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export function AdminConsoleView() {
  const navigate = useNavigate();
  const location = useLocation();

  // Tab lives in the URL (/admin-console/sso) so it survives reload, back/forward
  // and deep links — the shell router already routes any /admin-console/* here.
  const segment = location.pathname.split('/')[2] ?? '';
  const activeTab: TabId = isTabId(segment) ? segment : DEFAULT_TAB;

  const goToTab = (tab: TabId) => navigate(`${viewPath(View.Admin)}/${tab}`);

  return (
    <div className={styles.adminPage}>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className={styles.adminTabs} role="tablist" aria-label="Admin console sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`${styles.adminTab} ${activeTab === t.id ? styles.adminTabActive : ''}`}
            onClick={() => goToTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Hosted views ────────────────────────────────────────────────────── */}
      <div className={styles.adminTabPanel}>
        {activeTab === TAB_PROVIDERS && <EmailProvidersPanel />}
        {activeTab === TAB_SSO       && <SsoSettingsView />}
        {activeTab === TAB_ROLES     && <RolesView />}
      </div>

    </div>
  );
}
