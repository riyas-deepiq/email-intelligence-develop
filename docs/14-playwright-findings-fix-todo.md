# Playwright Findings — Fix TODO

Created: 2026-09-11  
Status: Pending  
Source: [`13-playwright-verification-report.md`](13-playwright-verification-report.md)  
Scope: only the seven confirmed application findings from the full Playwright verification

## Goal

Fix every confirmed security, authorization, validation, accessibility, and upgrade-warning issue without changing the verified organization-hierarchy behaviour.

## Delivery rules

- [ ] Fix in priority order: P0, P1, P2, then P3.
- [ ] Treat the P0 and P1 items as release blockers.
- [ ] Reuse the existing permission middleware, validation/error envelope, session model, and test setup.
- [ ] Do not add a new authorization framework, settings framework, UUID package, or accessibility dependency.
- [ ] Enforce security on the server; client-side hiding is only an additional UX guard.
- [ ] Keep employee mailbox scope and multi-manager hierarchy scope unchanged.
- [ ] Use only isolated test databases and synthetic accounts during verification.

## P0 — Block self-service privilege escalation

Problem: an employee can call `PATCH /users/:id` for their own ID with `role` or `roleId` and become an administrator.

Relevant files:

- `server/src/modules/users/user.controller.ts`
- `server/src/modules/users/user.schema.ts`
- `server/src/modules/users/user.service.ts`
- Existing user route/controller/service integration tests

### Implementation

- [ ] Define the exact self-profile fields allowed without `users.manage`; keep them limited to ordinary profile data such as `displayName` and the already-approved email flow.
- [ ] Reject, rather than silently ignore, `role`, `roleId`, status, organization, permissions, or any other administrative field in a self-update request.
- [ ] Permit role/custom-role changes only when the authenticated actor has `users.manage`.
- [ ] Keep the existing Super Admin protection: this endpoint must not assign, remove, or replace `superadmin`.
- [ ] Enforce the actor-aware rule at the shared server update boundary so future callers cannot bypass the controller check.
- [ ] Preserve allowed-domain and duplicate-email validation for legitimate profile updates.
- [ ] Audit successful role changes only when they were made by an authorized administrator.
- [ ] Do not create a second user-update endpoint unless the existing path cannot express these two field allowlists safely.

### Regression checks

- [ ] Employee self-update of `displayName` succeeds.
- [ ] Employee self-update containing `role: admin` returns `403` and leaves the role unchanged.
- [ ] Employee self-update containing `roleId` returns `403` and leaves the effective role/permissions unchanged.
- [ ] Employee still cannot update another user.
- [ ] Authorized administrator can perform the currently supported non-Super-Admin role change.
- [ ] No request through this endpoint can assign or remove `superadmin`.
- [ ] After every rejected request, `/auth/me` still returns the original employee permissions.

### Done when

- [ ] The original Playwright escalation probe fails closed, the database role is unchanged, and server integration tests cover the bypass.

## P1 — Enforce permissions on users, chat, and document APIs

Problem: a custom role with `permissions: []` can list/read users, list chat sessions, and resolve an in-scope document.

Relevant files:

- `server/src/modules/users/user.routes.ts`
- `server/src/modules/users/user.controller.ts`
- `server/src/modules/chat/chat.routes.ts`
- `server/src/modules/documents/documents.routes.ts`
- Existing auth middleware and permission tests

### Access contract

- [ ] `GET /users`: require `users.manage` or the minimum existing permission needed by the hierarchy user selector; never allow a zero-permission role.
- [ ] `GET /users/:id`: allow self-read; require the approved management permission for another user's record.
- [ ] All chat query/session routes: require `search.use` in addition to authentication.
- [ ] `GET /documents/:id`: require the agreed read permission used by its parent workflow (`search.use` and/or `emails.read`) as well as existing mailbox-scope enforcement.
- [ ] Confirm the chosen user-list permission against current client consumers before applying middleware so the read-only `org.manage` hierarchy workflow is not accidentally broken.
- [ ] Keep resource-denial behaviour non-disclosing: out-of-scope message/document resources continue returning `404` where that is the existing contract.
- [ ] Do not rely on sidebar visibility or frontend route guards for any API decision.

### Regression checks

- [ ] Zero-permission custom role receives `403` from user list, other-user detail, every chat route, and document resolution.
- [ ] A user can still read their own safe user record if required by the current UI.
- [ ] `users.manage` can list and read managed users.
- [ ] Approved `org.manage` hierarchy read/assignment selection still works with only its intended data.
- [ ] `search.use` can create/query/list/read/delete only that user's authorized chat sessions.
- [ ] Document access requires both permission and mailbox scope; possessing only one is insufficient.
- [ ] Messages, threads, attachments, documents, chat, users, and hierarchy receive one cross-role API matrix test.

### Done when

- [ ] The original permission-less Playwright account receives no protected data and all legitimate role workflows still pass.

## P1 — Make organization security controls truthful and server-enforced

Problem: RBAC, DLP, and “Enforce 2-factor authentication” look organization-wide, but only write browser `localStorage` and perform no server enforcement.

Relevant files:

- `client/src/features/dashboard/views/SettingsView.tsx`
- `docs/12-two-step-verification-todo.md`
- Future backend organization-security settings files created by the selected feature implementations

### Immediate safe fix

- [ ] Remove or disable controls that do not have a backend-enforced setting.
- [ ] Label unfinished controls clearly as unavailable/planned; do not claim that the organization is protected.
- [ ] Remove organization-security values from `localStorage`; browser-local state must not represent policy.
- [ ] Keep real enforced permissions visible as status only if that status comes from the server.

### Full feature dependencies

- [ ] Implement the complete two-step verification plan in `docs/12-two-step-verification-todo.md` before enabling the organization MFA switch.
- [ ] Define separate backend contracts, persistence, authorization, audit, and enforcement for RBAC/DLP before enabling those controls.
- [ ] Restrict policy changes to the existing approved security-management permission.
- [ ] Read the saved policy from the backend on page load and confirm it remains the same after reload, logout/login, and another browser session.
- [ ] Show save failure and rollback the displayed switch state when an API write fails.
- [ ] Audit every organization-wide security policy change.

### Regression checks

- [ ] Toggling an enabled organization-security control produces exactly one authorized API write.
- [ ] A failed API write never leaves a false enabled state in the UI.
- [ ] A user without the policy-management permission cannot write the setting through UI or API.
- [ ] The saved value is shared across browsers and enforced by the backend.
- [ ] No security policy depends on `localStorage`.

### Done when

- [ ] Every interactive security switch has real server persistence/enforcement; otherwise it remains visibly unavailable and non-interactive.

## P2 — Return a client error for malformed route UUIDs

Problem: `GET /messages/not-a-uuid` reaches PostgreSQL and returns `500 internal_error`.

Relevant files:

- `server/src/modules/messages/messages.routes.ts`
- Existing shared route/UUID validation helpers, if present
- Message route tests

### Implementation

- [ ] Inventory UUID route parameters in the affected message/attachment paths before editing.
- [ ] Reuse the existing UUID parser if one already exists; otherwise add the smallest shared validation helper needed by sibling routes.
- [ ] Validate `:id` before any database/provider call.
- [ ] Return the application's normal `400 validation_error` response for malformed identifiers.
- [ ] Preserve `404` for a valid UUID that is missing or outside the caller's mailbox scope.
- [ ] Do not catch PostgreSQL UUID errors as the primary fix; stop invalid input at the HTTP trust boundary.

### Regression checks

- [ ] Malformed message UUID returns `400`, not `500`.
- [ ] Database/provider functions are not called for malformed UUIDs.
- [ ] Valid missing and cross-mailbox UUIDs retain the expected non-disclosing `404` behaviour.
- [ ] Valid authorized message and attachment routes still work.

### Done when

- [ ] No malformed UUID request in the covered routes can produce an internal server error.

## P2 — Give security switches accessible names

Problem: all three `role="switch"` buttons have an empty accessible name.

Relevant file:

- `client/src/features/dashboard/views/SettingsView.tsx`

### Implementation

- [ ] Associate each switch with its visible title using a unique `id` plus `aria-labelledby`, or an equivalent native accessible-name relationship.
- [ ] Associate the description with `aria-describedby` where it helps explain the effect.
- [ ] Keep native button keyboard activation, focus visibility, `role="switch"`, and `aria-checked` state.
- [ ] Apply the accessible relationship to real and disabled/planned control states.

### Regression checks

- [ ] Each switch is discoverable by its visible name through `getByRole('switch', { name: ... })`.
- [ ] Space and Enter operate enabled switches once each.
- [ ] Focus is visible and the announced checked/disabled state matches the UI.

### Done when

- [ ] Playwright finds no unnamed security switches.

## P2 — Keep focus out of the closed mobile sidebar

Problem: the mobile drawer is translated off-screen but remains in the keyboard tab order.

Relevant files:

- `client/src/features/dashboard/components/Sidebar.tsx`
- The component that owns `mobileOpen` and the menu button
- `client/src/styles/features/dashboard/pages/Dashboard.module.css`

### Implementation

- [ ] Use the native `inert` behaviour or conditional rendering so descendants cannot receive focus while the mobile drawer is closed.
- [ ] Keep desktop sidebar navigation focusable even when the mobile drawer state is closed.
- [ ] When opening, move focus to a meaningful drawer control or preserve the agreed current entry point.
- [ ] When closing by navigation, backdrop, Escape, or close action, return focus to the menu button.
- [ ] Preserve the visual transition only if it does not delay the focus/inert state.
- [ ] Do not build a custom focus-trap library for this drawer.

### Regression checks

- [ ] At the mobile viewport, Tab and Shift+Tab cannot reach sidebar controls while closed.
- [ ] Opening makes the sidebar controls keyboard reachable.
- [ ] Escape/backdrop/navigation closes the drawer and restores focus.
- [ ] Desktop and collapsed-desktop sidebar keyboard navigation still works.

### Done when

- [ ] The closed off-canvas sidebar has no focusable descendants in the accessibility tree/tab sequence.

## P3 — Resolve React Router v7 future warnings

Problem: development runs log the `startTransition` and relative-splat-path future warnings.

Relevant files:

- `client/src/app/App.tsx`
- `client/package.json`
- Routes containing splat (`*`) matching, if any

### Implementation

- [ ] Confirm the exact installed React Router 6 API supports the documented future flags.
- [ ] Enable `v7_startTransition` and `v7_relativeSplatPath` on the existing router with the smallest supported change.
- [ ] Verify every splat/redirect route still resolves to the same page.
- [ ] Do not upgrade to React Router v7 as part of this warning-only fix.

### Regression checks

- [ ] Public and protected route smoke tests pass on desktop and mobile.
- [ ] Direct URL load, redirect, refresh, and unknown-route fallback still work.
- [ ] Browser console contains neither future-flag warning.

### Done when

- [ ] Both warnings are gone without changing route behaviour.

## Required delivery order

### Phase 1 — Release-blocking authorization

- [ ] Fix P0 self-role escalation.
- [ ] Fix P1 users/chat/documents permission gaps.
- [ ] Run focused server unit and PostgreSQL integration tests.
- [ ] Re-run the hostile Playwright API probes before continuing.

### Phase 2 — Security-settings truthfulness

- [ ] Apply the immediate safe UI treatment for non-functional switches.
- [ ] Enable each control only after its backend feature is implemented and verified.
- [ ] Keep MFA delivery tracked by `docs/12-two-step-verification-todo.md`.

### Phase 3 — Validation and accessibility

- [ ] Fix malformed UUID handling.
- [ ] Fix switch accessible names.
- [ ] Fix closed mobile-sidebar focus handling.

### Phase 4 — Warning cleanup and full regression

- [ ] Enable the supported React Router future flags.
- [ ] Run server/client typecheck, lint, tests, and builds.
- [ ] Run the complete hierarchy and application Playwright matrices again.
- [ ] Update `docs/13-playwright-verification-report.md` or create a dated re-verification report with evidence.

## Final verification checklist

Run from `server`:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:run
npm.cmd run build
```

Run PostgreSQL integration tests only against a dedicated migrated test database:

```powershell
$env:RUN_PG_INTEGRATION = '1'
npm.cmd exec -- vitest run
```

Run from `client`:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Run the client hierarchy helper tests from `server`:

```powershell
npm.cmd exec -- vitest run --config vitest.hierarchy-client.config.ts
```

Browser verification must confirm:

- [ ] Employee self-promotion is impossible through direct API calls.
- [ ] A zero-permission role cannot retrieve protected users, chat, document, message, thread, or attachment data.
- [ ] Legitimate Super Admin, admin, custom-role, hierarchy reviewer, manager, and employee paths still work.
- [ ] Organization security controls are either truly server-enforced or clearly unavailable.
- [ ] Malformed IDs return controlled 4xx responses with no browser/server crash.
- [ ] Named switches and mobile-drawer keyboard behaviour pass accessibility checks.
- [ ] No React Router future warnings, unhandled page errors, unexpected API `5xx`, or horizontal mobile overflow appear.
- [ ] The multi-manager hierarchy, mailbox inheritance, vacant positions, and cross-mailbox isolation remain unchanged.

## Definition of done

- All seven findings in `docs/13-playwright-verification-report.md` are fixed and have runnable regression coverage.
- P0/P1 hostile API probes fail closed and no protected data is returned.
- Backend permissions remain authoritative even when requests bypass the UI.
- No browser-local value is presented as an enforced organization security policy.
- Input validation, accessibility, and router warning checks pass.
- Server/client checks and the complete isolated Playwright regression suite pass.
- No live/customer database, mailbox provider, SMTP service, or deployed environment is changed during local verification.
