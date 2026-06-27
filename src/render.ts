/**
 * Canonical agent-facing rendering of a resolution.
 *
 * Critical: the context an agent receives is the project's FACTS (the PCG) plus
 * the pack's ranked bumpers — not the bumpers alone. Surfacing only the rules
 * (the original gap the eval harness caught) leaves the agent unable to act on
 * the instance, e.g. it can't flag "this ICP has no persona" if it never sees
 * the ICP. Both MCP and the eval harness render through here so they agree.
 */

import type { Resolution } from "./resolve";
import type { ProjectContextGraph, PcgNodeData } from "./types";

function factLine(n: PcgNodeData): string {
  const p = n.props ?? {};
  const label = p["label"] ?? p["text"] ?? p["name"] ?? "";
  return `- ${n.type}${label ? `: ${String(label)}` : ""} (${n.id})`;
}

export function renderForAgent(r: Resolution, pcg: ProjectContextGraph, maxRanked = 12): string {
  const lines: string[] = [];

  const attrKeys = Object.keys(pcg.attrs);
  if (attrKeys.length || pcg.nodes.length) {
    lines.push("Project facts (this specific case):");
    for (const k of attrKeys) lines.push(`- ${k}: ${String(pcg.attrs[k])}`);
    for (const n of pcg.nodes) lines.push(factLine(n));
    lines.push("");
  }

  lines.push("Hard constraints — these MUST hold; do not produce output that violates them:");
  if (!r.shield.length) lines.push("- (none)");
  for (const s of r.shield) {
    lines.push(`- ${s.statement}${s.detail ? ` (${s.detail})` : ""}`);
    if (s.enforcementHint) lines.push(`    how to apply: ${s.enforcementHint}`);
  }
  lines.push("");

  lines.push("Relevant guidance (ranked):");
  if (!r.ranked.length) lines.push("- (none)");
  for (const s of r.ranked.slice(0, maxRanked)) {
    lines.push(`- ${s.statement}`);
    if (s.enforcementHint) lines.push(`    how to apply: ${s.enforcementHint}`);
  }

  if (r.activeArchetypes.length) lines.push(`\n(context narrowed for: ${r.activeArchetypes.join(", ")})`);
  return lines.join("\n");
}
