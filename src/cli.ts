#!/usr/bin/env bun
/**
 * ontogent — CLI for the open context-core engine.
 *
 *   ontogent validate <packDir>
 *   ontogent resolve  <packDir> --pcg <fixture.yaml> --task "..."
 *   ontogent selftest <packDir>            (parse every applies_when / signal)
 *
 * The engine is domain-agnostic: point it at ANY pack. GTM and governance packs
 * are just content; nothing about them is compiled in here.
 */

import { loadPack, loadPcg } from "./loader";
import { validate } from "./validator";
import { resolve } from "./resolve";
import { parse } from "./cel";
import { runEval } from "./eval/harness";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2];
const packDir = process.argv[3];

function die(msg: string): never { console.error(msg); process.exit(1); }

if (!cmd || !packDir) die("usage: ontogent <validate|resolve|selftest> <packDir> [--pcg f] [--task t]");

const pack = loadPack(packDir);

if (cmd === "validate") {
  const issues = validate(pack);
  const errors = issues.filter((i) => i.level === "error");
  for (const i of issues) console.log(`${i.level === "error" ? "✗" : "⚠"} [${i.id}] ${i.msg}`);
  console.log(`\n${pack.manifest.id}@${pack.manifest.version} — ${errors.length} error(s), ${issues.length - errors.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}

if (cmd === "selftest") {
  let n = 0, bad = 0;
  const check = (id: string, expr: string) => {
    n++;
    try { parse(expr); } catch (e) { bad++; console.log(`✗ [${id}] ${(e as Error).message}`); }
  };
  for (const r of pack.rules) if (r.applies_when) check(r.id, r.applies_when);
  for (const rel of pack.relationships) if (rel.applies_when) check(rel.id, rel.applies_when);
  for (const a of pack.archetypes) for (const s of a.signals ?? []) check(a.id, s);
  console.log(`parsed ${n} expression(s), ${bad} failed`);
  process.exit(bad ? 1 : 0);
}

if (cmd === "eval") {
  const report = await runEval(packDir, {
    evalsPath: arg("--evals"),
    subjectModel: arg("--subject") ?? "claude-sonnet-4-6",
    judgeModel: arg("--judge") ?? "claude-opus-4-8",
    limit: arg("--limit") ? Number(arg("--limit")) : undefined,
    dry: process.argv.includes("--dry"),
  });

  console.log(`\n# eval ${report.pack} — ${report.measured ? "measured-lift" : "structural-only (no API / --dry)"}`);
  for (const c of report.cases) {
    const s = c.structuralPass ? "✓" : "✗";
    const m = report.measured && c.outcome !== "structural_only"
      ? `  lift:${c.outcome}  (baseline ${c.baselineOk ? "ok" : "miss"} → with-pack ${c.treatmentOk ? "ok" : "miss"})`
      : "";
    console.log(`${s} structural [${c.id}]${m}`);
    if (c.structuralFailures.length) for (const f of c.structuralFailures) console.log(`    - ${f}`);
    if (c.note) console.log(`    note: ${c.note}`);
  }
  const t = report.totals;
  console.log(`\nstructural: ${t.structuralPass}/${t.total} pass`);
  if (report.measured) {
    console.log(`measured lift: ${t.lift} lifted · ${t.both_ok} model-already-covers · ${t.neither} no-help · ${t.regression} regression`);
  } else {
    console.log("measured lift: skipped (set ANTHROPIC_API_KEY and drop --dry to run)");
  }
  process.exit(t.structuralPass === t.total ? 0 : 1);
}

if (cmd === "resolve") {
  const pcgPath = arg("--pcg") ?? die("resolve needs --pcg <fixture.yaml>");
  const task = arg("--task") ?? "";
  const pcg = loadPcg(pcgPath);
  const r = resolve(pack, pcg, task);

  console.log(`\n# ${pack.manifest.id}@${pack.manifest.version}  ·  task: ${task || "(none)"}`);
  console.log(`# active archetype(s): ${r.activeArchetypes.join(", ") || "none"}`);

  console.log(`\n## Stage 1 — Shield (hard/locked; ranking cannot override)`);
  if (!r.shield.length) console.log("  (none active)");
  for (const s of r.shield)
    console.log(`  ⛔ ${s.statement}\n       ${s.id} · ${s.severity}/${s.authority}${s.detail ? " · " + s.detail : ""}${s.indeterminate ? " · ⚠ indeterminate→fail-active" : ""}`);

  console.log(`\n## Stage 2 — Rank (soft/info, by relevance)`);
  if (!r.ranked.length) console.log("  (none active)");
  for (const s of r.ranked)
    console.log(`  • ${s.statement}\n       ${s.id} · ${s.severity}/${s.authority} · score ${s.score?.toFixed(2)}`);

  if (r.suppressed.length) console.log(`\n## Suppressed by archetype: ${r.suppressed.join(", ")}`);
  if (r.notes.length) { console.log(`\n## Notes`); for (const n of r.notes) console.log(`  - ${n}`); }
  console.log();
}
