/**
 * Open pack validator — spec §10 well-formedness checks.
 *
 * Validation proves a pack is well-formed; it does NOT prove the bumpers are
 * placed correctly (that's the eval harness). Passing here is necessary, not
 * sufficient.
 */

import type { Pack, PackElement, Rule, RelationshipConstraint } from "./types";
import { parse, referencedTypes, CelError } from "./cel";

export interface Issue { level: "error" | "warn"; id: string; msg: string; }

const AUTHORITIES = new Set(["regulatory", "expert", "canonical", "peer_aggregate", "inferred"]);
const SEVERITIES = new Set(["hard", "soft", "info"]);

function allElements(pack: Pack): PackElement[] {
  return [...pack.rules, ...pack.relationships, ...pack.benchmarks, ...pack.archetypes, ...pack.playbooks];
}

export function validate(pack: Pack, opts: { typeRegistry?: Set<string> } = {}): Issue[] {
  const issues: Issue[] = [];
  const err = (id: string, msg: string) => issues.push({ level: "error", id, msg });
  const warn = (id: string, msg: string) => issues.push({ level: "warn", id, msg });

  const m = pack.manifest;
  if (!m?.id) err("manifest", "missing id");
  if (!m?.version || !/^\d+\.\d+\.\d+/.test(m.version)) err("manifest", "version must be semver");
  if (!m?.license) err("manifest", "missing license");

  const els = allElements(pack);
  const ids = new Set<string>();
  const tags = new Set<string>();
  for (const e of els) for (const t of e.tags ?? []) tags.add(t);

  for (const e of els) {
    if (!e.id) { err("?", "element missing id"); continue; }
    if (ids.has(e.id)) err(e.id, "duplicate id");
    ids.add(e.id);
    if (!e.statement) err(e.id, "missing statement (must be embeddable)");
    if (!e.axes || Object.keys(e.axes).length === 0) err(e.id, "missing axes (≥1 required)");
    if (!e.provenance) err(e.id, "missing provenance");
    else {
      if (!AUTHORITIES.has(e.provenance.authority)) err(e.id, `bad authority '${e.provenance.authority}'`);
      if (e.provenance.authority === "regulatory" && !e.provenance.source) err(e.id, "regulatory authority requires a source");
    }
    // applies_when must parse and stay in profile; referenced types must exist (if registry given).
    if (e.applies_when) {
      try {
        parse(e.applies_when);
        if (opts.typeRegistry) {
          for (const t of referencedTypes(e.applies_when))
            if (!opts.typeRegistry.has(t)) err(e.id, `applies_when references unknown node type '${t}'`);
        }
      } catch (x) {
        err(e.id, `applies_when ${x instanceof CelError ? "out of profile" : "parse error"}: ${(x as Error).message}`);
      }
    }
  }

  // Severity / locked invariants on constraints.
  for (const c of [...pack.rules, ...pack.relationships] as (Rule | RelationshipConstraint)[]) {
    if (!SEVERITIES.has(c.severity)) err(c.id, `bad severity '${c.severity}'`);
    if (c.locked && c.severity !== "hard") err(c.id, "locked elements must be hard");
    if (c.kind === "rule" && !c.rationale) err(c.id, "rule missing rationale");
  }

  // Archetype select/suppress must resolve to real tags or ids.
  for (const a of pack.archetypes) {
    for (const grp of ["selects", "suppresses"] as const) {
      const q = a[grp];
      if (!q) continue;
      for (const t of q.tags ?? []) if (!tags.has(t)) err(a.id, `${grp} tag '${t}' matches no element`);
      for (const refId of q.ids ?? []) if (!ids.has(refId)) err(a.id, `${grp} id '${refId}' matches no element`);
    }
    for (const sig of a.signals ?? []) {
      try { parse(sig); } catch (x) { err(a.id, `signal out of profile: ${(x as Error).message}`); }
    }
  }

  // Playbook requires must resolve.
  for (const pb of pack.playbooks)
    for (const s of pb.steps ?? [])
      for (const r of s.requires ?? [])
        if (!ids.has(r)) err(pb.id, `requires unknown element '${r}'`);

  // Premium packs must carry eval coverage (checked against an evals file at the CLI layer).
  if (m?.license === "premium") {
    const hard = [...pack.rules, ...pack.relationships].filter((c) => c.severity === "hard");
    if (hard.length > 0) warn(m.id, `premium pack: ensure eval coverage for ${hard.length} hard element(s) (spec §9)`);
  }

  return issues;
}
