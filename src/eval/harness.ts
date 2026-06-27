/**
 * Measured-lift eval harness.
 *
 * Two layers per eval case:
 *   1. Structural (free, no API) — does the resolver activate/surface the bumpers
 *      the case expects? This is what the open validator already proves.
 *   2. Measured lift (needs API) — run the task through the subject model WITHOUT
 *      the pack and WITH the pack's resolved context, then have a judge model rate
 *      each. The pack "lifts" a case when the with-context output satisfies the
 *      domain criterion AND the baseline did not.
 *
 * This is the only thing that turns "the demo looks good" into "the pack
 * measurably changes output" — the assumption the PRD flags as unproven.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import { loadPack, loadPcg } from "../loader";
import { resolve, type Resolution } from "../resolve";
import { renderForAgent } from "../render";
import { hasApiKey, subjectComplete, judgeVerdict } from "./llm";

export interface EvalExpects {
  active_bumpers_include?: string[];
  suppressed_bumpers_include?: string[];
  active_archetype?: string;
  constraint_surfaced?: boolean;
}

export interface EvalCase {
  id: string;
  covers?: string[];
  task: string;
  pcg_fixture: string;
  expects?: EvalExpects;
  without_pack_baseline?: string;
  with_pack_expected?: string;
}

export type Outcome = "lift" | "both_ok" | "neither" | "regression" | "structural_only";

export interface CaseResult {
  id: string;
  structuralPass: boolean;
  structuralFailures: string[];
  outcome: Outcome;
  baselineOk?: boolean;
  treatmentOk?: boolean;
  note?: string;
}

export interface EvalReport {
  pack: string;
  measured: boolean;
  cases: CaseResult[];
  totals: Record<Outcome, number> & { structuralPass: number; total: number };
}

export interface EvalOptions {
  evalsPath?: string | undefined;
  subjectModel: string;
  judgeModel: string;
  limit?: number | undefined;
  dry: boolean;
}

export function loadEvals(packDir: string, evalsPath?: string): EvalCase[] {
  const path = evalsPath ?? join(packDir, "evals.yaml");
  if (!existsSync(path)) return [];
  return parseAllDocuments(readFileSync(path, "utf8"))
    .map((d) => d.toJSON())
    .filter((d): d is EvalCase => d !== null && d !== undefined && typeof d.id === "string");
}

/** Structural assertions against a resolution — no API needed. */
function checkStructural(ec: EvalCase, r: Resolution): string[] {
  const active = new Set([...r.shield, ...r.ranked].map((s) => s.id));
  const failures: string[] = [];
  const e = ec.expects ?? {};
  for (const id of e.active_bumpers_include ?? []) if (!active.has(id)) failures.push(`expected active bumper ${id}`);
  for (const id of e.suppressed_bumpers_include ?? []) if (!r.suppressed.includes(id)) failures.push(`expected ${id} suppressed`);
  if (e.active_archetype && !r.activeArchetypes.includes(e.active_archetype)) failures.push(`expected archetype ${e.active_archetype}`);
  if (e.constraint_surfaced) {
    // Surfaced = appears in EITHER stage (Shield or Ranked) — GTM bumpers are mostly soft.
    const expected = new Set([...(e.active_bumpers_include ?? []), ...(ec.covers ?? [])]);
    const surfaced = expected.size > 0
      ? [...r.shield, ...r.ranked].some((s) => expected.has(s.id))
      : r.shield.length + r.ranked.length > 0;
    if (!surfaced) failures.push("expected at least one covered constraint surfaced");
  }
  return failures;
}

const SUBJECT_SYSTEM = "You are an assistant helping a B2B team with professional work. Answer the task directly and concisely.";

export async function runEval(packDir: string, opts: EvalOptions): Promise<EvalReport> {
  const pack = loadPack(packDir);
  let cases = loadEvals(packDir, opts.evalsPath);
  if (opts.limit !== undefined) cases = cases.slice(0, opts.limit);

  const measured = !opts.dry && hasApiKey();
  const results: CaseResult[] = [];

  for (const ec of cases) {
    const pcg = loadPcg(join(packDir, ec.pcg_fixture));
    const r = resolve(pack, pcg, ec.task);
    const failures = checkStructural(ec, r);
    const base: CaseResult = { id: ec.id, structuralPass: failures.length === 0, structuralFailures: failures, outcome: "structural_only" };

    if (!measured || !ec.with_pack_expected) {
      results.push(base);
      continue;
    }

    const context = renderForAgent(r, pcg);
    const baselineOutput = await subjectComplete(opts.subjectModel, SUBJECT_SYSTEM, ec.task);
    const treatmentOutput = await subjectComplete(opts.subjectModel, SUBJECT_SYSTEM, `${ec.task}\n\n${context}`);
    const v = await judgeVerdict(opts.judgeModel, {
      task: ec.task,
      goodLooksLike: ec.with_pack_expected,
      badLooksLike: ec.without_pack_baseline ?? "generic, unconstrained output",
      baselineOutput,
      treatmentOutput,
    });

    const outcome: Outcome =
      v.treatment_satisfies && !v.baseline_satisfies ? "lift"
      : v.treatment_satisfies && v.baseline_satisfies ? "both_ok"
      : !v.treatment_satisfies && v.baseline_satisfies ? "regression"
      : "neither";

    results.push({ ...base, outcome, baselineOk: v.baseline_satisfies, treatmentOk: v.treatment_satisfies, note: v.note });
  }

  const totals = { lift: 0, both_ok: 0, neither: 0, regression: 0, structural_only: 0, structuralPass: 0, total: results.length } as EvalReport["totals"];
  for (const r of results) {
    totals[r.outcome]++;
    if (r.structuralPass) totals.structuralPass++;
  }

  return { pack: pack.manifest.id, measured, cases: results, totals };
}
