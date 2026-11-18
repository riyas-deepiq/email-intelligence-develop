import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../../lib/errors';
import type { AuditActor } from '../audit/audit.types';
import type { OrgRepository } from '../organizations/org.repository';
import { descendants } from './org-hierarchy.graph';
import type {
  HierarchyCommand,
  OrgHierarchyRepository,
  ScopePreview,
  OrgGraph,
} from './org-hierarchy.types';

export class OrgHierarchyService {
  constructor(
    private readonly repo: OrgHierarchyRepository,
    private readonly orgRepo: OrgRepository,
  ) {}
  async getOrgId(): Promise<string> {
    const org = await this.orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured');
    return org.id;
  }
  async getTree(): Promise<OrgGraph> {
    return this.repo.getGraph(await this.getOrgId());
  }
  async mutate(command: HierarchyCommand, actor?: AuditActor): Promise<OrgGraph> {
    return this.repo.mutate(await this.getOrgId(), command, actor);
  }
  async create(
    input: Extract<HierarchyCommand, { type: 'create' }>['input'],
    actor?: AuditActor,
  ): Promise<OrgGraph> {
    return this.mutate({ type: 'create', nodeId: randomUUID(), input }, actor);
  }
  async getScope(userId: string): Promise<ScopePreview> {
    const graph = await this.getTree();
    const node = graph.nodes.find((n) => n.userId === userId);
    const reachable = node ? descendants(graph, node.id) : new Map<string, number>();
    return {
      userId,
      mailboxIds: await this.repo.getAllowedMailboxIds(userId),
      nodes: graph.nodes.filter((n) => reachable.has(n.id)),
      reportingLines: graph.reportingLines.filter(
        (e) => reachable.has(e.managerNodeId) && reachable.has(e.reportNodeId),
      ),
    };
  }
}
