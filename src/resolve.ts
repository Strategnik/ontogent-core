/**
 * The Shield → Rank resolver (PRD §4.2). Domain-agnostic.
 *
 * Stage 1 (Shield): active hard/locked constraints — deny-overrides; ranking can
 *   never out-compete them.
 * Stage 2 (Rank): active soft/info constraints — ordered by a relevance score.
 *
 * The ranker here is intentionally simple (axis/keyword overlap + authority +
 * directive weight) — the OPEN baseline. The hosted product swaps in a
 * cross-encoder + RRF + MMR behind the same `rankStage` seam; that is the
 * commodity-but-operational layer, not the moat.
 */

import type {
  Pack, Archetype, Constraint, RelationshipConstraint, ProjectContextGraph,
  PcgNodeData, Authority, Severity, Directive,
} from "./types";
import { evaluate, IndeterminateError } from "./cel";

export interface SurfacedItem {
  id: string;
  kind: string;
  statement: string;
  severity: Severity;
  authority: Authority;
  indeterminate?: boolean;   // applies_when couldn't be determined (fail-active for hard)
  score?: number;            // Stage-2 relevance score
  detail?: string;           // e.g. which nodes breached a relationship constraint
  enforcementHint?: string;  // how the agent should apply the bumper
}

export interface Resolution {
  activeArchetypes: string[];
  shield: SurfacedItem[];    // Stage 1 — un-droppable
  ranked: SurfacedItem[];    // Stage 2 — ordered by relevance
  suppressed: string[];      // element ids removed by archetypes
  notes: string[];
}

const AUTHORITY_RANK: Record<Authority, number> = {
  regulatory: 5, expert: 4, canonical: 3, peer_aggregate: 2, inferred: 1,
};
const DIRECTIVE_WEIGHT: Record<Directive, number> = {
  must: 1.0, must_not: 1.0, should: 0.6, should_not: 0.6, consider: 0.3,
};

/** Benchmarks carry no severity — they always rank (Stage 2). */
function sevOf(c: Constraint): Severity {
  return "severity" in c ? c.severity : "soft";
}

function parseCardinality(card: string): { min: number; max: number } {
  const parts = (card ?? "").split("..");
  const min = Number(parts[0] ?? "0");
  const maxRaw = parts[1] ?? parts[0] ?? "*";
  return {
    min: Number.isFinite(min) ? min : 0,
    max: maxRaw === "*" ? Infinity : Number(maxRaw),
  };
}

/** Subject node ids that violate a relationship constraint's cardinality. Empty = satisfied. */
function breaches(rel: RelationshipConstraint, pcg: ProjectContextGraph, byId: Map<string, PcgNodeData>): string[] {
  const { min, max } = parseCardinality(rel.cardinality);
  const out: string[] = [];
  for (const n of pcg.nodes) {
    if (n.type !== rel.subject_type) continue;
    const count = (n.edges ?? []).filter(
      (e) => e.edge === rel.edge && byId.get(e.to)?.type === rel.object_type,
    ).length;
    if (count < min || count > max) out.push(n.id);
  }
  return out;
}

/** Which archetypes fire (any signal true). */
function activeArchetypes(pack: Pack, pcg: ProjectContextGraph): Archetype[] {
  return pack.archetypes.filter((a) =>
    (a.signals ?? []).some((sig) => {
      try { return evaluate(sig, pcg); } catch { return false; }
    }),
  );
}

/** Union of select/suppress tag sets from active archetypes. */
function tagSets(archetypes: Archetype[]): { selected: Set<string>; suppressed: Set<string> } {
  const selected = new Set<string>();
  const suppressed = new Set<string>();
  for (const a of archetypes) {
    for (const t of a.selects?.tags ?? []) selected.add(t);
    for (const t of a.suppresses?.tags ?? []) suppressed.add(t);
  }
  return { selected, suppressed };
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

/** OPEN baseline relevance: axis/keyword overlap with the task + authority + directive. */
function relevance(c: Constraint, taskTokens: Set<string>): number {
  const axisTokens = new Set<string>();
  for (const vals of Object.values(c.axes ?? {})) for (const v of vals) for (const t of tokens(v)) axisTokens.add(t);
  for (const t of tokens(c.statement)) axisTokens.add(t);
  let overlap = 0;
  for (const t of taskTokens) if (axisTokens.has(t)) overlap++;
  const authority = AUTHORITY_RANK[c.provenance.authority] / 5;
  const directive = c.kind === "rule" ? DIRECTIVE_WEIGHT[c.directive] : 0.6;
  return overlap * 1.0 + authority * 0.5 + directive * 0.25;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Maximal Marginal Relevance — order for relevance while penalizing redundancy,
 * so near-duplicate bumpers don't crowd the list (PRD §4.2). Operates on the
 * baseline scores; a hosted cross-encoder would replace `relevance()` upstream,
 * leaving this diversity pass intact.
 */
function applyMMR(items: SurfacedItem[], lambda = 0.75): SurfacedItem[] {
  if (items.length <= 1) return items;
  const maxScore = Math.max(...items.map((s) => s.score ?? 0), 1);
  const toks = new Map(items.map((s) => [s.id, tokens(s.statement)] as const));
  const remaining = [...items];
  const out: SurfacedItem[] = [];
  while (remaining.length) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i]!;
      const rel = (s.score ?? 0) / maxScore;
      let maxSim = 0;
      for (const chosen of out) maxSim = Math.max(maxSim, jaccard(toks.get(s.id)!, toks.get(chosen.id)!));
      const val = lambda * rel - (1 - lambda) * maxSim;
      if (val > bestVal) { bestVal = val; bestIdx = i; }
    }
    out.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return out;
}

function toItem(c: Constraint, extra: Partial<SurfacedItem> = {}): SurfacedItem {
  const hint = "enforcement_hint" in c ? c.enforcement_hint : undefined;
  return {
    id: c.id, kind: c.kind, statement: c.statement,
    severity: sevOf(c), authority: c.provenance.authority,
    ...(hint ? { enforcementHint: hint } : {}),
    ...extra,
  };
}

/** Deterministic precedence tiebreak (PRD §4.1). */
function precedence(a: SurfacedItem, b: SurfacedItem): number {
  const auth = AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority];
  if (auth !== 0) return auth;
  const sev = sevRank(b.severity) - sevRank(a.severity);
  if (sev !== 0) return sev;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // final id tiebreak
}
function sevRank(s: Severity): number { return s === "hard" ? 2 : s === "soft" ? 1 : 0; }

export function resolve(pack: Pack, pcg: ProjectContextGraph, task: string): Resolution {
  const arche = activeArchetypes(pack, pcg);
  const { suppressed: suppressedTags } = tagSets(arche);
  const notes: string[] = [];
  const suppressed: string[] = [];
  const shield: SurfacedItem[] = [];
  const ranked: SurfacedItem[] = [];
  const taskTokens = tokens(task);

  const suppressedByArchetype = (c: Constraint): boolean =>
    sevOf(c) !== "hard" && !c.locked && (c.tags ?? []).some((t) => suppressedTags.has(t));

  // Pass 1 — Rules + Benchmarks: activation via applies_when (spec §5.3 indeterminate policy).
  for (const c of [...pack.rules, ...pack.benchmarks] as Constraint[]) {
    const isHard = sevOf(c) === "hard";
    if (suppressedByArchetype(c)) { suppressed.push(c.id); continue; }
    let active = true;
    let indeterminate = false;
    if (c.applies_when) {
      try {
        active = evaluate(c.applies_when, pcg);
      } catch (e) {
        if (e instanceof IndeterminateError) {
          indeterminate = true;
          active = isHard;                 // fail-active for hard, fail-inactive for soft
          if (!isHard) { notes.push(`${c.id}: applies_when indeterminate → inactive (logged)`); continue; }
          notes.push(`${c.id}: applies_when indeterminate → surfaced (fail-active)`);
        } else throw e;
      }
    }
    if (!active) continue;
    if (isHard) shield.push(toItem(c, indeterminate ? { indeterminate: true } : {}));
    else ranked.push(toItem(c, { score: relevance(c, taskTokens) }));
  }

  // Pass 2 — Relationship constraints: surfaced only when the graph ACTUALLY breaches them.
  const byId = new Map(pcg.nodes.map((n) => [n.id, n] as const));
  for (const rel of pack.relationships) {
    const isHard = rel.severity === "hard";
    if (suppressedByArchetype(rel)) { suppressed.push(rel.id); continue; }
    if (rel.applies_when) {
      try { if (!evaluate(rel.applies_when, pcg)) continue; }
      catch (e) { if (e instanceof IndeterminateError) { if (!isHard) continue; } else throw e; }
    }
    const breached = breaches(rel, pcg, byId);
    if (breached.length === 0) continue; // satisfied or vacuous → not a conflict, not surfaced
    const item = toItem(rel, { detail: `breached by: ${breached.join(", ")}` });
    if (isHard) shield.push(item);
    else { item.score = relevance(rel, taskTokens); ranked.push(item); }
  }

  shield.sort(precedence);
  ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || precedence(a, b));

  return { activeArchetypes: arche.map((a) => a.id), shield, ranked: applyMMR(ranked), suppressed, notes };
}
