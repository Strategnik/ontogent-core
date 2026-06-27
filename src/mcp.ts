#!/usr/bin/env bun
/**
 * Ontogent context MCP server (stdio).
 *
 * The delivery surface: this is what a builder installs into their agent
 * (Claude Desktop, Cursor, Windsurf, …). It wraps the same domain-agnostic
 * engine the CLI uses — `resolve()` — and exposes it as MCP tools. No domain
 * knowledge here either; the pack supplies all of it.
 *
 * Tools:
 *   resolve_context — given a pack, a project context graph, and a task,
 *                     return the Shield (hard constraints) + ranked context.
 *   validate_pack   — well-formedness check (spec §10).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadPack, loadPcg } from "./loader";
import { resolve } from "./resolve";
import { renderForAgent } from "./render";
import { validate } from "./validator";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

const server = new McpServer({ name: "ontogent-context", version: "0.1.0" });

server.registerTool(
  "resolve_context",
  {
    title: "Resolve domain context",
    description:
      "Return domain-correct context for a task: the hard constraints that must hold (Shield) plus the most relevant guidance (ranked). Constrains an agent's output to a domain's standards without writing the output.",
    inputSchema: {
      packDir: z.string().describe("Path to a Canonical Pack directory."),
      pcgPath: z.string().describe("Path to a project context graph (PCG) YAML file."),
      task: z.string().describe("The task the consuming agent is about to perform."),
    },
  },
  async ({ packDir, pcgPath, task }) => {
    try {
      const pcg = loadPcg(pcgPath);
      const r = resolve(loadPack(packDir), pcg, task);
      return { content: [{ type: "text", text: renderForAgent(r, pcg) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `resolve_context failed: ${getErrorMessage(error)}` }], isError: true };
    }
  },
);

server.registerTool(
  "validate_pack",
  {
    title: "Validate a pack",
    description: "Check a Canonical Pack for well-formedness (spec §10). Returns errors and warnings.",
    inputSchema: { packDir: z.string().describe("Path to a Canonical Pack directory.") },
  },
  async ({ packDir }) => {
    try {
      const issues = validate(loadPack(packDir));
      const text = issues.length
        ? issues.map((i) => `${i.level === "error" ? "ERROR" : "warn"} [${i.id}] ${i.msg}`).join("\n")
        : "valid: no issues";
      return { content: [{ type: "text", text }], isError: issues.some((i) => i.level === "error") };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `validate_pack failed: ${getErrorMessage(error)}` }], isError: true };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
