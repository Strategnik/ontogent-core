# Ontogent Context Core

[![CI](https://github.com/Strategnik/ontogent-core/actions/workflows/ci.yml/badge.svg)](https://github.com/Strategnik/ontogent-core/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)
[![MCP](https://img.shields.io/badge/MCP-ready-1de2c4.svg)](#mcp-server-the-install-surface)

**Open infrastructure for giving an AI agent domain-correct context.** This repo is the *engine*. It has **zero domain knowledge** — every rule, benchmark, and relationship lives in a **pack**. Delete the packs and the engine still runs; it just has nothing to apply. That separation is the whole point.

> Bumper bowling for agents: the engine doesn't write or decide the output — it removes the gutters. The packs are the bumpers.

## The architecture, in one line

```
   ┌──────────────────────────── SOFT LAYER (packs — the value) ────────────────────────────┐
   │   ontogent/gtm     ontogent/governance     ontogent/<your-domain>                        │
   │   rules · relationships · benchmarks · archetypes · playbooks   (YAML content)           │
   └───────────────────────────────────────────────────────────────────────────────────────┘
                                          ▼  snaps onto
   ┌──────────────────────────── INFRASTRUCTURE (this repo — MIT) ───────────────────────────┐
   │   loader → validator → CEL condition evaluator → Shield→Rank resolver → (MCP) delivery   │
   │   domain-agnostic. knows the *format* of a pack, nothing about any *domain*.              │
   └───────────────────────────────────────────────────────────────────────────────────────┘
```

- **This repo (open, MIT):** the format, the loader, the validator, the constrained-CEL evaluator, and the Shield→Rank resolver. Plus a tiny `packs/reference` example so it runs out of the box.
- **Packs (the upgrade):** the actual domain expertise — authored against the open [pack spec](#pack-format). The good ones are premium; anyone can author their own against the spec.

This is the line you can put on a public GitHub page today: **the plumbing is open; the brain is the content.**

## What is and isn't a moat (so the open-source decision is deliberate)
Open here: the connector, the format, the validator, the condition evaluator, and a **baseline** ranker. None of these are the moat — they're commodity infrastructure, and giving them away is the distribution play. The durable value lives in the **packs** (expert-authored, authority-weighted domain content) and the accumulating context graph. The baseline ranker in `resolve.ts` is deliberately simple; the hosted product swaps a cross-encoder + RRF + MMR in behind the same seam.

## Quick start
```bash
bun install

# Validate the bundled example pack
bun run validate packs/reference

# Resolve context for a task against a PCG fixture
bun run resolve packs/reference --pcg packs/reference/fixtures/example.yaml --task "review this document"

# Point it at ANY pack — nothing domain-specific is compiled in:
bun run validate /path/to/ontogent-gtm
bun run resolve  /path/to/ontogent-gtm --pcg /path/to/fixtures/demo-quanta.yaml \
  --task "write a hero headline and recommend the first paid channel"
```

## Developer proof

- [Architecture notes](docs/architecture.md) document the open-core boundary and Shield -> Rank design.
- [Build your first pack](docs/build-your-first-pack.md) walks through authoring a minimal pack.
- [Sample resolver output](examples/resolve-output.txt) is committed so you can inspect the output shape before running anything.
- CI validates the reference pack, runs the resolver, tests, and typechecks.

## Two-stage resolution (Shield → Rank)
1. **Shield (Stage 1)** — active `hard`/`locked` constraints. Deterministic logic (deny-overrides); a relevance score can never out-compete them. This is the gutter guard.
2. **Rank (Stage 2)** — active `soft`/`info` constraints, ordered by relevance. Droppable below the delivery cutoff.

Severity decides the *stage*; `directive` (must/should/…) decides deontic strength *within* a stage. A `soft`+`must` rule is a strong instruction that is still ranked, not shielded. Indeterminate conditions fail **active** for `hard` (never silently lose a guardrail) and **inactive-but-logged** for `soft`.

## MCP server (the install surface)
The same engine is exposed over MCP (stdio) so a builder can wire it into their agent:

```bash
bun run mcp        # starts the stdio server
```

Tools: `resolve_context({ packDir, pcgPath, task })` → hard constraints + ranked context; `validate_pack({ packDir })`. Example Claude Desktop / Cursor config:

```json
{
  "mcpServers": {
    "ontogent": { "command": "bun", "args": ["run", "/path/to/ontogent-core/src/mcp.ts"] }
  }
}
```

## Eval harness (measured lift)
The thing that proves a pack *works*, not just that it's well-formed. Two layers:
- **Structural** (free, no API): does the resolver activate/surface the bumpers each eval case expects?
- **Measured lift** (needs `ANTHROPIC_API_KEY`): run each task through a subject model with and without the pack's context, then a judge model rates each. A case "lifts" when the with-pack output satisfies the domain criterion and the baseline didn't.

```bash
bun run src/cli.ts eval <packDir> --dry                 # structural only, no API
bun run src/cli.ts eval <packDir>                        # measured lift (subject=sonnet-4-6, judge=opus-4-8)
bun run src/cli.ts eval <packDir> --subject claude-haiku-4-5 --judge claude-sonnet-4-6 --limit 3
```

Outcomes per case: `lift` (pack helped), `model-already-covers` (baseline already correct — the pack adds little here), `no-help`, `regression`. **Lift is subject-model-dependent**: a weaker/cheaper consuming model benefits more; a frontier model already covers more cases. That distribution is the real signal — it tells you where a pack earns its place and where the model already knows.

## Pack format
A pack is a directory: `pack.yaml` + `rules.yaml` / `relationships.yaml` / `benchmarks.yaml` / `archetypes.yaml` / `playbooks.yaml` (multi-document YAML). See `packs/reference/` for a minimal example and the full spec for field definitions and the CEL condition profile.

Relationship constraints are surfaced **only when the graph actually breaches them** (cardinality check), reported with the offending node ids. Rules surface via their `applies_when` condition (or unconditionally, as standing instructions).

## Status
v0.1 (feature-complete open core). Loader · validator · constrained-CEL evaluator · breach-aware **Shield→Rank** resolver with **MMR** diversity · agent-facing renderer (PCG facts + enforcement hints) · CLI · **MCP server** · **measured-lift eval harness** · unit tests (`bun test`). Typecheck clean.

**Closed/hosted, not in this repo:** the cross-encoder ranker (baseline here is keyword-overlap + MMR, behind a clean seam), persistence, and auth — those belong to the hosted tier, not the open engine. Full-CEL via a vetted library can swap in behind `cel.ts`'s `evaluate()`.

## License
MIT (this repo). Packs are licensed individually.
