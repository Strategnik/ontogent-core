// Embedding-agnostic: bring your own vectors from any provider; the engine does no embedding and no DB.

import type { Axes } from "./types";
import { authorityStrength as defaultAuthorityStrength } from "./authority";

export type Vector = number[];
export type SimilarityFn = (a: Vector, b: Vector) => number;

export function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! ** 2;
    normB += b[i]! ** 2;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

export interface RetrievableItem {
  id: string;
  vector?: Vector;
  axes?: Axes;
  authority?: string;
  updatedAt?: string;
  payload?: unknown;
}

export interface AxisQuery {
  vector?: Vector;
  axes?: Axes;
}

export function axisOverlap(itemAxes: Axes | undefined, queryAxes: Axes | undefined): number {
  const pairs = (axes: Axes | undefined) =>
    new Set(Object.entries(axes ?? {}).flatMap(([axis, values]) => values.map((value) => `${axis}\0${value}`)));
  const item = pairs(itemAxes);
  const query = pairs(queryAxes);
  if (!item.size || !query.size) return 0;
  let intersection = 0;
  for (const pair of item) if (query.has(pair)) intersection++;
  return intersection / (item.size + query.size - intersection);
}

export function mmrRerank(
  items: RetrievableItem[],
  opts: { lambda: number; similarity: SimilarityFn; topK: number },
): RetrievableItem[] {
  const remaining = items.map((item, index) => ({ item, relevance: 1 - index / Math.max(1, items.length - 1) }));
  const selected: RetrievableItem[] = [];
  const limit = Math.min(items.length, Math.max(0, Math.floor(opts.topK)));

  while (selected.length < limit) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      let redundancy = 0;
      if (candidate.item.vector) {
        for (const chosen of selected) {
          if (chosen.vector) redundancy = Math.max(redundancy, opts.similarity(candidate.item.vector, chosen.vector));
        }
      }
      const score = opts.lambda * candidate.relevance - (1 - opts.lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]!.item);
  }
  return selected;
}

export interface RetrievalWeights {
  vector: number;
  axis: number;
  authority: number;
  recency: number;
}

// illustrative defaults — tune per deployment.
export const DEFAULT_WEIGHTS: RetrievalWeights = {
  vector: 0.5,
  axis: 0.3,
  authority: 0.15,
  recency: 0.05,
};

export interface RetrieveOptions {
  topK?: number;
  weights?: Partial<RetrievalWeights>;
  similarity?: SimilarityFn;
  authorityStrength?: (a: string) => number;
  mmr?: { lambda: number };
}

export function retrieve(
  query: AxisQuery,
  items: RetrievableItem[],
  opts: RetrieveOptions = {},
): Array<{ item: RetrievableItem; score: number }> {
  const weights: RetrievalWeights = {
    vector: opts.weights?.vector ?? DEFAULT_WEIGHTS.vector,
    axis: opts.weights?.axis ?? DEFAULT_WEIGHTS.axis,
    authority: opts.weights?.authority ?? DEFAULT_WEIGHTS.authority,
    recency: opts.weights?.recency ?? DEFAULT_WEIGHTS.recency,
  };
  const similarity = opts.similarity ?? cosineSimilarity;
  const strength = opts.authorityStrength ?? defaultAuthorityStrength;
  const timestamps = items.map((item) => Date.parse(item.updatedAt ?? "")).filter(Number.isFinite);
  const oldest = Math.min(...timestamps);
  const newest = Math.max(...timestamps);
  const recency = (updatedAt: string | undefined): number => {
    const timestamp = Date.parse(updatedAt ?? "");
    if (!Number.isFinite(timestamp)) return 0;
    return newest === oldest ? 1 : (timestamp - oldest) / (newest - oldest);
  };
  const scored = items
    .map((item) => ({
      item,
      score:
        weights.vector * (query.vector && item.vector ? similarity(query.vector, item.vector) : 0) +
        weights.axis * axisOverlap(item.axes, query.axes) +
        weights.authority * (item.authority ? strength(item.authority) : 0) +
        weights.recency * (item.vector ? recency(item.updatedAt) : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const topK = Math.max(0, Math.floor(opts.topK ?? 10));
  if (!opts.mmr) return scored.slice(0, topK);
  const reranked = mmrRerank(scored.map(({ item }) => item), {
    lambda: opts.mmr.lambda,
    similarity,
    topK,
  });
  const scores = new Map(scored.map(({ item, score }) => [item, score]));
  return reranked.map((item) => ({ item, score: scores.get(item)! }));
}
