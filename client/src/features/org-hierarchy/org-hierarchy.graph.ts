import type { OrgGraph } from './org-hierarchy.api';

export const ORG_CHART_CARD = { width: 220, height: 320 } as const;
const COLUMN_GAP = 28;
const ROW_GAP = 76;
const CANVAS_PADDING = 32;

export function edgePath(startX: number, startY: number, endX: number, endY: number): string {
  const middleY = startY + (endY - startY) / 2;
  return `M${startX},${startY} C${startX},${middleY} ${endX},${middleY} ${endX},${endY}`;
}

export function reachable(graph: OrgGraph, start: string, reverse = false): Set<string> {
  const found = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const e of graph.reportingLines) {
      const from = reverse ? e.reportNodeId : e.managerNodeId;
      const to = reverse ? e.managerNodeId : e.reportNodeId;
      if (from === queue[i] && !found.has(to)) {
        found.add(to);
        queue.push(to);
      }
    }
  }
  return found;
}

export function visibleGraph(
  graph: OrgGraph,
  collapsed: Set<string>,
  department: string,
): OrgGraph {
  let retained = new Set(graph.nodes.map((n) => n.id));
  if (department) {
    retained = new Set<string>();
    for (const n of graph.nodes.filter((n) => n.department === department)) {
      for (const id of reachable(graph, n.id, true)) retained.add(id);
    }
  }
  const hasParent = new Set(graph.reportingLines.map((e) => e.reportNodeId));
  const visible = new Set(
    graph.nodes.filter((n) => !hasParent.has(n.id) && retained.has(n.id)).map((n) => n.id),
  );
  const queue = [...visible];
  for (let i = 0; i < queue.length; i++) {
    // Filtering always reveals ancestor paths, regardless of an earlier collapse.
    if (!department && collapsed.has(queue[i])) continue;
    for (const e of graph.reportingLines) {
      if (
        e.managerNodeId === queue[i] &&
        retained.has(e.reportNodeId) &&
        !visible.has(e.reportNodeId)
      ) {
        visible.add(e.reportNodeId);
        queue.push(e.reportNodeId);
      }
    }
  }
  return {
    nodes: graph.nodes.filter((n) => visible.has(n.id)),
    reportingLines: graph.reportingLines.filter(
      (e) =>
        visible.has(e.managerNodeId) &&
        visible.has(e.reportNodeId) &&
        (department || !collapsed.has(e.managerNodeId)),
    ),
  };
}

export function layoutGraph(graph: OrgGraph) {
  const degrees = new Map(graph.nodes.map((n) => [n.id, 0]));
  const levels = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.reportingLines)
    degrees.set(e.reportNodeId, (degrees.get(e.reportNodeId) ?? 0) + 1);
  const queue = graph.nodes.filter((n) => degrees.get(n.id) === 0).map((n) => n.id);
  for (let i = 0; i < queue.length; i++) {
    for (const e of graph.reportingLines.filter((e) => e.managerNodeId === queue[i])) {
      levels.set(
        e.reportNodeId,
        Math.max(levels.get(e.reportNodeId) ?? 0, levels.get(queue[i])! + 1),
      );
      degrees.set(e.reportNodeId, degrees.get(e.reportNodeId)! - 1);
      if (!degrees.get(e.reportNodeId)) queue.push(e.reportNodeId);
    }
  }
  const orderedNodes = [...graph.nodes].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
  const nodeOrder = new Map(orderedNodes.map((node, index) => [node.id, index]));
  const rows = new Map<number, string[]>();
  for (const n of orderedNodes) {
    const level = levels.get(n.id)!;
    rows.set(level, [...(rows.get(level) ?? []), n.id]);
  }
  const maxColumns = Math.max(1, ...[...rows.values()].map((row) => row.length));
  const width =
    maxColumns * ORG_CHART_CARD.width + (maxColumns - 1) * COLUMN_GAP + CANVAS_PADDING * 2;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, unsortedRow] of [...rows].sort(([a], [b]) => a - b)) {
    const row = [...unsortedRow].sort((a, b) => {
      const managerCenter = (id: string) => {
        const managers = graph.reportingLines
          .filter((edge) => edge.reportNodeId === id)
          .map((edge) => positions.get(edge.managerNodeId)?.x)
          .filter((x): x is number => x !== undefined);
        return managers.length
          ? managers.reduce((sum, x) => sum + x, 0) / managers.length
          : Number.POSITIVE_INFINITY;
      };
      return managerCenter(a) - managerCenter(b) || nodeOrder.get(a)! - nodeOrder.get(b)!;
    });
    const rowWidth = row.length * ORG_CHART_CARD.width + (row.length - 1) * COLUMN_GAP;
    row.forEach((id, i) =>
      positions.set(id, {
        x: (width - rowWidth) / 2 + i * (ORG_CHART_CARD.width + COLUMN_GAP),
        y: CANVAS_PADDING + level * (ORG_CHART_CARD.height + ROW_GAP),
      }),
    );
  }
  const levelCount = Math.max(1, ...levels.values()) + 1;
  return {
    positions,
    width,
    height: levelCount * ORG_CHART_CARD.height + (levelCount - 1) * ROW_GAP + CANVAS_PADDING * 2,
    cardWidth: ORG_CHART_CARD.width,
    cardHeight: ORG_CHART_CARD.height,
  };
}

export function layoutConnectors(graph: OrgGraph, layout: ReturnType<typeof layoutGraph>) {
  const managersByReport = new Map<string, string[]>();
  for (const edge of graph.reportingLines) {
    managersByReport.set(edge.reportNodeId, [
      ...(managersByReport.get(edge.reportNodeId) ?? []),
      edge.managerNodeId,
    ]);
  }
  const reportsByManagers = new Map<string, { managerIds: string[]; reportIds: string[] }>();
  for (const [reportId, managerIds] of managersByReport) {
    managerIds.sort();
    const key = managerIds.join(':');
    const group = reportsByManagers.get(key) ?? { managerIds, reportIds: [] };
    group.reportIds.push(reportId);
    reportsByManagers.set(key, group);
  }
  return [...reportsByManagers.entries()].flatMap(([key, group]) => {
    const parents = group.managerIds.map((id) => layout.positions.get(id)!);
    const reports = group.reportIds.map((id) => layout.positions.get(id)!);
    const startYs = new Set(parents.map((position) => position.y + layout.cardHeight));
    const endYs = new Set(reports.map((position) => position.y));
    if (startYs.size !== 1 || endYs.size !== 1) {
      return group.reportIds.flatMap((reportId) =>
        group.managerIds.map((managerId) => {
          const parent = layout.positions.get(managerId)!;
          const report = layout.positions.get(reportId)!;
          const startX = parent.x + layout.cardWidth / 2;
          const endX = report.x + layout.cardWidth / 2;
          return {
            key: managerId + ':' + reportId,
            d: edgePath(startX, parent.y + layout.cardHeight, endX, report.y),
            endpoints: [{ x: endX, y: report.y }],
          };
        }),
      );
    }
    const startY = [...startYs][0];
    const endY = [...endYs][0];
    const parentXs = parents
      .map((position) => position.x + layout.cardWidth / 2)
      .sort((a, b) => a - b);
    const reportXs = reports
      .map((position) => position.x + layout.cardWidth / 2)
      .sort((a, b) => a - b);
    const centerX = parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length;
    const reportCenterX = reportXs.reduce((sum, x) => sum + x, 0) / reportXs.length;
    const joinY = startY + (endY - startY) * 0.3;
    const branchY = startY + (endY - startY) * 0.7;
    const middleY = joinY + (branchY - joinY) / 2;
    const parts = [
      ...parentXs.map((x) => `M${x},${startY} V${joinY}`),
      parentXs.length > 1 ? `M${parentXs[0]},${joinY} H${parentXs.at(-1)}` : '',
      `M${centerX},${joinY} C${centerX},${middleY} ${reportCenterX},${middleY} ${reportCenterX},${branchY}`,
      reportXs.length > 1 ? `M${reportXs[0]},${branchY} H${reportXs.at(-1)}` : '',
      ...reportXs.map((x) => `M${x},${branchY} V${endY}`),
    ].filter(Boolean);
    return [{ key, d: parts.join(' '), endpoints: reportXs.map((x) => ({ x, y: endY })) }];
  });
}
