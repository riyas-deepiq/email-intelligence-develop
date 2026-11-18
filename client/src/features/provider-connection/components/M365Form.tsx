import { Input } from '@/shared/components/ui';

export interface M365FormValues {
  tenantId:     string;
  clientId:     string;
  clientSecret: string;
}

interface Props {
  values:   M365FormValues;
  onChange: (v: M365FormValues) => void;
  hasSavedSecret?: boolean;
}

export function M365Form({ values, onChange, hasSavedSecret = false }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Input
        id="m365TenantId"
        label="Tenant ID"
        type="text"
        value={values.tenantId}
        onChange={(e) => onChange({ ...values, tenantId: e.target.value })}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        autoComplete="off"
        hint="Azure Directory (tenant) ID from your Azure AD portal"
      />

      <Input
        id="m365ClientId"
        label="Application (Client) ID"
        type="text"
        value={values.clientId}
        onChange={(e) => onChange({ ...values, clientId: e.target.value })}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        autoComplete="off"
      />

      <Input
        id="m365ClientSecret"
        label={hasSavedSecret ? 'Client Secret (saved — leave blank to keep)' : 'Client Secret'}
        type="password"
        value={values.clientSecret}
        onChange={(e) => onChange({ ...values, clientSecret: e.target.value })}
        placeholder={hasSavedSecret ? '•••••••••••••••••••••••••••••••••••••••••••••••••' : 'Enter client secret value'}
        autoComplete="new-password"
        hint={<>Required permissions: <code>User.Read.All</code>, <code>Mail.Read.All</code></>}
      />
    </div>
  );
}
