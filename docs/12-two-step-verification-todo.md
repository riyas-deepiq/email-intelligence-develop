# Two-Step Verification (MFA) — Full Implementation TODO

Created: 2026-09-10  
Status: Open  
Scope: native password login, Microsoft/Google OIDC, TOTP enrollment, recovery codes, MFA policy, session issuance, audit, UI, migration, and verification

## 1. Goal

Add complete two-step verification so that a password or SSO callback alone cannot create an authenticated Insight Hub session when MFA is required.

The finished feature must provide:

- Authenticator-app verification using RFC 6238 TOTP for native accounts.
- Provider-enforced MFA for Microsoft Entra and Google Workspace SSO where configured.
- An application TOTP challenge after SSO when provider MFA is not trusted/enforced.
- Mandatory MFA for Super Admin accounts.
- Configurable organization policy for admins and all users.
- Secure one-time recovery codes.
- Safe enrollment, verification, disable, reset, and lost-device recovery.
- Rate limiting, replay protection, session revocation, and audit events.
- Clear setup, login-challenge, account-security, and recovery UI.

## 2. Current verified authentication flow

- Native login checks email/password and immediately calls `issueTokens()`.
- A successful native login creates an access token, refresh token, and server-side session before returning to the client.
- Microsoft and Google OIDC callbacks also issue the application's session/token pair.
- Refresh tokens are stored in an HttpOnly cookie; access tokens are returned to the client.
- Refresh-token rotation and server-side session validation already exist.
- Login, password reset, and invite endpoints already have rate limiting.
- Authentication audit events already exist.
- AES-256-GCM encryption already exists for stored provider credentials.
- There are no current MFA database fields, enrollment routes, challenge routes, or client MFA screens.

Main security gap: password/OIDC success currently becomes a full session immediately. MFA must be verified before `issueTokens()` and before `lastLoginAt`, activation, or first-login side effects are finalized.

## 3. Authentication-method decision

### 3.1 Native email/password accounts

- [ ] Use a maintained RFC 6238-compatible TOTP implementation.
- [ ] Support common authenticator apps through a standard `otpauth://` enrollment URI.
- [ ] Use a 30-second time step and six-digit codes for broad authenticator compatibility.
- [ ] Permit only a small clock-skew window.
- [ ] Track the last accepted time step so the same code cannot be replayed.
- [ ] Do not hand-roll TOTP/HOTP cryptography.

### 3.2 Microsoft and Google SSO accounts

- [ ] Prefer Microsoft Entra Conditional Access / authentication-strength policies for Microsoft SSO.
- [ ] Prefer Google Workspace enforced 2-Step Verification for Google SSO.
- [ ] Add an organization setting describing whether provider MFA is trusted as satisfying application MFA.
- [ ] When provider MFA is not trusted or cannot be proven, require the local TOTP challenge after the OIDC callback.
- [ ] Never assume that an OIDC login used MFA merely because it came from Microsoft or Google.

### 3.3 Methods deliberately excluded

- [ ] Do not use email OTP as the primary second factor; mailbox compromise would weaken both steps.
- [ ] Do not use SMS/voice OTP as the default factor.
- [ ] Do not use security questions.
- [ ] Keep WebAuthn/passkeys as a separate future security project; do not mix it into the TOTP implementation.

## 4. Organization policy

Add an explicit organization policy:

```text
superadmins  -> MFA required for Super Admin only (minimum/default)
admins       -> MFA required for Super Admin and Admin roles
all_users    -> MFA required for every interactive user
```

Add an OIDC MFA mode:

```text
local_challenge   -> Insight Hub TOTP is required after OIDC
provider_enforced -> Microsoft/Google policy satisfies the second step
```

Rules:

- [ ] Super Admin MFA cannot be disabled by organization policy.
- [ ] New Super Admin setup must enroll MFA before receiving the final normal session.
- [ ] Policy changes apply on the next login and to sensitive operations.
- [ ] Moving policy to a stricter level marks affected users as `enrollment_required`.
- [ ] Existing sessions must be reviewed/revoked when policy becomes stricter.
- [ ] Policy changes are Super Admin-only and audited.
- [ ] Do not derive MFA requirement from hierarchy position titles such as CEO or Manager.

## 5. Target database design

### 5.1 Organization policy columns

Add to `organizations` or a single existing organization-settings record:

```text
mfa_policy        text not null default 'superadmins'
oidc_mfa_mode     text not null default 'local_challenge'
```

- [ ] Use a database enum/check constraint for accepted values.
- [ ] Default existing organizations to the safe documented policy.
- [ ] Do not silently trust provider MFA during migration.

### 5.2 `user_mfa_methods`

```text
id                        uuid primary key
user_id                   uuid not null unique -> users.id ON DELETE CASCADE
method_type               text not null default 'totp'
secret_ciphertext         text not null
status                    text not null
enabled_at                timestamptz null
last_accepted_time_step   bigint null
created_at                timestamptz not null
updated_at                timestamptz not null
```

Statuses:

```text
pending   -> secret generated, confirmation not completed
enabled   -> verified and required at login
disabled  -> retained only if audit/retention policy requires it
```

- [ ] Encrypt the TOTP secret at rest with authenticated encryption.
- [ ] Extract/generalize the existing AES-256-GCM helper instead of creating unrelated duplicate crypto code.
- [ ] Keep key-version/migration needs in mind without exposing the encryption key in data rows or logs.
- [ ] Never return the secret after enrollment is confirmed.
- [ ] Delete or invalidate abandoned pending enrollment records after a short expiry.

### 5.3 `mfa_recovery_codes`

```text
id             uuid primary key
user_id        uuid not null -> users.id ON DELETE CASCADE
code_hash      text not null
used_at        timestamptz null
created_at     timestamptz not null
```

- [ ] Generate a set of cryptographically random, human-enterable recovery codes.
- [ ] Store only hashes, never plaintext codes.
- [ ] Display/download plaintext codes once immediately after enrollment/regeneration.
- [ ] Make every code single-use with an atomic `used_at IS NULL` update.
- [ ] Regenerating codes invalidates every old unused code.
- [ ] Never allow an administrator to view another user's recovery codes.

### 5.4 Ephemeral MFA challenges

Reuse the existing `SessionStore`; do not add a permanent challenge table.

Challenge key:

```text
mfa:challenge:<random-id>
```

Stored payload:

```json
{
  "userId": "user-id",
  "purpose": "login",
  "provider": "native",
  "attempts": 0,
  "createdAt": "ISO timestamp",
  "userAgent": "safe normalized value"
}
```

- [ ] Use a short TTL, such as five minutes.
- [ ] Bind the challenge to its user and purpose.
- [ ] Increment failed attempts atomically or use a one-time attempt-key strategy supported by all session stores.
- [ ] Invalidate the challenge after success, expiry, or the maximum allowed attempts.
- [ ] Never put a password, TOTP secret, OTP, or recovery code in the challenge payload.

## 6. Native login flow

```text
Email + password
       ↓
Password verified
       ↓
Is MFA required and enrolled?
       ├─ No, not required -> issue session/token pair
       ├─ Required, not enrolled -> return enrollment-required challenge
       └─ Required, enrolled -> return MFA challenge (no session/tokens)
                                      ↓
                               Verify TOTP/recovery code
                                      ↓
                               Issue session/token pair
```

- [ ] Refactor native login so credential verification and token issuance are separate internal steps.
- [ ] Return a discriminated response: authenticated, MFA required, or enrollment required.
- [ ] Do not set the refresh cookie for an MFA-pending response.
- [ ] Do not update `lastLoginAt`, activate an invited account, or trigger initial mailbox sync until MFA succeeds.
- [ ] Preserve the same generic invalid-credential response before the MFA stage to prevent account discovery.
- [ ] After MFA success, call the existing token/session issuance path exactly once.
- [ ] Record one successful login audit event only after both steps succeed.

Example MFA-required response:

```json
{
  "data": {
    "status": "mfa_required",
    "challengeId": "opaque-random-id",
    "expiresIn": 300
  }
}
```

## 7. OIDC login flow

```text
Microsoft/Google authentication
          ↓
OIDC callback and identity validation
          ↓
Does configured provider assurance satisfy MFA policy?
          ├─ Yes -> issue one-time login code, then normal app session
          └─ No  -> issue one-time MFA challenge code, no app session
                              ↓
                       Local TOTP verification
                              ↓
                       Issue normal app session
```

- [ ] Keep OIDC state, nonce, issuer, audience, and one-time-code protections intact.
- [ ] Do not issue application JWTs before the local challenge when `oidc_mfa_mode=local_challenge`.
- [ ] Validate provider assurance claims only when the provider documents and supplies them reliably for the configured flow.
- [ ] Treat missing/unknown assurance as not satisfied.
- [ ] Keep provider MFA enforcement configuration documented outside the application.
- [ ] Audit provider name and whether MFA was satisfied locally or by the provider.

## 8. Enrollment flow

### 8.1 Authenticated enrollment

- [ ] Require a valid authenticated session.
- [ ] Require recent password verification for native accounts.
- [ ] Require recent OIDC reauthentication or an existing MFA proof for SSO-only accounts.
- [ ] Generate a unique high-entropy TOTP secret for the user.
- [ ] Store it encrypted with `pending` status.
- [ ] Return one standard `otpauth://` URI and a manual Base32 key.
- [ ] Render a QR code without sending the secret to third-party services.
- [ ] Require one valid TOTP code before enabling the method.
- [ ] Generate recovery codes only after the setup code is verified.
- [ ] Display recovery codes once and require the user to acknowledge saving them.
- [ ] Revoke abandoned pending setup secrets.

### 8.2 Mandatory first-login enrollment

- [ ] Integrate Super Admin MFA enrollment into the existing first-login setup flow.
- [ ] Do not issue a long-lived normal session between password setup and mandatory MFA enrollment.
- [ ] Preserve enough short-lived state to complete organization setup and MFA safely.
- [ ] An interrupted setup must resume safely without bypassing MFA.

## 9. Verification and recovery

### 9.1 TOTP verification

- [ ] Accept only normalized six-digit codes.
- [ ] Allow only the configured small time-step window.
- [ ] Use constant-time comparison through the selected implementation.
- [ ] Reject a time step already accepted for the same user.
- [ ] Keep server clocks synchronized and monitor clock drift.
- [ ] Apply per-IP, per-challenge, and per-account rate limits.

### 9.2 Recovery codes

- [ ] Let the login challenge accept either TOTP or an unused recovery code.
- [ ] Consume a valid recovery code atomically.
- [ ] Notify the account owner after recovery-code use.
- [ ] Show the remaining recovery-code count after login.
- [ ] Encourage immediate authenticator replacement when recovery was used for a lost device.

### 9.3 Lost-device/admin recovery

- [ ] Do not let a Super Admin read or reveal another user's secret or codes.
- [ ] Define a documented, audited reset procedure for normal users.
- [ ] Require strong Super Admin confirmation before resetting another user's MFA.
- [ ] Revoke all target-user sessions after an administrative reset.
- [ ] Mark the user `enrollment_required` for their next login.
- [ ] Provide an offline organizational break-glass process for the final Super Admin; do not build a hidden application bypass.

## 10. Disable, reset, and sensitive actions

- [ ] Self-disable requires current password/recent SSO reauthentication plus a valid TOTP or recovery code.
- [ ] Super Admin cannot self-disable when policy requires MFA unless another compliant factor is enrolled or the break-glass process is used.
- [ ] Disable/reset deletes or invalidates the encrypted secret and every recovery code.
- [ ] Disable/reset revokes all other sessions and rotates the current session when allowed.
- [ ] Password reset does not automatically disable MFA.
- [ ] Changing email, password, MFA policy, provider trust, or MFA method requires recent MFA proof.
- [ ] Store a short-lived `mfa_verified_at`/recent-auth marker server-side for sensitive operations; do not trust a browser flag.

## 11. API contract

Public challenge endpoint:

```text
POST /api/v1/auth/mfa/verify
```

Protected management endpoints:

```text
GET    /api/v1/auth/mfa/status
POST   /api/v1/auth/mfa/setup/start
POST   /api/v1/auth/mfa/setup/confirm
POST   /api/v1/auth/mfa/recovery-codes/regenerate
DELETE /api/v1/auth/mfa
```

Super Admin policy/recovery endpoints:

```text
GET  /api/v1/admin/security/mfa-policy
PUT  /api/v1/admin/security/mfa-policy
POST /api/v1/admin/users/:userId/mfa-reset
```

- [ ] Define strict request parsers for challenge IDs, six-digit codes, recovery codes, and policy enums.
- [ ] Use generic verification errors that do not reveal which factor failed.
- [ ] Never return encrypted secrets, hashes, or stored recovery-code values.
- [ ] Set the refresh cookie only in the final successful authentication response.
- [ ] Keep response contracts explicit in server and client TypeScript types.

## 12. Frontend experience

Relevant screens:

- Login page: password/SSO entry.
- MFA challenge page: authenticator code or recovery code.
- MFA enrollment page: QR, manual key, confirmation, recovery-code download.
- Settings → Security: status, enable, regenerate recovery codes, disable.
- Admin security policy: required-user scope and OIDC MFA mode.
- User admin: MFA state and audited reset action, never secret access.

- [ ] Add an `/auth/mfa` route that works only with a valid pending challenge.
- [ ] Keep challenge IDs in short-lived in-memory/session state where possible; never store OTPs.
- [ ] Support paste and numeric mobile keyboard for TOTP input.
- [ ] Do not auto-submit until all six digits are present.
- [ ] Provide clear expired, invalid, rate-limited, and already-used messages without leaking sensitive detail.
- [ ] Add accessible labels, focus handling, error announcements, and keyboard operation.
- [ ] Prevent authenticated dashboard rendering while MFA is pending.
- [ ] Clear pending challenge state on success, expiry, cancellation, logout, or account switch.
- [ ] Display/download recovery codes exactly once and warn that they cannot be viewed later.
- [ ] Show session revocation and security-notification results.

## 13. Security controls

- [ ] Use HTTPS for every production enrollment and verification request.
- [ ] Protect TOTP secrets with the existing application encryption-key boundary after generalizing the helper.
- [ ] Never log passwords, OTPs, TOTP secrets, enrollment URIs, QR data, challenge payloads, or recovery codes.
- [ ] Extend request-logger redaction for all new MFA field names.
- [ ] Use cryptographically random challenge IDs and recovery codes.
- [ ] Make challenges short-lived, purpose-bound, attempt-limited, and single-use.
- [ ] Prevent TOTP replay using the last accepted time step.
- [ ] Apply shared-store rate limits in multi-instance production deployments.
- [ ] Revoke sessions after MFA reset, suspicious recovery, account deactivation, and relevant policy changes.
- [ ] Send security notifications for enable, disable, reset, recovery-code regeneration/use, and suspicious failures.
- [ ] Add metrics for challenge issued/succeeded/failed/expired/rate-limited without user secrets.
- [ ] Back up encrypted MFA records only together with the documented encryption-key recovery process.

## 14. Audit events

Add at least:

```text
auth.mfa_enrollment_started
auth.mfa_enabled
auth.mfa_challenge_failed
auth.mfa_verified
auth.mfa_recovery_code_used
auth.mfa_recovery_codes_regenerated
auth.mfa_disabled
auth.mfa_admin_reset
auth.mfa_policy_changed
```

- [ ] Include actor, target user, IP, session/challenge identifier where safe, provider, and result.
- [ ] Do not include OTPs, secrets, recovery codes, or QR/enrollment URIs.
- [ ] Avoid flooding audit storage for brute-force attempts; retain meaningful rate-limit summaries without losing security evidence.

## 15. Backend implementation map

Relevant existing files:

- `server/src/db/schema.ts`
- `server/src/modules/auth/auth.service.ts`
- `server/src/modules/auth/auth.controller.ts`
- `server/src/modules/auth/auth.routes.ts`
- `server/src/modules/auth/auth.schema.ts`
- `server/src/modules/auth/auth.types.ts`
- `server/src/modules/auth/oidc.service.ts`
- `server/src/lib/session-store.ts`
- `server/src/modules/auth-providers/auth-provider.crypto.ts`
- `server/src/modules/audit/audit.service.ts`
- `server/src/middleware/request-logger.middleware.ts`
- `server/src/middleware/auth.middleware.ts`

Planned additions:

- One Drizzle migration for MFA policy, methods, and recovery codes.
- A small MFA repository/service module.
- TOTP/recovery-code helpers backed by reviewed cryptographic primitives.
- Focused unit and PostgreSQL integration tests.

- [ ] Reuse the existing session store, token issuer, audit service, error envelope, mailer, and rate-limit pattern.
- [ ] Keep the MFA module focused; do not introduce a generic authentication framework.
- [ ] Add only maintained dependencies required for standards-compliant TOTP and local QR rendering.

## 16. Frontend implementation map

Relevant existing files:

- `client/src/app/App.tsx`
- `client/src/features/auth/auth.api.ts`
- `client/src/features/auth/auth.types.ts`
- `client/src/features/auth/AuthContext.tsx`
- `client/src/features/auth/pages/Login.tsx`
- `client/src/features/auth/pages/OidcCallback.tsx`
- `client/src/features/auth/pages/Setup.tsx`
- `client/src/features/dashboard/views/SettingsView.tsx`
- Existing Modal, Button, input, toast, loading, and error components.

- [ ] Extend the login response union without storing a fake authenticated user during MFA pending state.
- [ ] Add enrollment/challenge components by reusing the existing auth-page styling.
- [ ] Add Settings → Security management and Super Admin policy controls.
- [ ] Keep refresh-token cookie behaviour unchanged after final authentication.
- [ ] Never persist a TOTP secret, enrollment URI, OTP, or recovery code in local storage.

## 17. Migration and rollout

- [ ] Add schema with safe defaults before enforcing MFA.
- [ ] Deploy code capable of reading the new schema with policy enforcement initially controlled.
- [ ] Require Super Admin enrollment through a staged rollout that cannot lock out the only administrator.
- [ ] Confirm the organizational break-glass procedure before enforcement.
- [ ] Enable stricter admin/all-user policy only after affected users are notified and enrollment is available.
- [ ] Rehearse rollback without exposing/decrypting MFA secrets.
- [ ] Do not downgrade already-enrolled accounts silently during rollback.
- [ ] Validate Microsoft and Google provider-side MFA policies separately from local tests.

## 18. Required tests

### 18.1 Native login

- [ ] Valid password with MFA disabled and not required follows the existing login path.
- [ ] Valid password with MFA required returns only a challenge, no JWT/cookie/session.
- [ ] Valid TOTP completes login and creates exactly one session.
- [ ] Invalid/expired/replayed TOTP is rejected.
- [ ] Expired/used/wrong-purpose challenges are rejected.
- [ ] Maximum attempts invalidate the challenge.
- [ ] `lastLoginAt`, activation, audit success, and initial sync occur only after MFA success.

### 18.2 Enrollment and management

- [ ] Pending setup does not enable MFA until a correct TOTP is confirmed.
- [ ] A secret cannot be retrieved after confirmation.
- [ ] Recovery codes are shown once, stored hashed, consumed once, and regenerated atomically.
- [ ] Disable requires recent credentials and MFA proof.
- [ ] Password reset preserves MFA.
- [ ] User/admin reset revokes sessions and requires new enrollment.
- [ ] Super Admin cannot bypass mandatory policy.

### 18.3 OIDC

- [ ] Local-challenge mode issues no app session before local MFA.
- [ ] Provider-enforced mode is accepted only under explicit configuration/validated assurance.
- [ ] Missing or unknown assurance fails closed to local MFA.
- [ ] OIDC state/code remains one-time and expiry-bound.
- [ ] Microsoft and Google callback/exchange flows both produce the same final session contract.

### 18.4 Security and concurrency

- [ ] Concurrent reuse of one TOTP time step permits at most one success.
- [ ] Concurrent use of one recovery code permits at most one success.
- [ ] Concurrent confirmation cannot create duplicate MFA methods.
- [ ] Rate limiting works per challenge/account/IP and through the configured shared store.
- [ ] Sensitive values are absent from application logs, audit payloads, API responses, browser storage, and test snapshots.
- [ ] Session revocation takes effect for access-token verification according to the existing session contract.

### 18.5 Frontend

- [ ] Password login routes correctly to MFA challenge.
- [ ] OIDC routes correctly to provider-complete or local MFA challenge.
- [ ] Refresh/reload cannot bypass or accidentally complete a pending challenge.
- [ ] Enrollment QR/manual-key/confirmation/recovery-code flow is usable and accessible.
- [ ] Invalid, expired, rate-limited, offline, and server-error states are clear.
- [ ] Settings and Super Admin policy controls reflect server state after refresh.

## 19. Required delivery order

All phases are required for the complete TOTP-based two-step verification feature.

### Phase 0 — Security decisions and baseline

- [ ] Confirm organization MFA policy and provider-trust rules.
- [ ] Document break-glass recovery and encryption-key handling.
- [ ] Capture current native/OIDC/session tests before refactoring.

### Phase 1 — Schema and crypto boundary

- [ ] Add policy, MFA method, and recovery-code storage.
- [ ] Generalize/reuse authenticated encryption.
- [ ] Add repository tests and redaction rules.

### Phase 2 — Native MFA

- [ ] Separate credential verification from token issuance.
- [ ] Implement enrollment, challenge, TOTP verification, replay prevention, and recovery codes.
- [ ] Implement session issuance only after the second step.

### Phase 3 — OIDC and policy enforcement

- [ ] Apply local/provider MFA decisions consistently to Microsoft and Google.
- [ ] Enforce Super Admin and organization policy.
- [ ] Add administrative reset and security notifications.

### Phase 4 — Complete UI

- [ ] Add challenge, enrollment, recovery, Settings, and Admin policy screens.
- [ ] Verify accessibility, reload, cancellation, and error behaviour.

### Phase 5 — Integration and rollout

- [ ] Run unit, PostgreSQL integration, client, API, and browser tests.
- [ ] Test real authenticator apps against synchronized server time.
- [ ] Validate provider-side MFA with approved Microsoft/Google test tenants.
- [ ] Rehearse enrollment, account recovery, enforcement, and rollback before production.

## 20. Definition of done

- Password or untrusted OIDC success alone cannot create a full session when MFA is required.
- Super Admin MFA is mandatory without a hidden bypass.
- Native users can enroll an authenticator app and complete TOTP login.
- Microsoft/Google SSO follows the explicit provider-trust policy.
- Recovery codes are one-time, hashed at rest, and visible only once.
- TOTP secrets are encrypted and never logged or returned after enrollment.
- Replayed OTPs and concurrent recovery-code reuse are blocked.
- Enable, disable, reset, recovery, and policy changes revoke/rotate sessions correctly.
- Password reset cannot bypass MFA.
- Audit and notification events cover every sensitive MFA lifecycle action.
- Login, setup, invite, OIDC, refresh, logout, and session-management regressions pass.
- Real PostgreSQL, browser, Microsoft/Google tenant, and authenticator-app verification is complete.

Run from `server`:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd exec -- vitest run tests/unit/modules/auth tests/unit/lib
npm.cmd run build
```

Run MFA PostgreSQL integration only against a dedicated migrated test database:

```powershell
$env:RUN_PG_INTEGRATION = '1'
npm.cmd exec -- vitest run tests/integration/auth-mfa.pg.test.ts
```

Run from `client`:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Do not mark MFA complete from unit tests alone. Confirm that no access/refresh token or authenticated server session exists before the required second step, and complete real provider/authenticator/browser verification.

## 21. Standards and provider references

- RFC 6238 — Time-Based One-Time Password Algorithm: <https://www.rfc-editor.org/info/rfc6238/>
- NIST SP 800-63B authenticator guidance: <https://pages.nist.gov/800-63-4/sp800-63b/authenticators/>
- Microsoft Entra Conditional Access grant controls: <https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-grant>
- Google Workspace 2-Step Verification: <https://support.google.com/a/answer/175197>
