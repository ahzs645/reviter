import assert from "node:assert/strict";
import test from "node:test";

import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { REVIT_2027_INSERTABLE_INSTANCE_MARKER } from "../lib/reviter/host-relations.ts";
import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";

const DOOR = -2_000_023;
const WALL = -2_000_011;
const DOOR_ID = 1000;
const WALL_ID = 2000;
const FEET = 0.3048;

type Pt = [number, number];

/** A plain rectangular leaf, `width` x `thickness` feet, in the wall's frame. */
function leaf(width: number, thickness: number): Pt[] {
  return [[-width / 2, -thickness / 2], [width / 2, -thickness / 2],
          [width / 2, thickness / 2], [-width / 2, thickness / 2]];
}

/**
 * The leaf plus the quarter circle its swing sweeps, hinged at the left jamb.
 *
 * This is the shape `door-leaf.ts` describes as what a door's record actually
 * holds -- "the opening plus the arc the leaf sweeps through", square in plan
 * for 86% of this building's doors. Its dominant direction is a diagonal, so
 * the footprint's own principal axis measures the swing rather than the door.
 */
function leafWithSwing(width: number, thickness: number, steps = 24): Pt[] {
  const points = leaf(width, thickness);
  const hinge = -width / 2;
  for (let step = 0; step <= steps; step += 1) {
    const angle = (Math.PI / 2) * (step / steps);
    points.push([hinge + width * Math.cos(angle), -width * Math.sin(angle)]);
  }
  points.push([hinge, 0]);
  return points;
}

function rotate(points: Pt[], degrees: number): Pt[] {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return points.map(([x, y]) => [x * c - y * s, x * s + y * c] as Pt);
}

type Host = {
  /** Direction of the host wall's location line, in degrees. */
  degrees: number;
  /** Perpendicular offset of that line from the origin, in feet. */
  offsetFeet?: number;
};

/** The plan ring, triangulated as a fan and extruded to a 7 ft head height. */
function fixture(plan: Pt[], host: Host | null): ConvertResult {
  const positions: number[] = [];
  for (const [x, y] of plan) positions.push(x, y, 0);
  for (const [x, y] of plan) positions.push(x, y, 7);
  const indices: number[] = [];
  const corners = plan.length;
  for (let index = 1; index + 1 < corners; index += 1) {
    indices.push(0, index, index + 1);
    indices.push(corners, corners + index, corners + index + 1);
  }
  const faces = indices.length / 3;
  const xs = plan.map((point) => point[0]);
  const ys = plan.map((point) => point[1]);
  const door: ElementBoundsRecord = {
    elementId: DOOR_ID, stream: "Partitions/1", chunkIndex: 0, rawOffset: 1, recordOffset: 1,
    categoryId: DOOR, categoryName: "Doors", categorySource: "native-token",
    renderGeometryProvenance: "native",
    boundsFeet: {
      min: { x: Math.min(...xs), y: Math.min(...ys), z: 0 },
      max: { x: Math.max(...xs), y: Math.max(...ys), z: 7 },
    },
  };
  const records: ElementBoundsRecord[] = [door];
  const relations = [];
  if (host) {
    const r = (host.degrees * Math.PI) / 180;
    const ux = Math.cos(r);
    const uy = Math.sin(r);
    const offset = host.offsetFeet ?? 0;
    records.push({
      elementId: WALL_ID, stream: "Partitions/1", chunkIndex: 0, rawOffset: 2, recordOffset: 2,
      categoryId: WALL, categoryName: "Walls", categorySource: "native-token",
      renderGeometryProvenance: "native",
      boundsFeet: { min: { x: -30, y: -30, z: 0 }, max: { x: 30, y: 30, z: 10 } },
      solid: {
        elementId: WALL_ID,
        start: { x: -20 * ux - offset * -uy, y: -20 * uy - offset * ux },
        end: { x: 20 * ux - offset * -uy, y: 20 * uy + offset * ux },
        baseElevation: 0, topElevation: 10, thickness: 0.5,
      },
    });
    relations.push({
      elementId: DOOR_ID, hostId: WALL_ID,
      fieldOffset: 151 as const, recordOffset: 1, objectLength: 64,
      objectMarker: REVIT_2027_INSERTABLE_INSTANCE_MARKER,
      kind: "host" as const,
      source: "Partitions/InsertableInst.m_hostId" as const,
      evidence: "persisted" as const,
    });
  }
  return {
    ok: true, fileName: "door.rvt", byteLength: 64,
    meshes: [{
      name: "Recovered", positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      colors: new Float32Array(positions.length),
      elementIds: new Uint32Array(new Array<number>(faces).fill(DOOR_ID)),
      materialIndex: 0, source: "native-brep",
    }],
    materials: [{
      name: "C", baseColorLinear: [0.5, 0.5, 0.5, 1], metallic: 0, roughness: 0.8,
      doubleSided: false, source: "rvt-material", assignedElements: 1,
    }],
    segments: [], elementBounds: records, nativeProfiles: [],
    nativeHostRelations: relations,
    decoderCoverage: {
      revitVersion: 2027, activeDecoders: [], nativeCurves: 0, nativeProfiles: 0,
      nativeMeshes: 1, nativeMaterialDefinitions: 0, nativeMaterialAssignments: 0,
      approximateSolids: 0, nativeCategorisedElements: 1,
      geometryFidelity: "certified-native-brep-with-proxy-fallback",
      materialFidelity: "native-assigned", semanticFidelity: "native-categories",
    },
    origin: { x: 0, y: 0, z: 0 },
    bbox: { min: { x: -30, y: -30, z: 0 }, max: { x: 30, y: 30, z: 10 } },
    levels: [{ elevation: 0, candidates: 1, levelId: 30, source: "assoc-level-id" }],
    stats: {
      streamCount: 1, partitionStreams: 1, gzipChunks: 1, inflatedBytes: 1,
      candidatesFound: 1, candidatesFocused: 1, candidatesUsed: 1, vertexCount: 8,
      triangleCount: faces, meshCount: 1, boundsRecordsFound: 1, solidBoundsRecords: 1,
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
  const enumAt = fields.findIndex((field) => field.trim() === ".DOOR.");
  assert.ok(enumAt > 1, "IfcDoor should carry its PredefinedType");
  return Number(fields[enumAt - 1]);
}

/** What the voxel consumer actually reads: whole blocks at a 1 m pitch. */
const blocks = (metres: number) => Math.round(metres / 1.0);

const swingAt = (degrees: number, width = 6.0) =>
  rotate(leafWithSwing(width, 0.33), degrees);

test("a door's width is its extent along the host wall, not along its swing", () => {
  for (const degrees of [0, 32, 58]) {
    const width = overallWidthMetres(makeIfc(fixture(swingAt(degrees), { degrees })));
    assert.ok(Math.abs(width - 6.0 * FEET) < 0.02,
      `at ${degrees} degrees expected ~${(6.0 * FEET).toFixed(3)} m, got ${width}`);
  }
});

test("the swing costs a 6 ft opening a whole voxel block without its host", () => {
  // The grading the goal asks for: a `round(width / 1 m)` boundary crossed.
  // The footprint's own principal axis runs down the diagonal of the quarter
  // disc, so it measures 2.62 m of swing where the opening is 1.83 m -- three
  // blocks of hole punched for a two-block door.
  for (const degrees of [0, 32, 58]) {
    const loose = overallWidthMetres(makeIfc(fixture(swingAt(degrees), null)));
    const hosted = overallWidthMetres(makeIfc(fixture(swingAt(degrees), { degrees })));
    assert.equal(blocks(loose), 3, `unhosted at ${degrees} degrees read ${loose} m`);
    assert.equal(blocks(hosted), 2, `hosted at ${degrees} degrees read ${hosted} m`);
  }
});

test("the hosted width does not move with the wall's angle", () => {
  const widths = [0, 17, 32, 58, 74, 90].map((degrees) =>
    overallWidthMetres(makeIfc(fixture(swingAt(degrees), { degrees }))));
  const spread = Math.max(...widths) - Math.min(...widths);
  assert.ok(spread < 0.02, `widths varied by ${spread.toFixed(3)} m across angles: ${widths}`);
});

test("a plain leaf keeps the answer the footprint's own axis already gave", () => {
  // The host must never make a door that was already right worse.
  for (const degrees of [0, 32, 58]) {
    const plan = rotate(leaf(3.0, 0.33), degrees);
    const loose = overallWidthMetres(makeIfc(fixture(plan, null)));
    const hosted = overallWidthMetres(makeIfc(fixture(plan, { degrees })));
    assert.ok(Math.abs(hosted - 3.0 * FEET) < 0.02,
      `at ${degrees} degrees expected ~${(3.0 * FEET).toFixed(3)} m, got ${hosted}`);
    assert.ok(Math.abs(hosted - loose) < 0.02,
      `the host changed a correct width at ${degrees} degrees: ${loose} -> ${hosted}`);
  }
});

test("a host resolved across the door reports nothing rather than its depth", () => {
  // The failure the gate exists for: a corner where the persisted host id lands
  // on the perpendicular wall. Projecting onto that reads the leaf's 0.33 ft
  // thickness as the opening width -- a door too narrow to walk through.
  const plan = rotate(leaf(3.0, 0.33), 58);
  const loose = overallWidthMetres(makeIfc(fixture(plan, null)));
  const crossed = overallWidthMetres(makeIfc(fixture(plan, { degrees: 58 + 90 })));
  assert.ok(Math.abs(crossed - loose) < 1e-6,
    `expected the fallback ${loose} m, got ${crossed}`);
  assert.ok(crossed > 0.5, `and not the leaf thickness: ${crossed} m`);
});

test("a host whose centreline misses the door is refused", () => {
  // Same relation, same direction, but a wall run 10 ft away in plan: the
  // geometry does not agree that the door is in it.
  const plan = rotate(leafWithSwing(6.0, 0.33), 58);
  const loose = overallWidthMetres(makeIfc(fixture(plan, null)));
  const distant = overallWidthMetres(
    makeIfc(fixture(plan, { degrees: 58, offsetFeet: 10 })));
  assert.ok(Math.abs(distant - loose) < 1e-6,
    `expected the fallback ${loose} m, got ${distant}`);
});
