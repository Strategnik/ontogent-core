/**
 * Anthropic wrappers for the eval harness: a plain subject completion (the agent
 * under test) and a structured judge (LLM-as-rater) via forced tool use.
 */

import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  if (!cached) cached = new Anthropic();
  return cached;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** The agent under test. Plain completion, no special context unless the caller adds it. */
export async function subjectComplete(model: string, system: string, user: string): Promise<string> {
  const msg = await client().messages.create({
    model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export interface Verdict {
  baseline_satisfies: boolean;
  treatment_satisfies: boolean;
  note: string;
}

const JUDGE_SYSTEM =
  "You are a strict, skeptical evaluator of AI output quality for a specific professional domain. " +
  "You are given a task, a description of what a GOOD response does, a description of the BAD/naive pattern to avoid, " +
  "and two candidate outputs: A (baseline) and B (with domain context). " +
  "For each output, decide whether it SATISFIES the good criterion AND avoids the bad pattern. " +
  "Judge only what is present in the text. Default to NOT satisfied when uncertain. Do not reward confident-but-wrong output. " +
  "Then call record_verdict.";

const VERDICT_TOOL: Anthropic.Tool = {
  name: "record_verdict",
  description: "Record whether each candidate output satisfies the good criterion.",
  input_schema: {
    type: "object",
    properties: {
      baseline_satisfies: { type: "boolean", description: "Does output A (baseline) satisfy the good criterion?" },
      treatment_satisfies: { type: "boolean", description: "Does output B (with context) satisfy the good criterion?" },
      note: { type: "string", description: "One sentence explaining the key difference." },
    },
    required: ["baseline_satisfies", "treatment_satisfies", "note"],
  },
};

export interface JudgeInput {
  task: string;
  goodLooksLike: string;
  badLooksLike: string;
  baselineOutput: string;
  treatmentOutput: string;
}

export async function judgeVerdict(model: string, input: JudgeInput): Promise<Verdict> {
  const user =
    `TASK:\n${input.task}\n\n` +
    `GOOD response does this:\n${input.goodLooksLike}\n\n` +
    `BAD/naive pattern to avoid:\n${input.badLooksLike}\n\n` +
    `OUTPUT A (baseline):\n${input.baselineOutput}\n\n` +
    `OUTPUT B (with domain context):\n${input.treatmentOutput}`;

  const msg = await client().messages.create({
    model,
    max_tokens: 1024,
    system: [{ type: "text", text: JUDGE_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [VERDICT_TOOL],
    tool_choice: { type: "tool", name: "record_verdict" },
    messages: [{ role: "user", content: user }],
  });

  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("judge did not return a verdict");
  const v = block.input as Partial<Verdict>;
  if (typeof v.baseline_satisfies !== "boolean" || typeof v.treatment_satisfies !== "boolean") {
    throw new Error("judge verdict malformed");
  }
  return { baseline_satisfies: v.baseline_satisfies, treatment_satisfies: v.treatment_satisfies, note: v.note ?? "" };
}
