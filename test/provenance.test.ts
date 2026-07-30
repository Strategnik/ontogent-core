import { expect, test } from "bun:test";
import {
  buildArtifactProvenance,
  describeProvenance,
  isCompleteProvenance,
} from "../src/provenance";

test("provenance helpers build, validate, and describe an origin", () => {
  const provenance = buildArtifactProvenance({
    sourceKind: "document",
    sourceRef: "doc-1",
    sourceLabel: "Guide",
    capturedAt: "2026-07-29T12:00:00Z",
    writer: "importer",
  });
  expect(provenance).toEqual({
    sourceKind: "document",
    sourceRef: "doc-1",
    sourceLabel: "Guide",
    capturedAt: "2026-07-29T12:00:00Z",
    writer: "importer",
  });
  expect(isCompleteProvenance(provenance)).toBe(true);
  expect(isCompleteProvenance({ sourceKind: "document" })).toBe(false);
  expect(describeProvenance(provenance)).toBe("Guide (document) — captured 2026-07-29");
});
