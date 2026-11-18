# Position-first organization hierarchy: operation and rollout

Implementation: 2026-09-11. This guide complements [the full TODO](11-org-hierarchy-todo.md).
Final verification: 195 server tests passed including real PostgreSQL integration, four client graph/pagination tests passed, server/client typecheck/build/lint passed, and Edge desktop/mobile acceptance passed.
The existing application database has **not** been migrated by this implementation session.

## Using the designer

1. Sign in as Super Admin and open **Org Hierarchy**.
2. Create/configure the organization, then choose **Add first position**.
3. Create a vacant Chairman and use **Add report** to add CEO and CTO.
4. Add Manager 1 and Manager 2; select **both CEO and CTO** in each manager list.
5. Add employee positions under their managers. No accounts are required to build the chart.
6. Choose **Assign user** separately. Select an existing account or mailbox and confirm the access change.
7. **Assignment** supports replacement/unassignment. To move an account, unassign its old position, then assign the destination; both positions and all edges remain intact.
8. **Edit** saves position details and reporting lines separately. **Save position** does not save an edited manager set; use **Save reporting lines** for that.
9. Preview gained/lost mailbox access before assignments/reporting changes; **Access preview** shows saved scope and all granting edges.
10. Only leaf positions can be deleted. Move their child reporting lines first. Deleting a user clears its assignment, not its position.

One intentional root is required. Non-root positions need at least one manager. There is no hard-coded title, depth, or two-manager limit.
Multiple paths grant the union of descendant mailboxes, once each. Vacancy never interrupts traversal.

## Deliberate compatibility and security decisions

- Every account has at most one position (database uniqueness remains global, consistent with the old schema).
- This application currently has a **singleton organization** and no users.org_id membership column. Assignment uses configured email domains/admin email or existing same-org mailbox ownership; foreign-org mailbox owners are rejected. This is not a new multi-tenant account-membership system.
- User role and reporting position remain independent. Custom role names are displayed.
- Only Super Admin can mutate the hierarchy. org.manage permits graph reads, not edits. Ordinary users can inspect only their own mailbox IDs; cross-user paths are Super Admin-only.
- Unassigned users retain only their own mailbox fallback. Super Admin's full-organization bypass remains separate.
- Deactivated users cannot authenticate or be newly assigned. Their retained mailbox ownership still participates in managers' scope, preserving existing behaviour.
- All hierarchy writes, closure rebuilds and audit records commit together in PostgreSQL. An audit failure rolls the write back.
- In-memory mode mirrors graph/scope rules; the application's existing in-memory audit repository is intentionally non-persistent.
- A global advisory transaction lock serializes graph writers. Avoid bypassing the repository: any administrative direct-SQL repair must acquire the same lock, validate the entire graph and rebuild closure in the same transaction.
- Mailbox-to-account creation precedes assignment as a separate operation. If assignment fails, the created account remains available for retry; the UI refreshes both user/mailbox caches.
- Scope previews are simulations of the currently loaded snapshot, not reservations. The server validates current state at save time.

## Before migrating an existing installation

Do not restart the new server against the existing database before a backup: normal server startup automatically applies pending migrations.

1. Stop application/worker writes and retain the previous application release.
2. Use your existing secure PostgreSQL service/pgpass setup; never paste passwords into logs.
3. Run the read-only legacy diagnostics below. Resolve every integrity error explicitly; the migration aborts rather than silently repairing missing edges or scope.
4. Take a full recoverable backup and restore it to a **separate test database** before applying the new release.
5. Rehearse the migration and compare assignments, node/edge counts, closure and every assigned user's mailbox scope.
6. Schedule the live migration, then deploy frontend and backend together; old hierarchy clients are incompatible with the new API.

Example commands (service names and backup paths are placeholders you must configure):

~~~powershell
psql -X --dbname="service=insight-hub" -v ON_ERROR_STOP=1 -f server/scripts/check-org-hierarchy.sql
pg_dump --dbname="service=insight-hub" --format=custom --file="D:/Backups/insight-hub-before-hierarchy.dump"
pg_restore --dbname="service=insight-hub-rehearsal" --exit-on-error "D:/Backups/insight-hub-before-hierarchy.dump"
~~~

The restore target must be new/empty and must not be the source database.

Migration 0021 validates legacy edges, cycles and closure; backfills blank titles; preserves populated forests by adding one **vacant** synthetic root; converts user edges to node edges; computes minimum-depth closure; and compares both user ancestry and actual mailbox scope before commit.
Any failure rolls the entire migration back. Null assignments use ON DELETE SET NULL.
The Drizzle journal and current schema snapshot are included. Use migrations, not db:push, to retain the custom functions, validation and data conversion.

## Rollback

If migration fails before commit, PostgreSQL rolls back automatically; correct the diagnosed data issue and retry.

After a committed migration, do **not** attempt a lossy multi-parent-to-single-parent downgrade:

1. Stop writes and retain a backup of the new database for investigation.
2. Restore the pre-migration dump into a separate empty database.
3. Verify old hierarchy rows/closure and mailbox counts against the preflight output.
4. Point the **previous application release** at that restored database, then reopen traffic.
5. Keep the migrated database until recovery is verified. Post-migration changes must be reconciled separately.

No live rollback/deletion was executed. Rehearsal verified transactional migration rollback to legacy manager_id rows, plus pg_dump/pg_restore into a separate database.

## Repeatable verification

Server checks:

~~~powershell
cd server
npm.cmd run typecheck
npm.cmd run build
npm.cmd run lint
npm.cmd exec -- vitest run --maxWorkers=2
npm.cmd exec -- vitest run --config vitest.hierarchy-client.config.ts
~~~

The PostgreSQL suite refuses non-empty databases or names outside hierarchy_test_*.
Create a **fresh** dedicated database for every run; no test drops an existing database.

~~~powershell
$env:RUN_PG_INTEGRATION='1'
$env:HIERARCHY_TEST_DATABASE_URL='postgresql://TEST_USER@127.0.0.1:TEST_PORT/hierarchy_test_unique_name'
npm.cmd exec -- vitest run tests/unit/modules/org-hierarchy --maxWorkers=2
~~~

The suite applies the actual SQL migrations, including a populated legacy forest, invalid-closure rejection and a rollback rehearsal.
It validates shortest-depth/deduplicated closure against an independent BFS calculation, shared scope, branch replacement, vacancies, deletion, concurrent edits/assignments, custom roles and audit rollback.
RUN_PG_INTEGRATION is deliberately excluded from the default test run; skipped database tests are not passes.

Client checks:

~~~powershell
cd client
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
~~~

For a browser rehearsal, scripts/hierarchy-test-server.ts refuses non-test or non-empty databases. It creates only test accounts/mailboxes.
Start it from server with a fresh hierarchy_test_* DATABASE_URL, DB_DRIVER=postgres, NODE_ENV=development, PORT=4319,
CORS_ORIGIN=http://127.0.0.1:5180, and empty REDIS_URL, SMTP_HOST and COLLECTOR_URL.
Start Vite from client with VITE_API_URL=http://127.0.0.1:4319/api/v1 and port 5180.

Set PLAYWRIGHT_MODULE to an already installed playwright/index.mjs and run:

~~~powershell
node scripts/verify-hierarchy-browser.mjs
~~~

The runner uses local Edge, checks the fixture organization before writes and resets only that fixture's chart for reruns.
It verifies the entire vacant example, shared-node connectors, keyboard assignment, mailbox candidates past 200,
both executives' real PostgreSQL scope, collapse/filter semantics, unassignment and responsive list layout.
No browser/graph dependency was added to the application.

Local rehearsal data, dumps and screenshots live under ignored .tmp-hierarchy-pg/.
They are disposable test fixtures, not application data or a backup of the existing installation.
Do not remove that folder while its PostgreSQL process is running.
At handoff, the dedicated PostgreSQL, API fixture and Vite test services were stopped; the artifacts were retained.
