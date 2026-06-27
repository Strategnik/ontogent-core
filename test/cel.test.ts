import { test, expect } from "bun:test";
import { evaluate, parse, referencedTypes, CelError, IndeterminateError } from "../src/cel";
import type { ProjectContextGraph } from "../src/types";

const pcg: ProjectContextGraph = {
  attrs: { motion: "PLG", stage: "seed", acv: 8000 },
  nodes: [
    { id: "icp-1", type: "ICP", props: { label: "Devs" }, edges: [{ edge: "targets", to: "p-1" }] },
    { id: "p-1", type: "Persona", props: {}, edges: [] },
    { id: "claim-1", type: "Claim", props: { text: "fastest" }, edges: [] },
    { id: "risk-1", type: "Risk", props: { rating: "material" }, edges: [] },
  ],
};

test("scalar attrs + sugar + in", () => {
  expect(evaluate('pcg.motion == "PLG"', pcg)).toBe(true);
  expect(evaluate('pcg.stage in ["seed", "series_a"]', pcg)).toBe(true);
  expect(evaluate("pcg.acv < 15000", pcg)).toBe(true);
});

test("has() guards missing attrs", () => {
  expect(evaluate("has(pcg.acv) && pcg.acv < 15000", pcg)).toBe(true);
  expect(evaluate("has(pcg.budget)", pcg)).toBe(false);
});

test("graph predicates + macros", () => {
  expect(evaluate('pcg.has("ICP")', pcg)).toBe(true);
  expect(evaluate('!pcg.has("Positioning")', pcg)).toBe(true);
  expect(evaluate('pcg.count("Persona") == 1', pcg)).toBe(true);
  expect(evaluate('pcg.nodes("Claim").exists(c, !c.has_edge("supported_by"))', pcg)).toBe(true);
  expect(evaluate('pcg.nodes("Risk").exists(r, r.rating == "material" && !r.has_edge("mitigated_by"))', pcg)).toBe(true);
  expect(evaluate('pcg.nodes("ICP").all(i, i.has_edge("targets"))', pcg)).toBe(true);
});

test("missing attr throws Indeterminate (caller decides fail policy)", () => {
  expect(() => evaluate("pcg.budget > 5", pcg)).toThrow(IndeterminateError);
});

test("out-of-profile syntax throws CelError", () => {
  expect(() => parse("pcg.has('X') ++ 1")).toThrow(CelError);
});

test("referencedTypes extracts node types for validation", () => {
  const t = referencedTypes('pcg.has("ICP") && pcg.nodes("Risk").exists(r, true)');
  expect(t.sort()).toEqual(["ICP", "Risk"]);
});
