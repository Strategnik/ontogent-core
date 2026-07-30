import type { ProjectContextGraph } from "./types";

export type Neighbor = {
  id: string;
  edge: string;
  direction: "outgoing" | "incoming";
};

export function buildAdjacency(graph: ProjectContextGraph): Map<string, Neighbor[]> {
  const adjacency = new Map<string, Neighbor[]>(graph.nodes.map((node) => [node.id, []]));
  const push = (id: string, neighbor: Neighbor) => {
    const current = adjacency.get(id);
    if (current) current.push(neighbor);
    else adjacency.set(id, [neighbor]);
  };

  for (const node of graph.nodes) {
    for (const edge of node.edges ?? []) {
      push(node.id, { id: edge.to, edge: edge.edge, direction: "outgoing" });
      push(edge.to, { id: node.id, edge: edge.edge, direction: "incoming" });
    }
  }
  return adjacency;
}

export function neighbors(
  graph: ProjectContextGraph,
  nodeId: string,
  opts: { direction?: "outgoing" | "incoming"; edgeType?: string } = {},
): Neighbor[] {
  return (buildAdjacency(graph).get(nodeId) ?? []).filter(
    (neighbor) =>
      (!opts.direction || neighbor.direction === opts.direction) &&
      (!opts.edgeType || neighbor.edge === opts.edgeType),
  );
}

export function bfsDistances(
  adjacency: Map<string, Neighbor[]>,
  startIds: string[],
  maxDepth: number,
): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: string[] = [];

  for (const id of startIds) {
    if (!distances.has(id)) {
      distances.set(id, 0);
      queue.push(id);
    }
  }

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    const distance = distances.get(id)!;
    if (distance >= maxDepth) continue;
    for (const neighbor of adjacency.get(id) ?? []) {
      if (!distances.has(neighbor.id)) {
        distances.set(neighbor.id, distance + 1);
        queue.push(neighbor.id);
      }
    }
  }
  return distances;
}

export function shortestPath(
  adjacency: Map<string, Neighbor[]>,
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from];
  const previous = new Map<string, string>();
  const visited = new Set([from]);
  const queue = [from];

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const neighbor of adjacency.get(id) ?? []) {
      if (visited.has(neighbor.id)) continue;
      visited.add(neighbor.id);
      previous.set(neighbor.id, id);
      if (neighbor.id === to) {
        const path = [to];
        while (path[0] !== from) path.unshift(previous.get(path[0]!)!);
        return path;
      }
      queue.push(neighbor.id);
    }
  }
  return null;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error(`chunkArray: size must be positive, got ${size}`);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
