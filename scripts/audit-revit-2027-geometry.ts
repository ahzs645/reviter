/**
 * Audit the exact Revit 2027 source-slot 2,343 (`Geometry`) static body.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-geometry.ts model.rvt
 */
import {
  FORMATS_LATEST_PATTERN,
  PARTITION_STREAM_PATTERN,
  iterateInflatedChunks,
  openRvt,
  requireModelPath,
} from "./lib/rvt-harness.ts";

import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  REVIT_2027_GARRAY_BODY_BYTES,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
  REVIT_2027_GLINE_BODY_BYTES,
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  decodeRevit2027FramedGRepRoot,
  decodeRevit2027GArray,
  decodeRevit2027GGroupStatic,
  decodeRevit2027GLine,
  decodeRevit2027GeometryStatic,
} from "./lib/revit-2027-decoders.ts";
import type {
  Revit2027GeometryStatic,
} from "./lib/revit-2027-decoders.ts";
const SOURCE_LADDER = [
  [2277, "GPolyMesh"],
  [2278, "GRenderSettings"],
  [2279, "GRepKeeperElem"],
  [2280, "GRepKeeperElemForConcealedFaces"],
  [2281, "GRepKeeperElemForRebarCover"],
  [2282, "GRepKeeperElemForRebarTargetConstraint"],
  [2283, "GRichText"],
  [2284, "GRvtLink"],
  [2285, "GScreenPlacer"],
  [2286, "GShowLinesOnlyOverrider"],
  [2287, "GStepTempData"],
  [2288, "GStyle"],
  [2289, "GStyleCategoryOverrider"],
  [2290, "GStyleColorOverrider"],
  [2291, "GStyleCutOrProjOverrider"],
  [2292, "GStyleElem"],
  [2293, "GStyleElemGroupHelper"],
  [2294, "GSurfacesTransparencyOverrider"],
  [2295, "GSymbol"],
  [2296, "GSystem"],
  [2297, "GText"],
  [2298, "UniformTextFragment"],
  [2299, "GTagomizingFamSymHistoryDriver"],
  [2300, "GViewportBox"],
  [2301, "GViewportLabel"],
  [2302, "GenCurveSegInPlaneRef"],
  [2303, "GenSweepGStep"],
  [2304, "GenerateExternalFacesStep"],
  [2305, "GenericCDFamilyEndControl"],
  [2306, "GenericElemXCopyCore"],
  [2307, "GenericMultiElemXCopyCore"],
  [2308, "GenericPlaneCutter"],
  [2309, "GenericZone"],
  [2310, "GenericZoneDomainData"],
  [2311, "GenericZoneGeomStep"],
  [2312, "GeoLocation"],
  [2313, "GeoSite"],
  [2314, "GeographicalCoordinate"],
  [2315, "GeolocationBoundingBox"],
  [2316, "GeolocationControlPoint"],
  [2317, "GeomCombinationBooleanGStep"],
  [2318, "GeomFaceTypeMarker"],
  [2319, "GeomGeneratorData"],
  [2320, "GeomHistReverseLookup"],
  [2321, "std::pair< int, FaceHist >"],
  [2322, "std::pair< int, EdgeHist >"],
  [2323, "std::pair< int, CurveHist >"],
  [2324, "GeomMaterialMarker"],
  [2325, "GeomObjectType"],
  [2326, "GeomOnPlaneRef"],
  [2327, "GeomOnPlaneRefBase"],
  [2328, "GeomPerpPlaneRef"],
  [2329, "GeomPositioningCell"],
  [2330, "LocationLineOffsetData"],
  [2331, "GeomRefCurveData"],
  [2332, "GeomRefMap"],
  [2333, "std::pair< GeomRef, GeomRef >"],
  [2334, "GeomSegInPlaneRef"],
  [2335, "GeomStepExtrDataTable"],
  [2336, "std::pair< int, GeomStepExtraData >"],
  [2337, "GeomStepList"],
  [2338, "GeomTable"],
  [2339, "GeomToElemMapWrapper"],
  [2340, "std::pair< TagPair, ElementId >"],
  [2341, "TagPair"],
  [2342, "GeometricAssemblyComponentDescriptor"],
  [2343, "Geometry"],
] as const;

function increment(
  map: Map<string | number, number>,
  key: string | number,
): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function matchesAscii(
  data: Uint8Array,
  offset: number,
  value: string,
): boolean {
  if (offset < 0 || offset > data.byteLength - value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (data[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function findSchemaName(
  data: Uint8Array,
  name: string,
  firstOffset: number,
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let offset = firstOffset;
    offset <= data.byteLength - name.length - 2;
    offset += 1
  ) {
    if (
      view.getUint16(offset, true) === name.length &&
      matchesAscii(data, offset + 2, name)
    ) {
      return offset;
    }
  }
  return -1;
}

function certifySchema(data: Uint8Array) {
  let cursor = 0;
  const ladder = SOURCE_LADDER.map(([sourceClassSlot, name]) => {
    const offset = findSchemaName(data, name, cursor);
    if (offset < 0) {
      throw new Error(
        `Formats/Latest source ladder is missing ${sourceClassSlot} ${name}`,
      );
    }
    cursor = offset + 2 + name.length;
    return { sourceClassSlot, name, offset };
  });

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const geometry = ladder.at(-1)!;
  let offset = geometry.offset + 2 + geometry.name.length + 2;
  const version = view.getUint32(offset, true);
  const fieldCount = view.getUint32(offset + 4, true);
  offset += 8;
  const fields = [
    ["m_flags", [0x04, 0x00, 0x00, 0x00]],
    ["m_geometryTag", [0x04, 0x00, 0x00, 0x00]],
    [
      "m_tessEpsCntrl",
      [0x0e, 0x00, 0x00, 0x00, 0xa0, 0x08],
    ],
    ["m_pEdges", [0x0e, 0x51, 0x00, 0x00]],
    ["m_sharedSurfInfo", [0x0e, 0x51, 0x00, 0x00]],
  ] as const;
  const decodedFields: { name: string; descriptor: string }[] = [];
  for (const [name, descriptor] of fields) {
    const nameLength = view.getUint32(offset, true);
    offset += 4;
    if (nameLength !== name.length || !matchesAscii(data, offset, name)) {
      throw new Error(`Geometry schema field ${name} is not in declared order`);
    }
    offset += name.length;
    if (
      descriptor.some((value, index) => data[offset + index] !== value)
    ) {
      throw new Error(`Geometry schema descriptor ${name} changed`);
    }
    decodedFields.push({
      name,
      descriptor: descriptor
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" "),
    });
    offset += descriptor.length;
  }

  const gBRepOffset = findSchemaName(data, "GBRep", 0);
  if (gBRepOffset < 0) throw new Error("Formats/Latest has no GBRep schema");
  let gBRepCursor = gBRepOffset + 2 + "GBRep".length + 2;
  const gBRepVersion = view.getUint32(gBRepCursor, true);
  const gBRepFieldCount = view.getUint32(gBRepCursor + 4, true);
  gBRepCursor += 8;
  const faceNameLength = view.getUint32(gBRepCursor, true);
  gBRepCursor += 4;
  const gBRepFaces =
    faceNameLength === "m_pFaces".length &&
    matchesAscii(data, gBRepCursor, "m_pFaces");
  gBRepCursor += faceNameLength;
  const gBRepDescriptor = [...data.subarray(gBRepCursor, gBRepCursor + 4)];

  const ok =
    ladder.length ===
      REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT - SOURCE_LADDER[0][0] + 1 &&
    version === 3 &&
    fieldCount === fields.length &&
    gBRepVersion === 1 &&
    gBRepFieldCount === 1 &&
    gBRepFaces &&
    gBRepDescriptor.join(",") === "14,81,0,0";
  return {
    ok,
    firstSourceClassSlot: ladder[0]!.sourceClassSlot,
    firstName: ladder[0]!.name,
    firstOffset: ladder[0]!.offset,
    inserted2027SourceSlots: ladder.slice(37, 40),
    geometry: {
      sourceClassSlot: geometry.sourceClassSlot,
      offset: geometry.offset,
      version,
      fieldCount,
      fields: decodedFields,
    },
    gBRep: {
      offset: gBRepOffset,
      version: gBRepVersion,
      fieldCount: gBRepFieldCount,
      field: gBRepFaces ? "m_pFaces" : null,
      descriptor: gBRepDescriptor
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" "),
    },
  };
}

function requireTokens(
  entries: readonly CondInt16QueueEntry[],
  firstToken: number,
): string | null {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.sourceClassSlot == null) {
      return "Geometry replay contains a null queued property";
    }
    if (entry.token !== firstToken + index) {
      return "Geometry replay token is not the next append index";
    }
  }
  return null;
}

function recordGeometry(
  value: Revit2027GeometryStatic,
  prefixes: string,
  collectionCounts: Map<string, number>,
  bodyBytes: Map<number, number>,
  queuedSlots: Map<number, number>,
  flags: Map<number, number>,
  tessControllers: Map<string, number>,
): void {
  increment(collectionCounts, `${prefixes}.faces:${value.faces.count}`);
  increment(collectionCounts, `${prefixes}.edges:${value.edges.count}`);
  increment(
    collectionCounts,
    `${prefixes}.sharedSurfaceInfo:${value.sharedSurfaceInfo.count}`,
  );
  increment(bodyBytes, value.endOffset - value.byteOffset);
  increment(flags, value.flags);
  increment(
    tessControllers,
    `${value.tessEpsCntrl.type},${value.tessEpsCntrl.version}`,
  );
  for (const entry of value.queuedProperties) {
    increment(queuedSlots, entry.sourceClassSlot!);
  }
}

const modelPath = requireModelPath(
  "audit-revit-2027-geometry.ts model.rvt",
);

const model = openRvt(modelPath);
const release = model.requireRelease(2027);
const schema = model.firstInflatedStream(FORMATS_LATEST_PATTERN);
if (!schema) throw new Error("RVT has no readable Formats/Latest stream");
const schemaEvidence = certifySchema(schema);
if (!schemaEvidence.ok) {
  throw new Error("Formats/Latest does not certify source slot 2343 Geometry");
}

const partitions = model.streamsMatching(PARTITION_STREAM_PATTERN);

let chunks = 0;
let failedChunks = 0;
let rootsWithInitialGeometry = 0;
let decodedInitialGeometry = 0;
let firstNestedGeometryCandidates = 0;
let positionedFirstNestedGeometry = 0;
let decodedFirstNestedGeometry = 0;
const failures = new Map<string, number>();
const nestedRouteFailures = new Map<string, number>();
const rootShapes = new Map<string, number>();
const collectionCounts = new Map<string, number>();
const bodyBytes = new Map<number, number>();
const queuedSlots = new Map<number, number>();
const geometryFlags = new Map<number, number>();
const tessControllers = new Map<string, number>();

for (const { data: inflated } of iterateInflatedChunks(model, {
  onFailure: () => {
    failedChunks += 1;
  },
})) {
  chunks += 1;

  for (const frame of scanFramedElementObjects(inflated)) {
    if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
    const decodedRoot = decodeRevit2027FramedGRepRoot(
      inflated,
      frame,
      release,
    );
    if (!decodedRoot.ok) continue;
    const root = decodedRoot.value;

    if (
      root.children[0]?.sourceClassSlot ===
      REVIT_2027_GGROUP_SOURCE_CLASS_SLOT
    ) {
      const rootTokenError = requireTokens(root.children, 3);
      if (rootTokenError) {
        increment(nestedRouteFailures, rootTokenError);
      } else {
        let routeOffset = root.dynamicPayloadOffset;
        let routeNextToken = 3 + root.children.length;
        let routeFailure: string | null = null;
        let isGeometryCandidate = false;

        for (
          let queueIndex = 0;
          queueIndex < root.children.length;
          queueIndex += 1
        ) {
          const entry = root.children[queueIndex]!;
          if (
            entry.sourceClassSlot ===
            REVIT_2027_GGROUP_SOURCE_CLASS_SLOT
          ) {
            const group = decodeRevit2027GGroupStatic(
              inflated,
              routeOffset,
              root.dynamicPayloadEndOffset,
              release,
            );
            if (!group.ok) {
              routeFailure = group.error;
              break;
            }
            if (queueIndex === 0) {
              isGeometryCandidate =
                group.value.children[0]?.sourceClassSlot ===
                REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT;
              if (isGeometryCandidate) {
                firstNestedGeometryCandidates += 1;
              }
            }
            const tokenError = requireTokens(
              group.value.children,
              routeNextToken,
            );
            if (tokenError) {
              routeFailure = tokenError;
              break;
            }
            routeNextToken += group.value.children.length;
            routeOffset = group.value.endOffset;
          } else if (
            entry.sourceClassSlot ===
            REVIT_2027_GARRAY_SOURCE_CLASS_SLOT
          ) {
            const endOffset = routeOffset + REVIT_2027_GARRAY_BODY_BYTES;
            const array = decodeRevit2027GArray(
              inflated,
              routeOffset,
              endOffset,
              release,
            );
            if (!array.ok || endOffset > root.dynamicPayloadEndOffset) {
              routeFailure = array.ok
                ? "GArray exceeds the Geometry replay boundary"
                : array.error;
              break;
            }
            routeOffset = array.value.endOffset;
          } else if (
            entry.sourceClassSlot ===
            REVIT_2027_GLINE_SOURCE_CLASS_SLOT
          ) {
            const endOffset = routeOffset + REVIT_2027_GLINE_BODY_BYTES;
            if (endOffset > root.dynamicPayloadEndOffset) {
              routeFailure = "GLine exceeds the Geometry replay boundary";
              break;
            }
            const line = decodeRevit2027GLine(
              inflated,
              routeOffset,
              endOffset,
              release,
            );
            if (!line.ok) {
              routeFailure = line.error;
              break;
            }
            routeOffset = line.value.endOffset;
          } else if (
            entry.sourceClassSlot ===
            REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
          ) {
            const geometry = decodeRevit2027GeometryStatic(
              inflated,
              routeOffset,
              root.dynamicPayloadEndOffset,
              release,
            );
            if (!geometry.ok) {
              routeFailure = geometry.error;
              break;
            }
            const tokenError = requireTokens(
              geometry.value.queuedProperties,
              routeNextToken,
            );
            if (tokenError) {
              routeFailure = tokenError;
              break;
            }
            routeNextToken += geometry.value.queuedProperties.length;
            routeOffset = geometry.value.endOffset;
          } else {
            routeFailure =
              `no certified initial-sibling reader for source slot ` +
              `${entry.sourceClassSlot}`;
            break;
          }
        }

        if (isGeometryCandidate) {
          if (routeFailure) {
            increment(nestedRouteFailures, routeFailure);
          } else {
            positionedFirstNestedGeometry += 1;
            const nested = decodeRevit2027GeometryStatic(
              inflated,
              routeOffset,
              root.dynamicPayloadEndOffset,
              release,
            );
            if (!nested.ok) {
              increment(nestedRouteFailures, nested.error);
            } else {
              const tokenError = requireTokens(
                nested.value.queuedProperties,
                routeNextToken,
              );
              if (tokenError) {
                increment(nestedRouteFailures, tokenError);
              } else {
                decodedFirstNestedGeometry += 1;
                recordGeometry(
                  nested.value,
                  "nested",
                  collectionCounts,
                  bodyBytes,
                  queuedSlots,
                  geometryFlags,
                  tessControllers,
                );
              }
            }
          }
        }
      }
    }

    const geometryIndex = root.children.findIndex(
      (entry) =>
        entry.sourceClassSlot === REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
    );
    if (geometryIndex < 0) continue;
    rootsWithInitialGeometry += 1;
    increment(
      rootShapes,
      root.children.map((entry) => entry.sourceClassSlot ?? 0).join(","),
    );

    if (
      geometryIndex !== root.children.length - 1 ||
      root.children
        .slice(0, geometryIndex)
        .some(
          (entry) =>
            entry.sourceClassSlot !== REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
        )
    ) {
      increment(failures, "unsupported entries before/after initial Geometry");
      continue;
    }
    const rootTokenError = requireTokens(root.children, 3);
    if (rootTokenError) {
      increment(failures, rootTokenError);
      continue;
    }

    let offset = root.dynamicPayloadOffset;
    let nextAppendToken = 3 + root.children.length;
    let groupFailure: string | null = null;
    for (let index = 0; index < geometryIndex; index += 1) {
      const group = decodeRevit2027GGroupStatic(
        inflated,
        offset,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!group.ok) {
        groupFailure = group.error;
        break;
      }
      const tokenError = requireTokens(
        group.value.children,
        nextAppendToken,
      );
      if (tokenError) {
        groupFailure = tokenError;
        break;
      }
      nextAppendToken += group.value.children.length;
      offset = group.value.endOffset;
    }
    if (groupFailure) {
      increment(failures, groupFailure);
      continue;
    }

    const geometry = decodeRevit2027GeometryStatic(
      inflated,
      offset,
      root.dynamicPayloadEndOffset,
      release,
    );
    if (!geometry.ok) {
      increment(failures, geometry.error);
      continue;
    }
    const geometryTokenError = requireTokens(
      geometry.value.queuedProperties,
      nextAppendToken,
    );
    if (geometryTokenError) {
      increment(failures, geometryTokenError);
      continue;
    }
    decodedInitialGeometry += 1;
    recordGeometry(
      geometry.value,
      "initial",
      collectionCounts,
      bodyBytes,
      queuedSlots,
      geometryFlags,
      tessControllers,
    );
  }

}
function entries<K extends string | number>(
  map: Map<K, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map].sort((left, right) => right[1] - left[1]),
  );
}

function topEntries<K extends string | number>(
  map: Map<K, number>,
  limit = 20,
): {
  values: Record<string, number>;
  otherOccurrences: number;
} {
  const sorted = [...map].sort((left, right) => right[1] - left[1]);
  return {
    values: Object.fromEntries(sorted.slice(0, limit)),
    otherOccurrences: sorted
      .slice(limit)
      .reduce((sum, entry) => sum + entry[1], 0),
  };
}

function prefixedDistribution(
  map: Map<string, number>,
  prefix: string,
): {
  occurrences: number;
  minimum: number | null;
  maximum: number | null;
  modes: Record<string, number>;
} {
  const values = [...map]
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, count]) => [
      Number.parseInt(key.slice(prefix.length), 10),
      count,
    ] as const);
  return {
    occurrences: values.reduce((sum, entry) => sum + entry[1], 0),
    minimum: values.length
      ? Math.min(...values.map((entry) => entry[0]))
      : null,
    maximum: values.length
      ? Math.max(...values.map((entry) => entry[0]))
      : null,
    modes: Object.fromEntries(
      [...values].sort((left, right) => right[1] - left[1]).slice(0, 10),
    ),
  };
}

console.log(
  JSON.stringify(
    {
      modelPath,
      release,
      schemaEvidence,
      partitions: partitions.length,
      chunks,
      failedChunks,
      sourceClassSlot: REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
      rootsWithInitialGeometry,
      decodedInitialGeometry,
      initialCoveragePercent:
        rootsWithInitialGeometry === 0
          ? 0
          : Number(
              (
                (100 * decodedInitialGeometry) /
                rootsWithInitialGeometry
              ).toFixed(4),
            ),
      firstNestedGeometryCandidates,
      positionedFirstNestedGeometry,
      decodedFirstNestedGeometry,
      firstNestedCoveragePercent:
        firstNestedGeometryCandidates === 0
          ? 0
          : Number(
              (
                (100 * decodedFirstNestedGeometry) /
                firstNestedGeometryCandidates
              ).toFixed(4),
            ),
      collectionCounts: {
        initialFaces: prefixedDistribution(
          collectionCounts,
          "initial.faces:",
        ),
        initialEdges: prefixedDistribution(
          collectionCounts,
          "initial.edges:",
        ),
        initialSharedSurfaceInfo: prefixedDistribution(
          collectionCounts,
          "initial.sharedSurfaceInfo:",
        ),
        nestedFaces: prefixedDistribution(
          collectionCounts,
          "nested.faces:",
        ),
        nestedEdges: prefixedDistribution(
          collectionCounts,
          "nested.edges:",
        ),
        nestedSharedSurfaceInfo: prefixedDistribution(
          collectionCounts,
          "nested.sharedSurfaceInfo:",
        ),
      },
      bodyBytes: {
        occurrences: [...bodyBytes.values()].reduce(
          (sum, count) => sum + count,
          0,
        ),
        minimum: bodyBytes.size ? Math.min(...bodyBytes.keys()) : null,
        maximum: bodyBytes.size ? Math.max(...bodyBytes.keys()) : null,
        modes: topEntries(bodyBytes, 10).values,
      },
      queuedSourceClassSlots: entries(queuedSlots),
      geometryFlags: entries(geometryFlags),
      tessControllers: entries(tessControllers),
      rootShapes: topEntries(rootShapes),
      failures: entries(failures),
      nestedRouteFailures: entries(nestedRouteFailures),
    },
    null,
    2,
  ),
);
