import type { AuditActor } from '../audit/audit.types';

export interface OrgNode {
  id: string;
  orgId: string;
  userId: string | null;
  title: string;
  department: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    roleName: string | null;
  } | null;
}
export interface ReportingLine {
  managerNodeId: string;
  reportNodeId: string;
}
export interface OrgGraph {
  nodes: OrgNode[];
  reportingLines: ReportingLine[];
}
export interface PositionInput {
  title: string;
  department?: string | null;
  sortOrder?: number;
}
export interface AddNodeInput extends PositionInput {
  managerNodeIds: string[];
  userId?: string | null;
}
export type UpdateNodeInput = Partial<PositionInput>;
export type HierarchyCommand =
  | { type: 'create'; input: AddNodeInput; nodeId: string }
  | { type: 'update'; input: UpdateNodeInput; nodeId: string }
  | { type: 'managers'; managerNodeIds: string[]; nodeId: string }
  | { type: 'assignment'; userId: string | null; nodeId: string }
  | { type: 'delete'; nodeId: string };
export interface ScopePreview {
  userId: string;
  mailboxIds: string[];
  nodes: OrgNode[];
  reportingLines: ReportingLine[];
}
export interface OrgHierarchyRepository {
  getGraph(orgId: string): Promise<OrgGraph>;
  mutate(orgId: string, command: HierarchyCommand, actor?: AuditActor): Promise<OrgGraph>;
  getAllowedMailboxIds(userId: string): Promise<string[]>;
}
