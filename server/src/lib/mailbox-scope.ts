import { createOrgHierarchyRepository } from '../modules/org-hierarchy/org-hierarchy.repository';

const orgHierarchyRepo = createOrgHierarchyRepository();

/**
 * Mailbox ids a non-superadmin user is allowed to see.
 *
 * - Every non-superadmin receives their own mailbox plus mailboxes owned by
 *   users in their org-hierarchy subtree (direct or transitive reports).
 * - Scope follows reporting position, not the legacy employee/admin role. A
 *   manager may therefore have the employee role while still seeing reports;
 *   peers and unrelated branches remain isolated.
 *
 * Backed by the `org_closure` transitive-closure table; a user with no org
 * hierarchy node yet just gets their own mailbox back, since the closure
 * table has no descendants for them.
 */
export async function getScopedMailboxIds(userId: string): Promise<string[]> {
  return orgHierarchyRepo.getAllowedMailboxIds(userId);
}
