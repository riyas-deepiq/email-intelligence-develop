import { describe, expect, it, vi } from 'vitest';
import {
  edgePath,
  layoutConnectors,
  visibleGraph,
  layoutGraph,
  reachable,
} from '../src/features/org-hierarchy/org-hierarchy.graph';
import type { OrgGraph } from '../src/features/org-hierarchy/org-hierarchy.api';
vi.mock('../src/shared/api/client', () => ({ apiClient: { get: vi.fn() } }));
import { apiClient } from '../src/shared/api/client';
import { listAllMailboxes } from '../src/features/mailboxes/mailboxes.api';
const graph: OrgGraph = {
  nodes: ['Chairman', 'CEO', 'CTO', 'Manager', 'Employee'].map((id, i) => ({
    id,
    orgId: 'org',
    userId: null,
    title: id,
    department: i === 4 ? 'Engineering' : null,
    sortOrder: i,
    createdAt: '',
    updatedAt: '',
    user: null,
  })),
  reportingLines: [
    ['Chairman', 'CEO'],
    ['Chairman', 'CTO'],
    ['CEO', 'Manager'],
    ['CTO', 'Manager'],
    ['Manager', 'Employee'],
  ].map(([managerNodeId, reportNodeId]) => ({ managerNodeId, reportNodeId })),
};
describe('client hierarchy graph and complete pagination', () => {
  it('keeps reporting connectors visually separate', () => {
    expect(edgePath(100, 320, 40, 396)).toBe('M100,320 C100,358 40,358 40,396');
    expect(edgePath(100, 320, 160, 396)).toBe('M100,320 C100,358 160,358 160,396');
    const layout = layoutGraph(graph);
    const connectors = layoutConnectors(graph, layout);
    expect(connectors).toHaveLength(3);
    expect(connectors.flatMap((connector) => connector.endpoints)).toHaveLength(4);
    expect(connectors.find((connector) => connector.endpoints.length === 2)?.d).toContain(' H');
    const shifted = layoutConnectors(
      {
        nodes: [],
        reportingLines: [
          { managerNodeId: 'manager', reportNodeId: 'one' },
          { managerNodeId: 'manager', reportNodeId: 'two' },
        ],
      },
      {
        positions: new Map([
          ['manager', { x: 200, y: 0 }],
          ['one', { x: 0, y: 200 }],
          ['two', { x: 100, y: 200 }],
        ]),
        width: 300,
        height: 300,
        cardWidth: 100,
        cardHeight: 100,
      },
    )[0].d;
    expect(shifted).toContain('M50,170 H150');
    expect(shifted).not.toContain('H250');
  });
  it('renders shared nodes once at deterministic levels', () => {
    const layout = layoutGraph(graph);
    expect(layout.positions.size).toBe(5);
    expect(layout.positions.get('Manager')!.y).toBeGreaterThan(layout.positions.get('CTO')!.y);
    expect(layout.positions.get('Chairman')!.x + layout.cardWidth / 2).toBe(layout.width / 2);
    expect(layout.height).toBeGreaterThan(layout.positions.get('Employee')!.y + layout.cardHeight);
    expect(layoutGraph({ ...graph, nodes: [...graph.nodes].reverse() })).toEqual(layout);
    const equalOrder = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, sortOrder: 0 })) };
    const equalOrderLayout = layoutGraph(equalOrder);
    expect(equalOrderLayout.positions.get('CEO')!.x).toBeLessThan(
      equalOrderLayout.positions.get('CTO')!.x,
    );
    expect(layoutGraph({ ...equalOrder, nodes: [...equalOrder.nodes].reverse() })).toEqual(
      equalOrderLayout,
    );
  });
  it('preserves shared reports through another expanded branch', () => {
    const one = visibleGraph(graph, new Set(['CEO']), '');
    expect(one.nodes.map((n) => n.id)).toContain('Employee');
    expect(one.reportingLines.some((e) => e.managerNodeId === 'CEO')).toBe(false);
    const both = visibleGraph(graph, new Set(['CEO', 'CTO']), '');
    expect(both.nodes.map((n) => n.id)).not.toContain('Manager');
  });
  it('preserves every real ancestor when filtering and ignores collapse for matches', () => {
    const filtered = visibleGraph(graph, new Set(['Chairman']), 'Engineering');
    expect(filtered.nodes).toHaveLength(5);
    expect(filtered.reportingLines).toHaveLength(5);
    expect(reachable(graph, 'Manager').has('Employee')).toBe(true);
    expect(visibleGraph(graph, new Set(), 'Missing').nodes).toHaveLength(0);
  });
  it('loads the final mailbox beyond 200, with deterministic offsets and ID deduplication', async () => {
    const boxes = Array.from({ length: 405 }, (_, i) => ({
      id: String(i),
      address: i + '@test.example',
    }));
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      const offset = Number(new URL(url!, 'http://localhost').searchParams.get('offset'));
      return { data: { data: boxes.slice(offset, offset + 200) } };
    });
    const result = await listAllMailboxes();
    expect(result).toHaveLength(405);
    expect(result.at(-1)?.address).toBe('404@test.example');
    expect(apiClient.get).toHaveBeenNthCalledWith(3, '/mailboxes?limit=200&offset=400');
  });
});
