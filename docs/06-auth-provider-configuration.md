# Auth Provider Configuration

After the superadmin completes the onboarding wizard, they land on the **Configuration** page.
This page lets them enable the authentication providers that employees will use to log in
and that the collector will use to sync their mailboxes.

---

## Providers

| Provider | What it does |
|---|---|
| **Email + Password** | Native login. Always enabled. Used by the superadmin as a break-glass account. |
| **Microsoft 365 (OIDC)** | Employees log in with their Microsoft work account. Collector syncs their Exchange Online mailboxes via Microsoft Graph. |
| **Google Workspace (OIDC)** | Employees log in with their Google Workspace account. Collector syncs their Gmail mailboxes via Gmail API. |

---

## Microsoft 365 Setup

### Fields the admin fills in

| Field | Where to find it | Example |
|---|---|---|
| **Tenant ID** | Azure Portal → Azure Active Directory → Overview → Tenant ID | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| **Client ID** | Azure Portal → App Registrations → your app → Application (client) ID | `yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy` |
| **Client Secret** | Azure Portal → App Registrations → your app → Certificates & secrets → New client secret | `abc123...` |
| **Redirect URI** | Your own server's callback URL — must match what you registered in Azure | `https://your-domain.com/api/v1/auth/oidc/m365/callback` |

### What the server does on "Validate & Save"

1. **Receives** `{ tenantId, clientId, clientSecret, redirectUri, enabled: true }` from the PUT request.

2. **Validates fields** — `tenantId`, `clientId`, and `clientSecret` must all be present when enabling M365.

3. **Fetches the OIDC discovery document** from Microsoft's well-known endpoint:
   ```
   GET https://login.microsoftonline.com/{tenantId}/v2.0/.well-known/openid-configuration
   ```
   - 5-second timeout. If unreachable → `400 validation_error` (bad Tenant ID or no network).
   - If HTTP status is not 2xx → `400 validation_error` (Tenant ID does not exist in Microsoft's directory).

4. **Verifies the discovery document** contains all required OIDC fields:
   - `issuer` — Microsoft's authority URL for this tenant
   - `authorization_endpoint` — URL to redirect employees to for login
   - `token_endpoint` — URL to exchange auth code for tokens
   - `jwks_uri` — Microsoft's public keys (used later to verify employee ID tokens)

5. **Encrypts the client secret** with AES-256-GCM using `OIDC_ENCRYPTION_KEY` before writing to Postgres.
   The secret is **never** returned in any API response after this point.

6. **Saves** the config to the `auth_providers` table:
   ```
   provider        = 'm365'
   enabled         = true
   tenant_id       = <tenantId>
   client_id       = <clientId>
   client_secret   = <AES-256-GCM encrypted hex string>
   redirect_uri    = <redirectUri>
   ```

7. **Returns** to the client:
   ```json
   {
     "data": {
       "provider": {
         "id": "...",
         "provider": "m365",
         "enabled": true,
         "tenantId": "xxxxxxxx-...",
         "clientId": "yyyyyyyy-...",
         "redirectUri": "https://your-domain.com/api/v1/auth/oidc/m365/callback",
         "createdAt": "...",
         "updatedAt": "..."
       },
       "discovery": {
         "issuer": "https://login.microsoftonline.com/{tenantId}/v2.0",
         "authorization_endpoint": "https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize",
         "token_endpoint": "https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token",
         "jwks_uri": "https://login.microsoftonline.com/{tenantId}/discovery/v2.0/keys",
         "userinfo_endpoint": "https://graph.microsoft.com/oidc/userinfo"
       }
     }
   }
   ```
   The `discovery` block confirms the OIDC endpoints that the server will use for SSO logins
   and future collector token exchange.

---

## Google Workspace Setup

### Fields the admin fills in

| Field | Where to find it |
|---|---|
| **Service Account JSON** | Google Cloud Console → IAM & Admin → Service Accounts → Keys → Add key → JSON |
| **Delegated Workspace Admin Email** | Workspace account used by the connector for read-only Directory discovery |
| **Workspace Customer ID** | Use `my_customer` unless the organization requires its stable `C...` customer ID |

Enable the **Gmail API** and **Admin SDK API** in the Google Cloud project. Enable domain-wide
delegation on the service account, then authorize its OAuth Client ID in Google Admin Console:

`Security → Access and data control → API controls → Manage Domain Wide Delegation`.

Authorize exactly these comma-separated scopes:

```
https://www.googleapis.com/auth/admin.directory.user.readonly,
https://www.googleapis.com/auth/gmail.readonly
```

The provider connection performs two independent checks:

1. Impersonate the configured Workspace administrator and enumerate active Gmail-enabled users
   through Admin SDK Directory `users.list(customer=my_customer)`.
2. Impersonate one discovered mailbox and call Gmail `users.getProfile(userId=me)`.

The connection is accepted only when both checks pass. The service-account JSON is encrypted once
with AES-256-GCM by the auth-provider repository. Its delegated administrator and customer ID are
stored as non-secret configuration so later directory re-syncs use the same identity instead of
guessing from the Insight Hub administrator account.

Directory discovery includes every Workspace domain, then applies the organization's configured
domain allow-list. Suspended, archived, deleted, and non-Gmail accounts are excluded. Discovery
does not start ingestion: the setup Sync step must persist the administrator's explicit mailbox
selection before jobs are created.

Initial Gmail ingestion uses a UTC epoch-bounded Gmail query. Subsequent jobs use `history.list`
with the saved `historyId`; an expired cursor (`404`) safely falls back to a full backfill. Provider
message IDs are deduplicated per mailbox by the Core Server.

---

## Email + Password

Always enabled. No configuration fields — the toggle only affects whether employees
(non-superadmin users) can use email+password login. The superadmin break-glass account
uses this provider regardless.

---

## What Flows to the Collector

Once a provider is enabled and saved, the collector uses the stored credentials to sync
employee mailboxes:

```
auth_providers table  →  mailboxes table (Phase 1)
        ↓
Scheduler fires every SYNC_INTERVAL_MS
        ↓
IngestionService.runSync(mailboxes)
        ↓
getConnector('m365')  →  M365Connector
   uses tenant_id + client_id + decrypted client_secret
   calls Microsoft Graph delta sync:
     GET /v1.0/users/{mailbox}/mailFolders/inbox/messages/delta
   returns RawMessage[]
        ↓
DedupService.filterNew()  →  new messages only
        ↓
Write raw .eml to MinIO  (Phase 1)
Publish to RabbitMQ      (Phase 1)
```

The collector **never** stores the client secret in memory beyond the duration of the
token-exchange HTTP call. It reads the encrypted value from Postgres, decrypts it in-process,
uses it once, and discards it.

---

## Security Notes

| Concern | How it is handled |
|---|---|
| Client secret at rest | AES-256-GCM encrypted in `auth_providers.client_secret`. Key lives only in `OIDC_ENCRYPTION_KEY` env var. |
| Client secret in transit | Never returned in any GET response. Never logged. |
| OIDC endpoint spoofing | Server fetches the discovery document server-side — client never touches Microsoft/Google directly during validation. |
| Replay / CSRF on SSO callback | Handled with `state` parameter (Phase 4 — full OIDC flow). |
| Break-glass access | Email + password provider cannot be disabled — superadmin always has a non-SSO path in. |

---

## Environment Variables Required

| Variable | Description | Example |
|---|---|---|
| `OIDC_ENCRYPTION_KEY` | 64-character lowercase hex string (32 bytes for AES-256). Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `3f2a1b...` |

**Production:** Set `OIDC_ENCRYPTION_KEY` to a real random value. The dev default (`aaa…`) is
a placeholder that works locally but must never be used in production.
