import assert from "node:assert/strict";
import test from "node:test";

import { makeIfc } from "../lib/reviter/export-ifc.ts";
import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";

const DOOR = -2_000_023;

/** A door leaf `width` x `thickness` feet, rotated `degrees` in plan. */
function leaf(width: number, thickness: number, degrees: number) {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const corners: [number, number][] = [
    [-width / 2, -thickness / 2], [width / 2, -thickness / 2],
    [width / 2, thickness / 2], [-width / 2, thickness / 2],
  ];
  const base = corners.map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]);
  const positions: number[] = [];
  for (const [x, y] of base) positions.push(x, y, 0);
  for (const [x, y] of base) positions.push(x, y, 7);
  return { positions, base };
}

function fixture(width: number, thickness: number, degrees: number): ConvertResult {
  const { positions, base } = leaf(width, thickness, degrees);
  const xs = base.map((p) => p[0]);
  const ys = base.map((p) => p[1]);
  const bounds: ElementBoundsRecord = {
    elementId: 1000, stream: "Partitions/1", chunkIndex: 0, rawOffset: 1, recordOffset: 1,
    categoryId: DOOR, categoryName: "Doors", categorySource: "native-token",
    renderGeometryProvenance: "native",
    boundsFeet: {
      min: { x: Math.min(...xs), y: Math.min(...ys), z: 0 },
      max: { x: Math.max(...xs), y: Math.max(...ys), z: 7 },
    },
  };
  return {
    ok: true, fileName: "door.rvt", byteLength: 64,
    meshes: [{
      name: "Recovered", positions: new Float32Array(positions),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
      colors: new Float32Array(positions.length),
      elementIds: new Uint32Array([1000, 1000, 1000, 1000]),
      materialIndex: 0, source: "native-brep",
    }],
    materials: [{
      name: "C", baseColorLinear: [0.5, 0.5, 0.5, 1], metallic: 0, roughness: 0.8,
      doubleSided: false, source: "rvt-material", assignedElements: 1,
    }],
    segments: [], elementBounds: [bounds], nativeProfiles: [],
    decoderCoverage: {
      revitVersion: 2027, activeDecoders: [], nativeCurves: 0, nativeProfiles: 0,
      nativeMeshes: 1, nativeMaterialDefinitions: 0, nativeMaterialAssignments: 0,
      approximateSolids: 0, nativeCategorisedElements: 1,
      geometryFidelity: "certified-native-brep-with-proxy-fallback",
      materialFidelity: "native-assigned", semanticFidelity: "native-categories",
    },
    origin: { x: 0, y: 0, z: 0 },
    bbox: { min: { x: -5, y: -5, z: 0 }, max: { x: 5, y: 5, z: 7 } },
    levels: [{ elevation: 0, candidates: 1, levelId: 30, source: "assoc-level-id" }],
    stats: {
      streamCount: 1, partitionStreams: 1, gzipChunks: 1, inflatedBytes: 1,
      candidatesFound: 1, candidatesFocused: 1, candidatesUsed: 1, vertexCount: 8,
      triangleCount: 4, meshCount: 1, boundsRecordsFound: 1, solidBoundsRecords: 1,
      durationMs: 1,
    },
    warnings: [], method: "partition-bounds-recovery",
  } as ConvertResult;
}

/** `IFCDOOR(...)`'s OverallWidth is the last numeric before the enums.
 *
 * Matched to the end of the LINE, not to the first `;`: the description field
 * reads "Recovered from RVT; geometry=...", so a `[^;]*` match stops inside
 * the string and finds nothing.
 */
function overallWidthMetres(ifc: string): number {
  const match = ifc.match(/=IFCDOOR\((.*)\);/);
  assert.ok(match, "the fixture should emit an IfcDoor");
  const fields = match[1]!.split(",");
  const enumAt = fields.findIndex((f) => f.trim() === ".DOOR.");
  assert.ok(enumAt > 1, "IfcDoor should carry its PredefinedType");
  return Number(fields[enumAt - 1]);
}

const FEET = 0.3048;

test("an axis-aligned door reports its own width", () => {
  const width = overallWidthMetres(makeIfc(fixture(3.0, 0.33, 0)));
  assert.ok(Math.abs(width - 3.0 * FEET) < 0.01,
    `expected ~${(3.0 * FEET).toFixed(3)} m, got ${width}`);
});

test("a door on a 58 degree wall reports its width, not its bounding box", () => {
  // The box sides are w|cos| + t|sin| and w|sin| + t|cos|; at 58 degrees a
  // 3 ft leaf 0.33 ft thick has a larger side of 2.72 ft, so the old rule
  // under-reported by a tenth of a foot and the error moved with the angle.
  const ifc = makeIfc(fixture(3.0, 0.33, 58));
  const width = overallWidthMetres(ifc);
  const boxSide = Math.max(
    3.0 * Math.abs(Math.cos(58 * Math.PI / 180)) + 0.33 * Math.abs(Math.sin(58 * Math.PI / 180)),
    3.0 * Math.abs(Math.sin(58 * Math.PI / 180)) + 0.33 * Math.abs(Math.cos(58 * Math.PI / 180)));

  assert.ok(Math.abs(width - 3.0 * FEET) < 0.02,
    `expected the true width ~${(3.0 * FEET).toFixed(3)} m, got ${width}`);
  assert.ok(Math.abs(width - boxSide * FEET) > 0.05,
    `and NOT the bounding-box side ${(boxSide * FEET).toFixed(3)} m`);
});

test("the reported width does not move with the wall's angle", () => {
  // The property that makes it a width at all: a door is the same door
  // whichever way its wall runs.
  const widths = [0, 17, 33, 58, 74, 90].map((d) => overallWidthMetres(makeIfc(fixture(3.0, 0.33, d))));
  const spread = Math.max(...widths) - Math.min(...widths);
  assert.ok(spread < 0.02, `widths varied by ${spread.toFixed(3)} m across angles: ${widths}`);
});

test("a square footprint falls back rather than inventing a direction", () => {
  // No dominant axis, so the principal axis is arbitrary; the bounding box is
  // at least a defined answer.
  const ifc = makeIfc(fixture(2.0, 2.0, 30));
  const width = overallWidthMetres(ifc);
  assert.ok(Number.isFinite(width) && width > 0, `expected a fallback width, got ${width}`);
});
