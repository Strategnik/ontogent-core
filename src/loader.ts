/** Pack + PCG loaders. Reads the on-disk YAML format into typed objects. */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import type {
  Pack, PackManifest, Rule, RelationshipConstraint, Benchmark,
  Archetype, Playbook, ProjectContextGraph,
} from "./types";

function loadDocs<T>(dir: string, file: string): T[] {
  const path = join(dir, file);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  return parseAllDocuments(raw)
    .map((d) => d.toJSON())
    .filter((d): d is T => d !== null && d !== undefined);
}

/** Load a pack directory (manifest + element files) into a typed Pack. */
export function loadPack(dir: string): Pack {
  const manifestPath = join(dir, "pack.yaml");
  if (!existsSync(manifestPath)) throw new Error(`no pack.yaml in ${dir}`);
  const manifest = parseAllDocuments(readFileSync(manifestPath, "utf8"))[0]!.toJSON() as PackManifest;
  return {
    manifest,
    rules: loadDocs<Rule>(dir, "rules.yaml"),
    relationships: loadDocs<RelationshipConstraint>(dir, "relationships.yaml"),
    benchmarks: loadDocs<Benchmark>(dir, "benchmarks.yaml"),
    archetypes: loadDocs<Archetype>(dir, "archetypes.yaml"),
    playbooks: loadDocs<Playbook>(dir, "playbooks.yaml"),
  };
}

export function loadPcg(path: string): ProjectContextGraph {
  const doc = parseAllDocuments(readFileSync(path, "utf8"))[0]!.toJSON() as Partial<ProjectContextGraph>;
  return { attrs: doc.attrs ?? {}, nodes: doc.nodes ?? [] };
}
