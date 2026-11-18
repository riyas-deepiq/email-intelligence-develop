import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { HierarchyCommand, OrgGraph } from './org-hierarchy.types';

/** Reachability with shortest distances; one visit per node even in a diamond. */
export function descendants(graph: OrgGraph, start: string): Map<string, number> {
  const distance = new Map([[start, 0]]);
  const children = new Map<string, string[]>();
  for (const e of graph.reportingLines) {
    children.set(e.managerNodeId, [...(children.get(e.managerNodeId) ?? []), e.reportNodeId]);
  }
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) ?? []) {
      if (!distance.has(child)) {
        distance.set(child, distance.get(queue[i])! + 1);
        queue.push(child);
      }
    }
  }
  return distance;
}

export function validateGraph(graph: OrgGraph): void {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const parents = new Map(graph.nodes.map((n) => [n.id, 0]));
  const children = new Map<string, string[]>();
  const edges = new Set<string>();
  for (const e of graph.reportingLines) {
    if (!ids.has(e.managerNodeId) || !ids.has(e.reportNodeId)) {
      throw new ValidationError('Managers must belong to this organization');
    }
    const key = e.managerNodeId + ':' + e.reportNodeId;
    if (edges.has(key)) throw new ValidationError('Duplicate reporting line');
    edges.add(key);
    parents.set(e.reportNodeId, parents.get(e.reportNodeId)! + 1);
    children.set(e.managerNodeId, [...(children.get(e.managerNodeId) ?? []), e.reportNodeId]);
  }
  const roots = [...parents].filter(([, n]) => n === 0).map(([id]) => id);
  if (ids.size && roots.length !== 1)
    throw new ValidationError('Hierarchy must have exactly one root position');
  let visited = 0;
  for (let i = 0; i < roots.length; i++) {
    visited++;
    for (const child of children.get(roots[i]) ?? []) {
      parents.set(child, parents.get(child)! - 1);
      if (parents.get(child) === 0) roots.push(child);
    }
  }
  if (visited !== ids.size) throw new ValidationError('Reporting cycle is not allowed');
  const assigned = graph.nodes.flatMap((n) => (n.userId ? [n.userId] : []));
  if (new Set(assigned).size !== assigned.length)
    throw new ConflictError('User already occupies another position');
}

export function applyCommand(
  original: OrgGraph,
  orgId: string,
  command: HierarchyCommand,
): OrgGraph {
  const graph = structuredClone(original);
  let node = graph.nodes.find((n) => n.id === command.nodeId);
  const timestamp = new Date().toISOString();
  if (command.type === 'create') {
    if (node) throw new ConflictError('Position already exists');
    node = {
      id: command.nodeId,
      orgId,
      title: command.input.title,
      department: command.input.department ?? null,
      sortOrder: command.input.sortOrder ?? 0,
      userId: command.input.userId ?? null,
      user: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    graph.nodes.push(node);
  } else if (!node) throw new NotFoundError('Position not found in this organization');
  if (!node) throw new NotFoundError('Position not found');
  if (command.type === 'update') Object.assign(node, command.input);
  if (command.type === 'assignment') {
    node.userId = command.userId;
    node.user = null;
  }
  node.updatedAt = timestamp;
  if (command.type === 'managers' || command.type === 'create') {
    const managers =
      command.type === 'create' ? command.input.managerNodeIds : command.managerNodeIds;
    graph.reportingLines = graph.reportingLines.filter((e) => e.reportNodeId !== node.id);
    graph.reportingLines.push(
      ...managers.map((id) => ({ managerNodeId: id, reportNodeId: node.id })),
    );
  }
  if (command.type === 'delete') {
    if (graph.reportingLines.some((e) => e.managerNodeId === node.id)) {
      throw new ConflictError(
        'Move or remove the child reporting lines before deleting this position',
      );
    }
    graph.nodes = graph.nodes.filter((n) => n.id !== node.id);
    graph.reportingLines = graph.reportingLines.filter((e) => e.reportNodeId !== node.id);
  }
  validateGraph(graph);
  return graph;
}
