// sourceKind is open: e.g. document, crawl, manual, inference
export interface ArtifactProvenance {
  sourceKind: string;
  sourceRef?: string;
  sourceLabel?: string;
  originEvent?: string;
  capturedAt?: string;
  writer?: string;
}

export function buildArtifactProvenance(
  fields: Partial<ArtifactProvenance> & { sourceKind: string },
): ArtifactProvenance {
  return { ...fields };
}

export function isCompleteProvenance(p: ArtifactProvenance): boolean {
  return Boolean(p.sourceKind.trim() && p.capturedAt?.trim());
}

export function describeProvenance(p: ArtifactProvenance): string {
  const source = p.sourceLabel || p.sourceRef || p.sourceKind;
  return `${source} (${p.sourceKind}) — captured ${p.capturedAt?.slice(0, 10) || "unknown date"}`;
}
