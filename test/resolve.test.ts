import { test, expect } from "bun:test";
import { resolve } from "../src/resolve";
import type { Pack, ProjectContextGraph } from "../src/types";

function pack(over: Partial<Pack> = {}): Pack {
  return {
    manifest: { id: "t/x", version: "0.0.1", domain: "t", authority: { authority: "canonical" }, license: "open" },
    rules: [], relationships: [], benchmarks: [], archetypes: [], playbooks: [],
    ...over,
  };
}

test("hard rule with applies_when goes to Shield only when active", () => {
  const p = pack({
    rules: [{
      id: "r1", kind: "rule", statement: "no claim without proof", severity: "hard", directive: "must_not",
      rationale: "x", axes: { t: ["a"] }, applies_when: 'pcg.has("Claim")',
      provenance: { authority: "expert" },
    }],
  });
  const withClaim: ProjectContextGraph = { attrs: {}, nodes: [{ id: "c", type: "Claim" }] };
  const without: ProjectContextGraph = { attrs: {}, nodes: [] };
  expect(resolve(p, withClaim, "t").shield.map((s) => s.id)).toEqual(["r1"]);
  expect(resolve(p, without, "t").shield.length).toBe(0);
});

test("relationship surfaces only on cardinality breach, with offending node", () => {
  const p = pack({
    relationships: [{
      id: "rel1", kind: "relationship", statement: "ICP needs persona",
      subject_type: "ICP", edge: "targets", object_type: "Persona", cardinality: "1..*",
      severity: "hard", axes: { t: ["a"] }, provenance: { authority: "canonical" },
    }],
  });
  const breached: ProjectContextGraph = { attrs: {}, nodes: [{ id: "icp-1", type: "ICP", edges: [] }] };
  const ok: ProjectContextGraph = { attrs: {}, nodes: [
    { id: "icp-1", type: "ICP", edges: [{ edge: "targets", to: "p" }] }, { id: "p", type: "Persona" },
  ] };
  const vacuous: ProjectContextGraph = { attrs: {}, nodes: [] };
  expect(resolve(p, breached, "t").shield[0]?.detail).toContain("icp-1");
  expect(resolve(p, ok, "t").shield.length).toBe(0);
  expect(resolve(p, vacuous, "t").shield.length).toBe(0); // no subject → not a conflict
});

test("archetype suppresses soft tags but never hard/locked", () => {
  const p = pack({
    rules: [
      { id: "soft1", kind: "rule", statement: "s", severity: "soft", directive: "should", rationale: "x", axes: { t: ["a"] }, tags: ["outbound"], provenance: { authority: "expert" } },
      { id: "hard1", kind: "rule", statement: "h", severity: "hard", directive: "must", rationale: "x", axes: { t: ["a"] }, tags: ["outbound"], locked: true, provenance: { authority: "regulatory", source: "law" } },
    ],
    archetypes: [{ id: "a1", kind: "archetype", statement: "plg", selects: { tags: [] }, suppresses: { tags: ["outbound"] }, signals: ['pcg.motion == "PLG"'], axes: { t: ["a"] }, provenance: { authority: "canonical" } }],
  });
  const g: ProjectContextGraph = { attrs: { motion: "PLG" }, nodes: [] };
  const r = resolve(p, g, "t");
  expect(r.activeArchetypes).toEqual(["a1"]);
  expect(r.suppressed).toContain("soft1");
  expect(r.shield.map((s) => s.id)).toContain("hard1"); // locked is exempt
});
