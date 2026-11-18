import { Input } from '@/shared/components/ui';
import styles from '@/styles/features/provider-connection/components/ProviderConnectionStep.module.css';

export interface GoogleFormValues {
  serviceAccountJson: string;
  adminEmail: string;
  customerId: string;
}

interface Props {
  values: GoogleFormValues;
  onChange: (v: GoogleFormValues) => void;
  hasSavedSecret?: boolean;
}

export function GoogleForm({ values, onChange, hasSavedSecret = false }: Props) {
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange({ ...values, serviceAccountJson: reader.result as string });
    reader.readAsText(file);
    e.target.value = '';
  };

  let jsonValid = false;
  let serviceAccountClientId = '';
  try {
    if (values.serviceAccountJson) {
      const p = JSON.parse(values.serviceAccountJson) as Record<string, unknown>;
      jsonValid = !!(p['client_email'] && p['client_id'] && p['private_key']);
      serviceAccountClientId = typeof p['client_id'] === 'string' ? p['client_id'] : '';
    }
  } catch {
    /* invalid JSON */
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* File upload — custom UI, not a text input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <span className={styles.uploadLabel}>
          {hasSavedSecret
            ? 'Service Account JSON (saved — upload to replace)'
            : 'Service Account JSON'}
        </span>
        <div className={styles.jsonUploadRow}>
          <label className={styles.uploadBtn}>
            Upload JSON key file
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </label>
          {values.serviceAccountJson && (
            <span className={jsonValid ? styles.jsonOk : styles.jsonErr}>
              {jsonValid ? '✓ Valid key file' : '✗ Missing required fields'}
            </span>
          )}
        </div>
        <span className={styles.uploadHint}>
          Download from Google Cloud Console → IAM → Service Accounts → Keys. The key must have
          domain-wide delegation.
        </span>
        {serviceAccountClientId && (
          <span className={styles.uploadHint}>
            Domain-wide delegation Client ID: <code>{serviceAccountClientId}</code>
          </span>
        )}
        <span className={styles.uploadHint}>
          Required scopes: <code>admin.directory.user.readonly</code>, <code>gmail.readonly</code>
        </span>
      </div>

      <Input
        id="googleAdminEmail"
        label="Delegated Workspace Admin Email"
        type="email"
        value={values.adminEmail}
        onChange={(e) => onChange({ ...values, adminEmail: e.target.value })}
        placeholder="admin@yourdomain.com"
        autoComplete="off"
        hint="The Workspace administrator impersonated for read-only directory discovery"
      />

      <Input
        id="googleCustomerId"
        label="Workspace Customer ID"
        type="text"
        value={values.customerId}
        onChange={(e) => onChange({ ...values, customerId: e.target.value })}
        placeholder="my_customer"
        autoComplete="off"
        hint="Use my_customer to discover users across every domain in this Workspace account"
      />
    </div>
  );
}
