import { expect, test } from "bun:test";
import { bfsDistances, buildAdjacency, neighbors, shortestPath } from "../src/graph";
import type { ProjectContextGraph } from "../src/types";

const graph: ProjectContextGraph = {
  attrs: {},
  nodes: [
    { id: "a", type: "thing", edges: [{ edge: "links", to: "b" }] },
    { id: "b", type: "thing", edges: [{ edge: "contains", to: "c" }] },
    { id: "c", type: "thing" },
    { id: "isolated", type: "thing" },
  ],
};

test("buildAdjacency indexes directed edges both ways", () => {
  const adjacency = buildAdjacency(graph);
  expect(adjacency.get("a")).toEqual([{ id: "b", edge: "links", direction: "outgoing" }]);
  expect(adjacency.get("b")).toContainEqual({ id: "a", edge: "links", direction: "incoming" });
  expect(neighbors(graph, "b", { direction: "outgoing", edgeType: "contains" })).toEqual([
    { id: "c", edge: "contains", direction: "outgoing" },
  ]);
});

test("bfsDistances finds hops and respects maxDepth", () => {
  const distances = bfsDistances(buildAdjacency(graph), ["a"], 1);
  expect(distances.get("a")).toBe(0);
  expect(distances.get("b")).toBe(1);
  expect(distances.has("c")).toBe(false);
});

test("shortestPath returns a path or null", () => {
  const adjacency = buildAdjacency(graph);
  expect(shortestPath(adjacency, "a", "c")).toEqual(["a", "b", "c"]);
  expect(shortestPath(adjacency, "a", "isolated")).toBeNull();
});
