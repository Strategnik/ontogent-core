import { expect, test } from "bun:test";
import {
  authorityRank,
  authorityStrength,
  compareByAuthorityThenRecency,
} from "../src/authority";

test("authority helpers rank and normalize the ladder", () => {
  expect(authorityRank("corrected")).toBe(0);
  expect(authorityRank("unknown")).toBe(8);
  expect(authorityStrength("corrected")).toBe(1);
  expect(authorityStrength("canonical")).toBe(0);
});

test("compareByAuthorityThenRecency orders authority before recency", () => {
  const items = [
    { id: "new weaker", authority: "working", updatedAt: "2026-07-01" },
    { id: "old strong", authority: "validated", updatedAt: "2025-01-01" },
    { id: "new strong", authority: "validated", updatedAt: "2026-01-01" },
  ];
  expect(items.sort(compareByAuthorityThenRecency).map(({ id }) => id)).toEqual([
    "new strong",
    "old strong",
    "new weaker",
  ]);
});
