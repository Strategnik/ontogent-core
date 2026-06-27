/**
 * Pack format types — the open contract between the engine and any pack.
 *
 * The engine in this repo has ZERO domain knowledge. Everything domain-specific
 * (GTM rules, governance bumpers, benchmarks) lives in pack content authored
 * against these types. Delete the packs and the engine still runs.
 */

export type Authority =
  | "regulatory"
  | "expert"
  | "canonical"
  | "peer_aggregate"
  | "inferred";

export type Severity = "hard" | "soft" | "info";

export type Directive =
  | "must"
  | "should"
  | "must_not"
  | "should_not"
  | "consider";

export type ElementKind =
  | "rule"
  | "relationship"
  | "benchmark"
  | "archetype"
  | "playbook";

export interface Provenance {
  authority: Authority;
  source?: string;
  author?: string;
  confidence?: number;
  effective_from?: string;
  effective_to?: string | null;
}

/** Retrieval axes — opaque to the engine, used only for ranking overlap. */
export type Axes = Record<string, string[]>;

interface ElementBase {
  id: string;
  kind: ElementKind;
  statement: string;
  axes: Axes;
  /** CEL boolean over the PCG accessor surface. Absent = always active. */
  applies_when?: string;
  provenance: Provenance;
  /** Cannot be loosened/suppressed by a child pack or an archetype. */
  locked?: boolean;
  tags?: string[];
}

export interface Rule extends ElementBase {
  kind: "rule";
  severity: Severity;
  directive: Directive;
  rationale: string;
  enforcement_hint?: string;
}

export interface RelationshipConstraint extends ElementBase {
  kind: "relationship";
  subject_type: string;
  edge: string;
  object_type: string;
  cardinality: string;
  severity: Severity;
  rationale?: string;
  enforcement_hint?: string;
}

export interface Benchmark extends ElementBase {
  kind: "benchmark";
  metric: string;
  target: unknown;
  direction: "higher_better" | "lower_better" | "in_range";
  basis: "canonical" | "regulatory" | "peer_aggregate";
  rationale?: string;
}

export interface TagQuery {
  tags?: string[];
  ids?: string[];
}

export interface Archetype extends ElementBase {
  kind: "archetype";
  selects: TagQuery;
  suppresses?: TagQuery;
  /** CEL conditions; any true suggests this archetype applies. */
  signals?: string[];
}

export interface PlaybookStep {
  step: string;
  requires?: string[];
}

export interface Playbook extends ElementBase {
  kind: "playbook";
  steps: PlaybookStep[];
  produces?: string[];
}

export type PackElement =
  | Rule
  | RelationshipConstraint
  | Benchmark
  | Archetype
  | Playbook;

/** Constrainable elements — those the resolver activates and surfaces. */
export type Constraint = Rule | RelationshipConstraint | Benchmark;

export interface PackManifest {
  id: string;
  version: string;
  domain: string;
  description?: string;
  authority: Provenance;
  license: "open" | "premium" | "private";
  extends?: string[];
  archetypes?: string[];
  effective_from?: string;
  effective_to?: string | null;
  min_pcg?: string[];
}

export interface Pack {
  manifest: PackManifest;
  rules: Rule[];
  relationships: RelationshipConstraint[];
  benchmarks: Benchmark[];
  archetypes: Archetype[];
  playbooks: Playbook[];
}

/* ── Project Context Graph (the instance plane) ── */

export interface PcgNodeData {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  edges?: { edge: string; to: string }[];
}

export interface ProjectContextGraph {
  attrs: Record<string, unknown>;
  nodes: PcgNodeData[];
}
