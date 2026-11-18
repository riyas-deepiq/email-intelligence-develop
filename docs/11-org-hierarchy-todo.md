# Organization Hierarchy — Full Implementation TODO

Created: 2026-09-09  
Status: Implementation and local verification complete; existing-database rollout pending  
Scope: position-first hierarchy design, vacant positions, user assignment, multiple reporting lines, mailbox scope, security, migration, UI, and verification

## 1. Goal

Build a complete organization-chart designer where a Super Admin can:

- Create the organization structure before creating or assigning users.
- Create vacant positions at any depth.
- Create any required departments, branches, managers, and employee positions.
- Assign, unassign, replace, or move users without deleting positions.
- Make one position report directly to multiple manager positions.
- Render a shared report once, with connections from all direct managers.
- Preserve the structure when an assigned user or invitation is deleted.
- Use the hierarchy as the authoritative mailbox-access scope.
- Preview effective mailbox access before and after hierarchy changes.

This is the full target design. Implementation must not stop at a users-first or single-manager intermediate model.

## 2. Required organization example

The finished feature must support this structure:

```text
                         Chairman
                        /        \
                     CEO          CTO
                      |\          /|
                      | \        / |
                  Manager 1  Manager 2
                    /  \          /  \
                  E1    E2       E3   E4
```

Required meaning:

- Chairman is the root position.
- CEO and CTO report to Chairman.
- Manager 1 and Manager 2 each report directly to both CEO and CTO.
- Employees report to their relevant manager positions.
- CEO and CTO both receive access through their shared reporting paths.
- Chairman receives access through every descendant path.

The model must support more managers, employees, levels, and reporting lines without hard-coded CEO/CTO rules.

## 3. Pre-implementation verified state and gap (historical)

- The previous model was users-first, not position-first.
- `org_nodes.user_id` is mandatory, so vacant positions cannot exist.
- `org_nodes.manager_id` references one user, so a node can have only one direct manager.
- `org_closure` stores user-to-user ancestry rather than position-to-position ancestry.
- The frontend `Reports to` field accepts only one manager.
- `buildTree()` assumes one parent and renders a tree, not a multi-parent graph.
- In the previously checked database snapshot, one organization, one active superadmin, and 36 mailboxes existed.
- Only one mailbox was linked to a user; 35 mailboxes were unowned.
- `org_nodes` and `org_closure` were empty in that snapshot.
- Hierarchy-focused checks passed 20 tests; the PostgreSQL integration test remained opt-in.

> The database snapshot is time-specific. Re-run read-only row-count and integrity checks immediately before migration.

## 4. Complete product rules

### 4.1 Positions and structure

- [x] A hierarchy node represents a position, not a user.
- [x] A position can exist without a user and must display as `Vacant`.
- [x] A position has a required title, optional department, deterministic display order, and timestamps.
- [x] The organization has one intentional root position by default.
- [x] The root can remain vacant while the Super Admin designs the chart.
- [x] Positions can be created at any practical depth; levels must not be hard-coded.
- [x] A root position has no manager.
- [x] A non-root position must have at least one direct manager.
- [x] A position can have multiple direct managers.
- [x] Do not hard-code a maximum of two managers; the supplied design uses two, but the model must support more.
- [x] Duplicate reporting lines are prohibited.
- [x] Self-reporting and every direct or indirect cycle are prohibited.
- [x] All connected positions must belong to the same organization.

### 4.2 User assignments

- [x] User assignment is optional and independent from position creation.
- [x] One position can have at most one active assigned user.
- [x] One user can occupy at most one active position in the organization.
- [x] Assigning, replacing, or unassigning a user must not change reporting lines.
- [x] Deleting/cancelling an assigned user makes the position vacant; it must not delete the position or its children.
- [x] Existing users and mailbox owners can be selected for assignment.
- [x] A mailbox-only identity can reuse `createUserFromMailbox()` before assignment.
- [x] The assigned user, mailbox, position, and organization must agree.

### 4.3 Roles and positions stay separate

- [x] `Chairman`, `CEO`, `CTO`, `Manager`, and `Engineer` are position titles.
- [x] `superadmin`, `admin`, `employee`, and custom roles remain application authorization roles.
- [x] Assigning a user to a CEO position must not silently grant Super Admin permission.
- [x] Occupied hierarchy cards show both the position title and effective custom role name.

### 4.4 Structural mutations

- [x] Editing a position can change title, department, order, and direct managers.
- [x] Replacing the full manager list is atomic: all validation succeeds or nothing changes.
- [x] Removing one of several managers preserves every remaining path.
- [x] Removing the last manager from a non-root position is rejected unless it is explicitly promoted to root.
- [x] Deleting a position with child reporting lines is blocked.
- [x] A Super Admin must move or remove child lines before deleting that position.
- [x] Deleting a leaf position unassigns its user and removes its graph rows in one transaction.

## 5. Target database design

Reuse `org_nodes` and `org_closure`. Add one reporting-edge table; do not add a graph database or hierarchy framework.

### 5.1 `org_nodes` stores positions

```text
id             uuid primary key
org_id         uuid not null -> organizations.id
user_id        uuid null -> users.id ON DELETE SET NULL
title          text not null
department     text null
sort_order     integer not null default 0
created_at     timestamptz not null
updated_at     timestamptz not null
```

- [x] Make `user_id` nullable.
- [x] Change the user foreign key from `ON DELETE CASCADE` to `ON DELETE SET NULL`.
- [x] Keep a unique constraint/index for non-null user assignments.
- [x] Make `title` mandatory after existing data is backfilled.
- [x] Add `sort_order` and indexes for organization listing and assignment lookup.
- [x] Remove old `manager_id` only after relationships are migrated and verified.

### 5.2 `org_reporting_lines` stores multiple managers

```text
org_id            uuid not null -> organizations.id
manager_node_id   uuid not null -> org_nodes.id
report_node_id    uuid not null -> org_nodes.id
created_at        timestamptz not null
primary key       (manager_node_id, report_node_id)
```

- [x] Add foreign keys with deliberate delete behaviour.
- [x] Reject `manager_node_id = report_node_id` with a database check constraint.
- [x] Prevent duplicate lines with the composite primary key.
- [x] Index both traversal directions.
- [x] Validate both nodes share `org_id` in the service transaction.
- [x] Treat every reporting line as a direct, access-granting relationship.

### 5.3 `org_closure` stores position reachability

```text
ancestor_node_id     uuid not null -> org_nodes.id
descendant_node_id   uuid not null -> org_nodes.id
depth                integer not null
primary key          (ancestor_node_id, descendant_node_id)
```

- [x] Every position gets a depth-0 self row.
- [x] Multiple paths to one descendant produce one row using minimum depth.
- [x] Rebuild closure from `org_reporting_lines`, never from user assignments.
- [x] Keep vacant positions in structural traversal.
- [x] Detect cycles against the complete proposed graph before commit.
- [x] Run reporting-line mutation and closure rebuild in one transaction.
- [x] Continue using the PostgreSQL advisory transaction lock, scoped by organization where practical.
- [x] Rebuild the whole organization's closure after structural mutation; this is safer than incremental deletion in a multi-parent graph.

## 6. Mailbox scope contract

For an assigned user:

1. Find the user's assigned position.
2. Find every descendant position through `org_closure`, including depth 0.
3. Ignore vacant positions for mailbox ownership without breaking traversal.
4. Resolve distinct assigned user IDs from occupied descendant positions.
5. Resolve and return their distinct mailboxes.

- [x] Chairman gets own mailbox plus every occupied descendant mailbox.
- [x] CEO and CTO both get shared-manager and employee mailboxes.
- [x] A manager gets own mailbox plus employees below that manager.
- [x] An employee without descendants gets only their own mailbox.
- [x] A shared descendant reached by multiple paths appears once.
- [x] Removing one of two lines removes access only when no other valid path remains.
- [x] A vacant manager position does not break access from its ancestors to occupied descendants.
- [x] Super Admin's full-organization bypass stays explicit and separate.
- [x] A user with no assigned position gets only the agreed fail-closed fallback, never organization-wide access.

## 7. Authorization and audit

- [x] Restrict position, reporting-line, and assignment mutations to Super Admin by default.
- [x] Keep `org.manage` delegation only if it is explicitly approved.
- [x] Full graph reads require Super Admin or `org.manage`.
- [x] Normal users can inspect only their own scope.
- [x] Cross-user scope inspection is Super Admin-only.
- [x] Validate and normalize every node, user, organization, route, and body UUID before repository calls.
- [x] Audit position create/edit/move/delete.
- [x] Audit reporting-line add/remove/replace.
- [x] Audit user assign/unassign/replace.
- [x] Store actor, organization, target node/user, request IP, and safe before/after values.
- [x] Never expose provider credentials or unrelated mailbox metadata.

## 8. API contract

Keep the feature under `/api/v1/admin/org/hierarchy`.

### 8.1 Read the complete graph

```text
GET /api/v1/admin/org/hierarchy
```

Return nodes and edges separately:

```json
{
  "data": {
    "nodes": [
      {
        "id": "position-node-id",
        "orgId": "org-id",
        "title": "Engineering Manager",
        "department": "Engineering",
        "sortOrder": 10,
        "user": null
      }
    ],
    "reportingLines": [
      {
        "managerNodeId": "ceo-node-id",
        "reportNodeId": "manager-node-id"
      },
      {
        "managerNodeId": "cto-node-id",
        "reportNodeId": "manager-node-id"
      }
    ]
  }
}
```

### 8.2 Position CRUD

```text
POST   /api/v1/admin/org/hierarchy/nodes
PATCH  /api/v1/admin/org/hierarchy/nodes/:nodeId
DELETE /api/v1/admin/org/hierarchy/nodes/:nodeId
```

- [x] Create accepts title, department, order, and optional manager node IDs; user remains optional.
- [x] Update accepts only explicitly supplied editable fields.
- [x] Delete returns a conflict when child lines exist.
- [x] Use the existing validation/error envelope consistently.

### 8.3 Replace direct managers

```text
PUT /api/v1/admin/org/hierarchy/nodes/:nodeId/managers
```

```json
{
  "managerNodeIds": ["ceo-node-id", "cto-node-id"]
}
```

- [x] Validate the complete manager set before replacing any line.
- [x] Detect cycles against the complete proposed graph.
- [x] Replace edges and rebuild closure atomically.

### 8.4 Assign or unassign a user

```text
PUT /api/v1/admin/org/hierarchy/nodes/:nodeId/assignment
```

Assign with `{ "userId": "user-id" }`; unassign with `{ "userId": null }`.

- [x] Validate user existence, organization membership, and duplicate assignment.
- [x] Assignment must not rebuild closure because structure did not change.
- [x] Refresh affected hierarchy, user, mailbox, and scope data.

### 8.5 Scope preview

```text
GET /api/v1/admin/org/hierarchy/scope/:userId
```

- [x] Preserve self-inspection and Super Admin inspection rules.
- [x] Return distinct mailbox IDs plus safe path summaries for the preview UI.

## 9. Backend implementation

Relevant files:

- `server/drizzle/*_org_hierarchy_positions.sql`
- `server/src/db/schema.ts`
- `server/src/modules/org-hierarchy/org-hierarchy.types.ts`
- `server/src/modules/org-hierarchy/org-hierarchy.repository.ts`
- `server/src/modules/org-hierarchy/org-hierarchy.service.ts`
- `server/src/modules/org-hierarchy/org-hierarchy.controller.ts`
- `server/src/modules/org-hierarchy/org-hierarchy.routes.ts`
- `server/src/lib/mailbox-scope.ts`
- `server/src/modules/users/user.service.ts`
- `server/src/modules/users/user.repository.pg.ts`

- [x] Replace user-centric node contracts with position-centric node and reporting-line contracts.
- [x] Return nullable assignment details in the DTO.
- [x] Join the effective custom role for occupied positions.
- [x] Implement position CRUD and atomic manager-set replacement.
- [x] Implement assignment and unassignment separately from structure mutation.
- [x] Rebuild closure with a cycle-safe recursive query.
- [x] Make the in-memory repository match PostgreSQL behaviour.
- [x] Resolve mailbox scope through position closure and occupied nodes.
- [x] Make physical user deletion unassign the position instead of deleting it.
- [x] Keep structural writes, closure updates, and audit behaviour transactionally consistent.

## 10. Frontend implementation

Relevant files:

- `client/src/features/org-hierarchy/OrgHierarchyView.tsx`
- `client/src/features/org-hierarchy/org-hierarchy.api.ts`
- `client/src/styles/features/org-hierarchy/OrgHierarchyView.module.css`
- `client/src/features/mailboxes/mailboxes.api.ts`
- `client/src/features/dashboard/views/RolesView.tsx`

### 10.1 Full workflow

```text
Create Organization
        ↓
Design Hierarchy
        ↓
Create Vacant Positions
        ↓
Connect One or More Managers
        ↓
Assign Users
        ↓
Preview Effective Access
```

- [x] Refresh hierarchy immediately after organization creation.
- [x] Change the empty action from `Add first member` to `Add first position`.
- [x] Permit root and child positions without users.
- [x] Give authorized cards `Add direct report`, `Edit position`, and `Assign user` actions.
- [x] Show `Vacant` clearly on unassigned cards.
- [x] Show name, email, avatar, title, department, and effective role on occupied cards.
- [x] Keep user assignment and structure editing as separate actions.

### 10.2 Multiple-manager editor

- [x] Replace the single `Reports to` value with a multi-select manager list.
- [x] Display every selected manager before save.
- [x] Exclude the current node and every descendant using the complete graph.
- [x] Show a clear error when a proposed manager set creates a cycle.
- [x] Permit CEO and CTO to be selected together for one shared manager.

### 10.3 Graph rendering

- [x] Replace single-parent `buildTree()` assumptions with separate node/edge graph data.
- [x] Compute deterministic display levels from roots while deduplicating shared nodes.
- [x] Render a shared report once with incoming connectors from every direct manager.
- [x] Preserve collapse/expand without hiding a node still visible through another expanded path.
- [x] Keep horizontal scrolling for wide desktop charts.
- [x] Provide a readable list/tree fallback for small screens and keyboard users.
- [x] Reuse existing React, CSS, Modal, Drawer, Combobox, and Avatar components.
- [x] Do not add a graph or drag-and-drop dependency unless native rendering fails an approved acceptance case.

### 10.4 Filtering, users, and mailboxes

- [x] Build the complete graph before department filtering.
- [x] Retain ancestor paths for matches; never create a false root.
- [x] Filtering must not alter manager choices or structural relationships.
- [x] Reuse one complete paginated mailbox loader; do not stop at 200.
- [x] Separate partial and complete React Query cache keys, or standardize on a complete contract.
- [x] Deduplicate user/mailbox candidates case-insensitively.
- [x] Remove redundant `userEmailSet.has(user.email)` logic.
- [x] Exclude users already assigned elsewhere.
- [x] Support mailbox-to-user creation before assignment, not during position creation.

### 10.5 Access preview

- [x] Let Super Admin preview a selected user's effective scope.
- [x] Show which reporting paths grant access when multiple paths exist.
- [x] Deduplicate mailbox results while preserving understandable path information.
- [x] Refresh preview after structure and assignment changes.

## 11. Safe migration plan

The migration must preserve existing data even if the latest snapshot was empty.

- [ ] Re-run node, root, cycle, edge, and closure-integrity diagnostics.
- [ ] Take a recoverable database backup.
- [x] Add nullable/new columns and `org_reporting_lines` before dropping anything.
- [x] Backfill missing position titles.
- [x] Convert each existing `manager_id` relationship to a reporting-line row by mapping users to node IDs.
- [x] Rebuild position-based closure.
- [x] Compare old and new mailbox scope for every assigned user.
- [x] Verify node, edge, assignment, closure, and mailbox counts.
- [x] Remove old `manager_id` and user-based closure constraints only after verification.
- [x] Provide a rollback migration or documented restore procedure.
- [x] Run migration verification only against an approved dedicated test database first.

## 12. Existing defects included in this plan

### P1 — User deletion can corrupt hierarchy scope

- [x] Replace hierarchy-row deletion with assignment clearing.
- [x] Use `ON DELETE SET NULL` for the assigned user.
- [x] Test `Chairman -> shared Manager -> Employee`, then delete/cancel the manager user.
- [x] Confirm the position becomes vacant and structure/scope remain correct.

### P1 — Multi-parent closure correctness

- [x] Test a report reachable through CEO and CTO simultaneously.
- [x] Remove the CEO line and confirm CTO reachability remains.
- [x] Remove the final path and confirm ancestor scope disappears.
- [x] Confirm closure stores minimum depth.

### P2 — Department filtering creates false roots

- [x] Filter after building the complete graph.
- [x] Preserve real ancestors and incoming lines.
- [x] Calculate invalid manager choices from unfiltered data.

### P2 — Mailbox pagination is incomplete

- [x] Load all eligible mailbox pages in deterministic order.
- [x] Test with more than 200 mailboxes.
- [x] Confirm the final mailbox can become a user and be assigned.

### P2 — UUID validation is incomplete

- [x] Add a small local UUID parser without a new dependency.
- [x] Validate route IDs, body IDs, manager-ID arrays, whitespace, nullability, and duplicates.
- [x] Return HTTP 400 instead of allowing malformed IDs to reach PostgreSQL.

### P2 — Organization creation leaves hierarchy stale

- [x] Invalidate/refetch organization and hierarchy queries after organization creation.
- [x] Show `Add first position` without a reload.

### P3 — Role label and candidate logic

- [x] Return the effective custom role name for occupied cards.
- [x] Remove the redundant `userEmailSet` condition.
- [x] Keep user/mailbox deduplication case-insensitive.

## 13. Required tests

### Service and validation

- [x] Create vacant root and child positions.
- [x] Assign, unassign, replace, and move users.
- [x] Reject one user occupying two positions.
- [x] Assign multiple direct managers to one report.
- [x] Reject duplicate managers, self-reporting, and direct/indirect cycles.
- [x] Reject cross-organization nodes, users, and lines.
- [x] Reject deleting positions with children.
- [x] Validate malformed UUIDs on every endpoint.

### Repository and closure

- [x] Create `Chairman -> CEO/CTO -> shared Managers -> Employees`.
- [x] Verify every depth-0 self row.
- [x] Verify one closure row per ancestor/descendant despite multiple paths.
- [x] Verify minimum depth when path lengths differ.
- [x] Add/remove/replace manager sets and compare closure with a fresh recursive calculation.
- [x] Move a branch and verify old access disappears and new access appears.
- [x] Preserve descendants through vacant positions.
- [x] Run matching cases against in-memory and PostgreSQL repositories.

### Permissions

- [x] Chairman gets every descendant mailbox once.
- [x] CEO and CTO both get shared branches.
- [x] Manager gets only own branch.
- [x] Employee gets only own mailbox.
- [x] Vacant positions grant no direct access but preserve traversal.
- [x] Users without positions fail closed.
- [x] Self-scope, cross-user denial, and Super Admin inspection behave correctly.

### Frontend

- [x] Create a full vacant hierarchy before users exist.
- [x] Select CEO and CTO together as managers.
- [x] Render each shared manager once with multiple incoming connections.
- [x] Assignment changes `Vacant` to occupied without changing edges.
- [x] Unassignment preserves all children and returns the card to `Vacant`.
- [x] Department filtering preserves true graph structure.
- [x] More than 200 mailbox candidates load correctly.
- [x] Desktop, mobile/list fallback, keyboard, loading, empty, and error states work.

### Concurrency and regression

- [x] Concurrent edits cannot create a cycle or partial closure.
- [x] Concurrent assignment cannot place one user in two positions.
- [x] User deletion and assignment cannot leave dangling references.
- [x] Mailbox, message, thread, attachment, document, and chat callers use the new scope resolver.
- [x] Audit events contain correct before/after data.

## 14. Required delivery order

All phases are required for the complete feature.

### Phase 0 — Safety baseline

- [ ] Re-run database integrity diagnostics.
- [ ] Capture current API contracts and scope results.
- [ ] Confirm backup, rollback, and dedicated test database.

### Phase 1 — Position and edge schema

- [x] Add nullable assignment, ordering, reporting lines, and node-based closure.
- [x] Migrate existing relationships safely.
- [x] Update Drizzle schema and inferred types.

### Phase 2 — Backend graph operations

- [x] Implement position CRUD, manager-set replacement, cycle validation, and closure rebuild.
- [x] Implement user assignment/unassignment and hierarchy-aware deletion.
- [x] Add boundary validation, authorization, and audit events.

### Phase 3 — Mailbox scope

- [x] Switch every scope consumer to position-based closure.
- [x] Verify multi-path deduplication and fail-closed behaviour.
- [x] Add Super Admin scope preview.

### Phase 4 — Full frontend designer

- [x] Add vacant position creation/editing.
- [x] Add assignment management.
- [x] Add multi-manager selection and shared-node rendering.
- [x] Add safe filtering, complete mailbox loading, scope preview, and responsive behaviour.

### Phase 5 — Verification and rollout

- [x] Run unit, integration, build, lint, and type checks.
- [x] Validate the Chairman/CEO/CTO/shared-manager example in PostgreSQL.
- [x] Verify final effective mailbox access through the UI and repository query.
- [ ] Roll out only after migration rehearsal and rollback verification.

## 15. Definition of done

- Super Admin can design the complete structure with no users assigned.
- Vacant positions persist and render correctly.
- One manager can report directly to CEO and CTO simultaneously.
- Shared descendants render once and remain reachable through every valid path.
- Users can be assigned, unassigned, replaced, moved, and deleted without damaging structure.
- Mailbox scope follows every valid path and has no duplicates.
- Cycles, self-links, duplicate lines, cross-org links, and duplicate assignments are blocked.
- Department filtering cannot change structural truth.
- Every eligible user/mailbox can be selected beyond the first 200 results.
- PostgreSQL closure matches a fresh recursive calculation.
- In-memory and PostgreSQL behaviour agree.
- Migration preserves existing data and has a tested rollback path.
- Audit events cover every structural and assignment mutation.
- Server/client checks and the real PostgreSQL integration suite pass.

Run from `server`:

```powershell
npm.cmd run typecheck
npm.cmd exec -- eslint src/modules/org-hierarchy src/lib/mailbox-scope.ts tests/unit/modules/org-hierarchy
npm.cmd exec -- vitest run tests/unit/modules/org-hierarchy
```

Run the PostgreSQL integration only against a NEW EMPTY dedicated test database named `hierarchy_test_*` (the test applies and verifies the migrations itself):

```powershell
$env:RUN_PG_INTEGRATION = '1'
$env:HIERARCHY_TEST_DATABASE_URL = 'postgresql://TEST_USER@127.0.0.1:TEST_PORT/hierarchy_test_unique_name'
npm.cmd exec -- vitest run tests/unit/modules/org-hierarchy/org-hierarchy.repository.pg.test.ts
```

Run from `client`:

```powershell
npm.cmd run typecheck
npm.cmd exec -- eslint src/features/org-hierarchy
npm.cmd run build
```

Do not mark this TODO complete from UI screenshots or in-memory tests alone. Confirm migrated PostgreSQL reporting lines, closure rows, assignments, and effective mailbox scope for create, move, multi-manager replacement, unassignment, user deletion, and position deletion.

## 16. Implementation evidence and remaining rollout

Implemented 2026-09-11. See [operation, verification and rollback guide](11-org-hierarchy-rollout.md).

- Position-first schema, vacant assignments, multi-parent edges, single-root DAG validation and node-based minimum-depth closure are implemented.
- Structural mutations, assignment checks and safe audit snapshots are transactional in PostgreSQL.
- User deletion uses SET NULL. Normal-user scope flows through the existing shared resolver for mailbox, message, thread, attachment, document and chat consumers.
- The designer uses native SVG and existing UI components, without a graph/layout dependency. The shared picker now supports keyboard selection.
- Migration 0021 compares old/new ancestry AND actual mailbox scope. Invalid legacy closure aborts safely; a legacy forest receives a vacant synthetic root.
- Hierarchy/HTTP coverage now contains 41 cases, including seven real PostgreSQL cases and in-memory custom-role parity. Migration rollback and the read-only diagnostic script were rehearsed against populated legacy rows.
- Separate pg_dump/pg_restore rehearsal retained 12 positions, 12 edges, 36 closure rows and 32 audit events in its test snapshot.
- Final combined server suite: **195 tests passed, zero skipped**, with RUN_PG_INTEGRATION=1 against a fresh dedicated database. Without that flag, the seven PostgreSQL cases are deliberately skipped.
- Client pure-graph/pagination tests: 4 passed, including 405 mailboxes.
- Server/client typecheck, lint and build passed. Edge browser acceptance passed against the real PostgreSQL fixture: full vacant graph, all shared connectors, keyboard assignments, the final mailbox beyond 200, both executive scopes, collapse/filter paths, unassignment, root-first mobile list and read-error recovery.

Unchecked safety/rollout items refer to the EXISTING application database, not the dedicated test fixtures.
That database has not been migrated or backed up by this implementation session. Before restarting the new server against it, stop writes, run preflight, take/verify a backup and follow the rollout guide.

Compatibility notes: the existing application has one configured organization and no user organization-membership column.
Domain/admin-email and mailbox ownership checks are used; this work does not introduce a multi-tenant identity model.
Deactivated accounts cannot authenticate, but retained mailbox ownership remains in managers' scope. Moving an account is an explicit unassign-then-assign workflow.
