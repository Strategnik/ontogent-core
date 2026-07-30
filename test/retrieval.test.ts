import { expect, test } from "bun:test";
import { axisOverlap, cosineSimilarity, retrieve } from "../src/retrieval";

test("cosineSimilarity handles normal, mismatched, and zero vectors", () => {
  expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  expect(cosineSimilarity([1], [1, 0])).toBe(0);
  expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
});

test("axisOverlap scores full, absent, and partial overlap", () => {
  expect(axisOverlap({ topic: ["a"] }, { topic: ["a"] })).toBe(1);
  expect(axisOverlap({ topic: ["a"] }, { topic: ["b"] })).toBe(0);
  expect(axisOverlap({ topic: ["a", "b"] }, { topic: ["a"] })).toBe(0.5);
});

test("retrieve ranks combined signals and keeps vectorless items", () => {
  const result = retrieve(
    { vector: [1, 0], axes: { topic: ["a"] } },
    [
      { id: "weak", vector: [0, 1], axes: { topic: ["b"] }, authority: "canonical" },
      { id: "best", vector: [1, 0], axes: { topic: ["a"] }, authority: "corrected" },
      { id: "facets", axes: { topic: ["a"] }, authority: "validated" },
    ],
  );
  expect(result.map(({ item }) => item.id)).toEqual(["best", "facets", "weak"]);
});

test("retrieve can diversify near-duplicate vectors with MMR", () => {
  const result = retrieve(
    { vector: [1, 0] },
    [
      { id: "first", vector: [1, 0] },
      { id: "duplicate", vector: [0.999, 0.001] },
      { id: "different", vector: [0, 1] },
    ],
    { topK: 2, mmr: { lambda: 0.3 } },
  );
  expect(result.map(({ item }) => item.id)).toEqual(["first", "different"]);
});
