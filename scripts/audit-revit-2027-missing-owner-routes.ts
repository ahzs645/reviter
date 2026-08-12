#!/usr/bin/env node

/**
 * Inventory numeric IFC geometry Tags for which the certified RVT audit has
 * neither a direct GRep owner nor an exact instance placement.
 *
 * The IFC selects the acceptance population only. Every RVT identity,
 * relationship, frame, and bounds relation is decoded independently from the
 * RVT before the two domains are joined by the numeric Revit Tag.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import CFB from "cfb";
import { IfcAPI } from "web-ifc";

import {
  declareUsage,
  ifcScalar,
  increment,
  requirePath,
  sha256,
} from "./lib/rvt-harness.ts";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import {
  isRevit2027BoundedTessellatorRoot,
  isRevit2027ConditionedGeometryRoot,
  isRevit2027DirectGeometryRoot,
  isRevit2027EmbeddedGeometryRoot,
} from "../lib/reviter/revit-2027-direct-geometry-root.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { REVIT_2027_FAMILY_SYMBOL_MARKER } from "../lib/reviter/family-material-relations.ts";
import { REVIT_2027_INSERTABLE_INSTANCE_MARKER } from "../lib/reviter/host-relations.ts";
import {
  createRevit2027NativeMeshCollector,
  type Revit2027CompactOwnerMesh,
} from "../lib/reviter/revit-2027-native-mesh-bridge.ts";

const FEET_PER_METRE = 3.280839895;
const SAMPLE_LIMIT_PER_CLASS = 12;

declareUsage(
  "audit-revit-2027-missing-owner-routes.ts --rvt model.rvt --ifc model.ifc --rvt-audit audit.json --json report.json",
);

const paths = {
  rvt: requirePath("--rvt"),
  ifc: requirePath("--ifc"),
  rvtAudit: requirePath("--rvt-audit"),
  json: requirePath("--json"),
};

type Bounds = {
  minimum: [number, number, number];
  maximum: [number, number, number];
};

type CertifiedElement = Bounds & {
  elementId: number;
  triangles: number;
  source: "direct-owner" | "placed-instance" | "complete-nested-owner";
};

type IfcGeometry = Bounds & {
  className: string;
  triangles: number;
};

type FrameSummary = {
  marker: number;
  markerName: string;
  typeCode: number;
  objectLength: number;
  stream: string;
  chunkIndex: number;
  recordOffset: number;
  gRepShape: string | null;
};

type NeighborSummary = {
  direction: "previous" | "next";
  byteDistance: number;
  elementId: number;
  marker: number;
  markerName: string;
  typeCode: number;
  objectLength: number;
  certifiedRole: CertifiedElement["source"] | "placement-target" | null;
};

type TargetRow = {
  elementId: number;
  className: string;
  ifcTriangles: number;
  uniqueId: string;
  frames: FrameSummary[];
  neighbors: NeighborSummary[];
  categoryId: number | null;
  categoryName: string | null;
  typeId: number | null;
  owningElementId: number | null;
  ownerFrameMarkers: string[];
  ownedChildren: number;
  certifiedOwnedChildren: number[];
  hostId: number | null;
  certifiedHostedChildren: number[];
  associatedLevelId: number | null;
  familySymbolId: number | null;
  familyId: number | null;
  exactBoundsPeers: number;
  certifiedExactBoundsPeers: number[];
  ownedChildBoundsMaximumCornerErrorFeet: number | null;
  ownedChildTriangleCount: number;
  requestedOwnerCertifiedFaces: number;
  requestedOwnerCertifiedTriangles: number;
  requestedOwnerBoundsMaximumCornerErrorFeet: number | null;
  primaryCarrier: string;
  carriers: string[];
};

function emptyBounds(): Bounds {
  return {
    minimum: [Infinity, Infinity, Infinity],
    maximum: [-Infinity, -Infinity, -Infinity],
  };
}

function includePoint(bounds: Bounds, x: number, y: number, z: number): void {
  bounds.minimum[0] = Math.min(bounds.minimum[0], x);
  bounds.minimum[1] = Math.min(bounds.minimum[1], y);
  bounds.minimum[2] = Math.min(bounds.minimum[2], z);
  bounds.maximum[0] = Math.max(bounds.maximum[0], x);
  bounds.maximum[1] = Math.max(bounds.maximum[1], y);
  bounds.maximum[2] = Math.max(bounds.maximum[2], z);
}

function includeBounds(target: Bounds, source: Bounds): void {
  for (let axis = 0; axis < 3; axis += 1) {
    target.minimum[axis] = Math.min(
      target.minimum[axis],
      source.minimum[axis],
    );
    target.maximum[axis] = Math.max(
      target.maximum[axis],
      source.maximum[axis],
    );
  }
}

function finiteBounds(bounds: Bounds): boolean {
  return [...bounds.minimum, ...bounds.maximum].every(Number.isFinite);
}

function maximumCornerError(left: Bounds, right: Bounds): number {
  let result = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    result = Math.max(
      result,
      Math.abs(left.minimum[axis] - right.minimum[axis]),
      Math.abs(left.maximum[axis] - right.maximum[axis]),
    );
  }
  return result;
}

function boundsKey(bounds: {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}): string {
  return [
    bounds.min.x,
    bounds.min.y,
    bounds.min.z,
    bounds.max.x,
    bounds.max.y,
    bounds.max.z,
  ].map((value) => value.toPrecision(17)).join(",");
}

function markerName(marker: number): string {
  if (marker === REVIT_2027_GELEMENT_OBJECT_MARKER) return "GElement";
  if (marker === REVIT_2027_FAMILY_SYMBOL_MARKER) return "FamilySymbol";
  if (marker === REVIT_2027_INSERTABLE_INSTANCE_MARKER) {
    return "InsertableInstance";
  }
  return `0x${marker.toString(16).padStart(4, "0")}`;
}

function counts<K extends string | number>(
  map: ReadonlyMap<K, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map]
      .sort(([leftKey, leftCount], [rightKey, rightCount]) =>
        rightCount - leftCount ||
        String(leftKey).localeCompare(String(rightKey), undefined, {
          numeric: true,
        }))
      .map(([key, count]) => [String(key), count]),
  );
}

const rvtBytes = readFileSync(paths.rvt);
const ifcBytes = readFileSync(paths.ifc);
const rvtAuditBytes = readFileSync(paths.rvtAudit);
const rvtAudit = JSON.parse(rvtAuditBytes.toString("utf8")) as {
  topologyInventory?: {
    directGeometryOwnerElementIds?: number[];
    placementLinks?: Array<{ elementId: number; geometryOwnerId: number }>;
  };
  certifiedBrowserMesh?: {
    elements?: Array<{
      elementId: number;
      triangles: number;
      minimum: [number, number, number];
      maximum: [number, number, number];
    }>;
    instances?: Array<{
      elementId: number;
      triangles: number;
      minimum: [number, number, number];
      maximum: [number, number, number];
    }>;
    nestedInstances?: {
      elements?: Array<{
        elementId: number;
        triangles: number;
        minimum: [number, number, number];
        maximum: [number, number, number];
        complete: boolean;
      }>;
    };
  };
};

const directOwnerIds = new Set(
  rvtAudit.topologyInventory?.directGeometryOwnerElementIds ?? [],
);
const placementByElement = new Map(
  (rvtAudit.topologyInventory?.placementLinks ?? []).map((row) => [
    row.elementId,
    row.geometryOwnerId,
  ]),
);
const nestedIds = new Set(
  (rvtAudit.certifiedBrowserMesh?.nestedInstances?.elements ?? []).map(
    (row) => row.elementId,
  ),
);
const certifiedElements = new Map<number, CertifiedElement>();
for (const row of rvtAudit.certifiedBrowserMesh?.elements ?? []) {
  if (nestedIds.has(row.elementId)) continue;
  certifiedElements.set(row.elementId, {
    ...row,
    source: "direct-owner",
  });
}
for (const row of rvtAudit.certifiedBrowserMesh?.instances ?? []) {
  certifiedElements.set(row.elementId, {
    ...row,
    source: "placed-instance",
  });
}
for (const row of rvtAudit.certifiedBrowserMesh?.nestedInstances?.elements ?? []) {
  if (!row.complete) continue;
  certifiedElements.set(row.elementId, {
    ...row,
    source: "complete-nested-owner",
  });
}

// The public replay audit intentionally inventories syntactic direct-root
// candidates before production coverage and envelope gates. Preserve the fixed
// pre-tessellator 925-tag diagnostic corpus by removing the original three
// bounded shapes, the two embedded-column shapes, and conditioned candidates.
// The collector below measures their production admission independently.
const cfb = CFB.read(rvtBytes, { type: "buffer" });
const tessellatorCandidateOwnerIds = new Set<number>();
const conditionedGeometryCandidateOwnerIds = new Set<number>();
const embeddedGeometryCandidateOwnerIds = new Set<number>();
for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const fullPath = cfb.FullPaths[entryIndex] ?? "";
  const entry = cfb.FileIndex[entryIndex]!;
  if (entry.size <= 0 || !/(^|\/)Partitions\/[^/]+$/i.test(fullPath)) continue;
  const stored = stripRevitPageChecksums(asBytes(entry.content));
  const offsets = gzipOffsets(stored);
  let dictionary: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      dictionary,
    );
    const inflated = read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        dictionary,
      );
    if (!inflated) continue;
    if (read) dictionary = revitWindowTail(read);
    for (const frame of scanFramedElementObjects(inflated)) {
      if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
      const root = decodeRevit2027FramedGRepRoot(inflated, frame, 2027);
      if (!root.ok) continue;
      const ownerElementId = Number(root.value.ownerElementId);
      if (
        Number.isSafeInteger(ownerElementId) &&
        ownerElementId === frame.elementId
      ) {
        if (isRevit2027BoundedTessellatorRoot(root.value)) {
          tessellatorCandidateOwnerIds.add(ownerElementId);
        }
        if (isRevit2027ConditionedGeometryRoot(root.value)) {
          conditionedGeometryCandidateOwnerIds.add(ownerElementId);
        }
        if (isRevit2027EmbeddedGeometryRoot(root.value)) {
          embeddedGeometryCandidateOwnerIds.add(ownerElementId);
        }
      }
    }
  }
}
if (tessellatorCandidateOwnerIds.size !== 151) {
  throw new Error(
    `expected 151 bounded tessellator candidates, received ${
      tessellatorCandidateOwnerIds.size
    }`,
  );
}
if (embeddedGeometryCandidateOwnerIds.size !== 209) {
  throw new Error(
    `expected 209 embedded Geometry candidates, received ${
      embeddedGeometryCandidateOwnerIds.size
    }`,
  );
}
const baselineDirectOwnerIds = new Set(
  [...directOwnerIds].filter(
    (elementId) =>
      !tessellatorCandidateOwnerIds.has(elementId) &&
      !conditionedGeometryCandidateOwnerIds.has(elementId) &&
      !embeddedGeometryCandidateOwnerIds.has(elementId),
  ),
);

const api = new IfcAPI();
await api.Init();
const ifcModel = api.OpenModel(ifcBytes, { COORDINATE_TO_ORIGIN: false });
if (ifcModel < 0) throw new Error("web-ifc could not open the IFC oracle");
const classAndTagByExpressId = new Map<
  number,
  { className: string; numericTag: number | null }
>();
for (const typeCode of api.GetIfcEntityList(ifcModel)) {
  if (!api.IsIfcElement(typeCode)) continue;
  const className = api.GetNameFromTypeCode(typeCode);
  const ids = api.GetLineIDsWithType(ifcModel, typeCode, false);
  for (let index = 0; index < ids.size(); index += 1) {
    const expressId = ids.get(index);
    const rawTag = ifcScalar(api.GetLine(ifcModel, expressId, false)?.Tag);
    classAndTagByExpressId.set(expressId, {
      className,
      numericTag:
        typeof rawTag === "string" && /^\d+$/u.test(rawTag)
          ? Number(rawTag)
          : null,
    });
  }
}
const ifcGeometryByTag = new Map<number, IfcGeometry>();
api.StreamAllMeshes(ifcModel, (mesh) => {
  const identity = classAndTagByExpressId.get(mesh.expressID);
  if (identity?.numericTag == null) return;
  const bounds = emptyBounds();
  let triangles = 0;
  for (let index = 0; index < mesh.geometries.size(); index += 1) {
    const placed = mesh.geometries.get(index);
    const geometry = api.GetGeometry(ifcModel, placed.geometryExpressID);
    const indices = api.GetIndexArray(
      geometry.GetIndexData(),
      geometry.GetIndexDataSize(),
    );
    triangles += indices.length / 3;
    const vertices = api.GetVertexArray(
      geometry.GetVertexData(),
      geometry.GetVertexDataSize(),
    );
    const matrix = placed.flatTransformation;
    for (let vertex = 0; vertex + 2 < vertices.length; vertex += 6) {
      const x = vertices[vertex]!;
      const y = vertices[vertex + 1]!;
      const z = vertices[vertex + 2]!;
      includePoint(
        bounds,
        (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) *
          FEET_PER_METRE,
        -(matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) *
          FEET_PER_METRE,
        (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) *
          FEET_PER_METRE,
      );
    }
    geometry.delete();
  }
  const previous = ifcGeometryByTag.get(identity.numericTag);
  if (previous) {
    includeBounds(bounds, previous);
    triangles += previous.triangles;
  }
  ifcGeometryByTag.set(identity.numericTag, {
    ...bounds,
    className: identity.className,
    triangles,
  });
});
api.CloseModel(ifcModel);
api.Dispose();

const ifcGeometryNumericTags = ifcGeometryByTag.size;
const baselineCertifiedIfcTagPresence = [...ifcGeometryByTag.keys()].filter(
  (elementId) =>
    certifiedElements.has(elementId) &&
    !tessellatorCandidateOwnerIds.has(elementId) &&
    !conditionedGeometryCandidateOwnerIds.has(elementId) &&
    !embeddedGeometryCandidateOwnerIds.has(elementId),
).length;
const boundedTessellatorCompleteIfcTags = [...ifcGeometryByTag.keys()].filter(
  (elementId) =>
    certifiedElements.has(elementId) &&
    tessellatorCandidateOwnerIds.has(elementId),
).length;
const boundedTessellatorIfcBoundsWithinHalfFoot = [
  ...ifcGeometryByTag,
].filter(
  ([elementId, ifc]) =>
    tessellatorCandidateOwnerIds.has(elementId) &&
    certifiedElements.has(elementId) &&
    maximumCornerError(certifiedElements.get(elementId)!, ifc) <= 0.5,
).length;
const boundedTessellatorExactIfcTriangleCount = [
  ...ifcGeometryByTag,
].filter(
  ([elementId, ifc]) =>
    tessellatorCandidateOwnerIds.has(elementId) &&
    certifiedElements.get(elementId)?.triangles === ifc.triangles,
).length;
const conditionedGeometryCompleteIfcTags = [...ifcGeometryByTag.keys()].filter(
  (elementId) =>
    certifiedElements.has(elementId) &&
    conditionedGeometryCandidateOwnerIds.has(elementId) &&
    !tessellatorCandidateOwnerIds.has(elementId),
).length;
const conditionedGeometryIfcBoundsWithinHalfFoot = [
  ...ifcGeometryByTag,
].filter(
  ([elementId, ifc]) =>
    conditionedGeometryCandidateOwnerIds.has(elementId) &&
    !tessellatorCandidateOwnerIds.has(elementId) &&
    certifiedElements.has(elementId) &&
    maximumCornerError(certifiedElements.get(elementId)!, ifc) <= 0.5,
).length;
const conditionedGeometryExactIfcTriangleCount = [
  ...ifcGeometryByTag,
].filter(
  ([elementId, ifc]) =>
    conditionedGeometryCandidateOwnerIds.has(elementId) &&
    !tessellatorCandidateOwnerIds.has(elementId) &&
    certifiedElements.get(elementId)?.triangles === ifc.triangles,
).length;
const missingTags = new Set(
  [...ifcGeometryByTag.keys()].filter(
    (elementId) =>
      !baselineDirectOwnerIds.has(elementId) &&
      !placementByElement.has(elementId),
  ),
);
if (missingTags.size !== 925) {
  throw new Error(
    `expected 925 no-owner/no-placement tags, received ${missingTags.size}`,
  );
}

const conversion = convertRvtBytes(
  new Uint8Array(rvtBytes.buffer, rvtBytes.byteOffset, rvtBytes.byteLength),
  basename(paths.rvt),
  { revitVersion: 2027, maxSegments: 1 },
);
if (!conversion.ok) throw new Error(conversion.error);
if (!conversion.nativeIdentity || !conversion.elementOwnership) {
  throw new Error("native identity or ownership did not decode");
}

const identityByElement = new Map(
  conversion.nativeIdentity.identities.map((row) => [row.elementId, row]),
);
const ownershipByElement = new Map(
  conversion.elementOwnership.records.map((row) => [row.elementId, row]),
);
const childrenByOwner = new Map<number, number[]>();
for (const relation of conversion.elementOwnership.relations) {
  const children = childrenByOwner.get(relation.ownerId) ?? [];
  children.push(relation.elementId);
  childrenByOwner.set(relation.ownerId, children);
}
const hostByElement = new Map(
  (conversion.nativeHostRelations ?? []).map((row) => [
    row.elementId,
    row.hostId,
  ]),
);
const hostedChildren = new Map<number, number[]>();
for (const relation of conversion.nativeHostRelations ?? []) {
  const children = hostedChildren.get(relation.hostId) ?? [];
  children.push(relation.elementId);
  hostedChildren.set(relation.hostId, children);
}
const levelByElement = new Map(
  (conversion.nativeAssociatedLevelRelations ?? []).map((row) => [
    row.elementId,
    row.levelId,
  ]),
);
const boundsByElement = new Map(
  conversion.elementBounds.map((row) => [row.elementId, row]),
);
const elementsByBounds = new Map<string, number[]>();
for (const row of conversion.elementBounds) {
  const key = boundsKey(row.boundsFeet);
  const elements = elementsByBounds.get(key) ?? [];
  elements.push(row.elementId);
  elementsByBounds.set(key, elements);
}
const familyBySymbol = new Map(
  (conversion.nativeFamilySymbolRelations ?? []).map((row) => [
    row.symbolId,
    row.familyId,
  ]),
);

const relationScopeIds = new Set<number>(missingTags);
for (const elementId of missingTags) {
  const ownerId = ownershipByElement.get(elementId)?.owningElementId;
  if (ownerId != null) relationScopeIds.add(ownerId);
  for (const child of childrenByOwner.get(elementId) ?? []) {
    relationScopeIds.add(child);
  }
  const hostId = hostByElement.get(elementId);
  if (hostId != null) relationScopeIds.add(hostId);
  for (const child of hostedChildren.get(elementId) ?? []) {
    relationScopeIds.add(child);
  }
  const record = boundsByElement.get(elementId);
  if (record?.typeId != null) relationScopeIds.add(record.typeId);
  if (record?.familySymbolId != null) relationScopeIds.add(record.familySymbolId);
  if (record?.familyId != null) relationScopeIds.add(record.familyId);
}

const framesByElement = new Map<number, FrameSummary[]>();
const neighborsByElement = new Map<number, NeighborSummary[]>();
const requestedOwnerCollector = createRevit2027NativeMeshCollector(2027, {
  // This offline, fixed-corpus audit needs one diagnostic for every requested
  // owner. The browser conversion path retains the production default of 100.
  maxFailureSamples: missingTags.size,
  // Preserve every definition long enough to distinguish format support from
  // the production collector's independent browser-memory admission limits.
  maxStoredTriangles: 3_000_000,
  maxStoredBytes: 512 * 1024 * 1024,
});
let chunks = 0;
let failedChunks = 0;
for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const fullPath = cfb.FullPaths[entryIndex] ?? "";
  const stream = fullPath.replace(/^Root Entry\//, "");
  const entry = cfb.FileIndex[entryIndex]!;
  if (entry.size <= 0 || !/(^|\/)Partitions\/[^/]+$/i.test(fullPath)) continue;
  const stored = stripRevitPageChecksums(asBytes(entry.content));
  const offsets = gzipOffsets(stored);
  let dictionary: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      dictionary,
    );
    const inflated = read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        dictionary,
      );
    if (!inflated) {
      failedChunks += 1;
      continue;
    }
    if (read) dictionary = revitWindowTail(read);
    chunks += 1;
    requestedOwnerCollector.scanPage(inflated);
    const frames = scanFramedElementObjects(inflated);
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index]!;
      if (relationScopeIds.has(frame.elementId)) {
        let gRepShape: string | null = null;
        if (frame.marker === REVIT_2027_GELEMENT_OBJECT_MARKER) {
          const root = decodeRevit2027FramedGRepRoot(inflated, frame, 2027);
          gRepShape = !root.ok
            ? `decode-failed:${root.error}`
            : isRevit2027DirectGeometryRoot(root.value)
            ? "certified-direct-root-shape"
            : root.value.children
                .map((child) =>
                  `${child.token}:${child.sourceClassSlot ?? "null"}`)
                .join(",");
        }
        const summaries = framesByElement.get(frame.elementId) ?? [];
        summaries.push({
          marker: frame.marker,
          markerName: markerName(frame.marker),
          typeCode: frame.typeCode,
          objectLength: frame.objectLength,
          stream,
          chunkIndex,
          recordOffset: frame.offset,
          gRepShape,
        });
        framesByElement.set(frame.elementId, summaries);
      }
      if (!missingTags.has(frame.elementId)) continue;
      const neighbors = neighborsByElement.get(frame.elementId) ?? [];
      for (const neighborIndex of [index - 1, index + 1]) {
        const neighbor = frames[neighborIndex];
        if (!neighbor) continue;
        const certified = certifiedElements.get(neighbor.elementId);
        neighbors.push({
          direction: neighborIndex < index ? "previous" : "next",
          byteDistance:
            neighborIndex < index
              ? frame.offset -
                (neighbor.offset + neighbor.objectLength + 20)
              : neighbor.offset - (frame.offset + frame.objectLength + 20),
          elementId: neighbor.elementId,
          marker: neighbor.marker,
          markerName: markerName(neighbor.marker),
          typeCode: neighbor.typeCode,
          objectLength: neighbor.objectLength,
          certifiedRole: certified?.source ??
            (placementByElement.has(neighbor.elementId)
              ? "placement-target"
              : null),
        });
      }
      neighborsByElement.set(frame.elementId, neighbors);
    }
  }
}
const requestedOwnerCollection = requestedOwnerCollector.snapshot(missingTags);

function compactOwnerBounds(owner: Revit2027CompactOwnerMesh): Bounds | null {
  const bounds = emptyBounds();
  for (const face of owner.faces) {
    const positions = face.mesh.positions;
    const matrix = face.nestedTransform;
    for (let index = 0; index + 2 < positions.length; index += 3) {
      const x = positions[index]!;
      const y = positions[index + 1]!;
      const z = positions[index + 2]!;
      if (matrix) {
        includePoint(
          bounds,
          matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
          matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
          matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
        );
      } else {
        includePoint(bounds, x, y, z);
      }
    }
  }
  return finiteBounds(bounds) ? bounds : null;
}

function frameMarkers(elementId: number | null): string[] {
  if (elementId == null) return [];
  return [
    ...new Set(
      (framesByElement.get(elementId) ?? []).map((frame) => frame.markerName),
    ),
  ].sort();
}

function primaryCarrier(carriers: readonly string[]): string {
  const order = [
    "own-full-fifo-certified-mesh",
    "owning-element-to-certified-children",
    "host-to-certified-hosted-children",
    "own-certified-direct-grep-shape",
    "own-uncertified-gelement",
    "own-family-symbol",
    "own-insertable-instance-without-placement",
    "exact-shared-bounds-with-certified-element",
    "framed-semantic-record-only",
    "no-framed-partition-record",
  ];
  return order.find((candidate) => carriers.includes(candidate)) ??
    "unclassified";
}

const rows: TargetRow[] = [];
for (const elementId of [...missingTags].sort((a, b) => a - b)) {
  const ifc = ifcGeometryByTag.get(elementId)!;
  const identity = identityByElement.get(elementId);
  if (!identity) throw new Error(`missing native identity ${elementId}`);
  const record = boundsByElement.get(elementId);
  const frames = framesByElement.get(elementId) ?? [];
  const ownerId = ownershipByElement.get(elementId)?.owningElementId ?? null;
  const ownedChildren = childrenByOwner.get(elementId) ?? [];
  const certifiedOwnedChildren = ownedChildren.filter((child) =>
    certifiedElements.has(child));
  const certifiedHostedChildren = (hostedChildren.get(elementId) ?? []).filter(
    (child) => certifiedElements.has(child),
  );
  const peers = record
    ? (elementsByBounds.get(boundsKey(record.boundsFeet)) ?? []).filter(
        (peer) => peer !== elementId,
      )
    : [];
  const certifiedExactBoundsPeers = peers.filter((peer) =>
    certifiedElements.has(peer));
  const childBounds = emptyBounds();
  let ownedChildTriangleCount = 0;
  for (const child of certifiedOwnedChildren) {
    const geometry = certifiedElements.get(child)!;
    includeBounds(childBounds, geometry);
    ownedChildTriangleCount += geometry.triangles;
  }
  const ownedChildBoundsMaximumCornerErrorFeet = finiteBounds(childBounds)
    ? maximumCornerError(childBounds, ifc)
    : null;
  const requestedOwner =
    requestedOwnerCollection.owners.get(elementId) ?? null;
  const requestedOwnerBounds = requestedOwner
    ? compactOwnerBounds(requestedOwner)
    : null;
  const requestedOwnerBoundsMaximumCornerErrorFeet = requestedOwnerBounds
    ? maximumCornerError(requestedOwnerBounds, ifc)
    : null;
  const carriers: string[] = [];
  if (requestedOwner) {
    carriers.push("own-full-fifo-certified-mesh");
  }
  if (certifiedOwnedChildren.length) {
    carriers.push("owning-element-to-certified-children");
  }
  if (certifiedHostedChildren.length) {
    carriers.push("host-to-certified-hosted-children");
  }
  if (
    frames.some((frame) =>
      frame.marker === REVIT_2027_GELEMENT_OBJECT_MARKER &&
      frame.gRepShape === "certified-direct-root-shape")
  ) {
    carriers.push("own-certified-direct-grep-shape");
  } else if (
    frames.some((frame) => frame.marker === REVIT_2027_GELEMENT_OBJECT_MARKER)
  ) {
    carriers.push("own-uncertified-gelement");
  }
  if (frames.some((frame) => frame.marker === REVIT_2027_FAMILY_SYMBOL_MARKER)) {
    carriers.push("own-family-symbol");
  }
  if (
    frames.some((frame) =>
      frame.marker === REVIT_2027_INSERTABLE_INSTANCE_MARKER)
  ) {
    carriers.push("own-insertable-instance-without-placement");
  }
  if (certifiedExactBoundsPeers.length) {
    carriers.push("exact-shared-bounds-with-certified-element");
  }
  if (!frames.length) carriers.push("no-framed-partition-record");
  else if (!carriers.length) carriers.push("framed-semantic-record-only");
  rows.push({
    elementId,
    className: ifc.className,
    ifcTriangles: ifc.triangles,
    uniqueId: identity.uniqueId,
    frames,
    neighbors: neighborsByElement.get(elementId) ?? [],
    categoryId: record?.categoryId ?? null,
    categoryName: record?.categoryName ?? null,
    typeId: record?.typeId ?? null,
    owningElementId: ownerId,
    ownerFrameMarkers: frameMarkers(ownerId),
    ownedChildren: ownedChildren.length,
    certifiedOwnedChildren,
    hostId: hostByElement.get(elementId) ?? null,
    certifiedHostedChildren,
    associatedLevelId: levelByElement.get(elementId) ?? null,
    familySymbolId: record?.familySymbolId ?? null,
    familyId:
      record?.familyId ??
      (record?.familySymbolId == null
        ? null
        : familyBySymbol.get(record.familySymbolId) ?? null),
    exactBoundsPeers: peers.length,
    certifiedExactBoundsPeers,
    ownedChildBoundsMaximumCornerErrorFeet,
    ownedChildTriangleCount,
    requestedOwnerCertifiedFaces: requestedOwner?.faces.length ?? 0,
    requestedOwnerCertifiedTriangles: requestedOwner?.triangles ?? 0,
    requestedOwnerBoundsMaximumCornerErrorFeet,
    carriers,
    primaryCarrier: primaryCarrier(carriers),
  });
}

const byClass = new Map<string, {
  tags: number;
  ifcTriangles: number;
  identities: number;
  withFrames: number;
  withBounds: number;
  withOwner: number;
  withHost: number;
  withLevel: number;
  withType: number;
  withFamily: number;
  fullFifoCertifiedOwners: number;
  fullFifoBoundsWithinHalfFoot: number;
  fullFifoExactTriangleCount: number;
  carriers: Map<string, number>;
  markers: Map<string, number>;
  typeCodes: Map<string, number>;
  gRepShapes: Map<string, number>;
  completeGRepShapes: Map<string, number>;
  halfFootGRepShapes: Map<string, number>;
}>();
const carrierCounts = new Map<string, number>();
const markerCounts = new Map<string, number>();
const typeCodeCounts = new Map<string, number>();
const categoryCounts = new Map<string, number>();
let ownedChildBoundsWithinMicron = 0;
let ownedChildBoundsWithinHalfFoot = 0;
let ownedChildExactTriangleCount = 0;
let requestedOwnerBoundsWithinMicron = 0;
let requestedOwnerBoundsWithinHalfFoot = 0;
let requestedOwnerExactTriangleCount = 0;
let conditionedGeometryCompleteOwners = 0;
let conditionedGeometryBoundsWithinHalfFoot = 0;
let conditionedGeometryExactTriangleCount = 0;
let embeddedGeometryCompleteOwners = 0;
let embeddedGeometryBoundsWithinHalfFoot = 0;
let embeddedGeometryExactTriangleCount = 0;
for (const row of rows) {
  const summary = byClass.get(row.className) ?? {
    tags: 0,
    ifcTriangles: 0,
    identities: 0,
    withFrames: 0,
    withBounds: 0,
    withOwner: 0,
    withHost: 0,
    withLevel: 0,
    withType: 0,
    withFamily: 0,
    fullFifoCertifiedOwners: 0,
    fullFifoBoundsWithinHalfFoot: 0,
    fullFifoExactTriangleCount: 0,
    carriers: new Map<string, number>(),
    markers: new Map<string, number>(),
    typeCodes: new Map<string, number>(),
    gRepShapes: new Map<string, number>(),
    completeGRepShapes: new Map<string, number>(),
    halfFootGRepShapes: new Map<string, number>(),
  };
  summary.tags += 1;
  summary.ifcTriangles += row.ifcTriangles;
  summary.identities += row.uniqueId ? 1 : 0;
  summary.withFrames += row.frames.length ? 1 : 0;
  summary.withBounds += boundsByElement.has(row.elementId) ? 1 : 0;
  summary.withOwner += row.owningElementId == null ? 0 : 1;
  summary.withHost += row.hostId == null ? 0 : 1;
  summary.withLevel += row.associatedLevelId == null ? 0 : 1;
  summary.withType += row.typeId == null ? 0 : 1;
  summary.withFamily += row.familyId == null ? 0 : 1;
  summary.fullFifoCertifiedOwners +=
    row.requestedOwnerCertifiedFaces > 0 ? 1 : 0;
  summary.fullFifoBoundsWithinHalfFoot +=
    row.requestedOwnerBoundsMaximumCornerErrorFeet != null &&
      row.requestedOwnerBoundsMaximumCornerErrorFeet <= 0.5
      ? 1
      : 0;
  summary.fullFifoExactTriangleCount +=
    row.requestedOwnerCertifiedFaces > 0 &&
      row.requestedOwnerCertifiedTriangles === row.ifcTriangles
      ? 1
      : 0;
  increment(summary.carriers, row.primaryCarrier);
  increment(carrierCounts, row.primaryCarrier);
  for (const frame of row.frames) {
    increment(summary.markers, frame.markerName);
    increment(summary.typeCodes, String(frame.typeCode));
    if (frame.gRepShape != null) {
      increment(summary.gRepShapes, frame.gRepShape);
      if (row.requestedOwnerCertifiedFaces > 0) {
        increment(summary.completeGRepShapes, frame.gRepShape);
      }
      if (
        row.requestedOwnerBoundsMaximumCornerErrorFeet != null &&
        row.requestedOwnerBoundsMaximumCornerErrorFeet <= 0.5
      ) {
        increment(summary.halfFootGRepShapes, frame.gRepShape);
      }
    }
    increment(markerCounts, frame.markerName);
    increment(typeCodeCounts, String(frame.typeCode));
  }
  if (row.categoryId != null) {
    increment(
      categoryCounts,
      `${row.categoryId}:${row.categoryName ?? "unnamed"}`,
    );
  }
  if (row.ownedChildBoundsMaximumCornerErrorFeet != null) {
    if (row.ownedChildBoundsMaximumCornerErrorFeet <= 1e-6) {
      ownedChildBoundsWithinMicron += 1;
    }
    if (row.ownedChildBoundsMaximumCornerErrorFeet <= 0.5) {
      ownedChildBoundsWithinHalfFoot += 1;
    }
    if (row.ownedChildTriangleCount === row.ifcTriangles) {
      ownedChildExactTriangleCount += 1;
    }
  }
  if (row.requestedOwnerBoundsMaximumCornerErrorFeet != null) {
    if (row.requestedOwnerBoundsMaximumCornerErrorFeet <= 1e-6) {
      requestedOwnerBoundsWithinMicron += 1;
    }
    if (row.requestedOwnerBoundsMaximumCornerErrorFeet <= 0.5) {
      requestedOwnerBoundsWithinHalfFoot += 1;
    }
    if (row.requestedOwnerCertifiedTriangles === row.ifcTriangles) {
      requestedOwnerExactTriangleCount += 1;
    }
  }
  if (
    conditionedGeometryCandidateOwnerIds.has(row.elementId) &&
    row.requestedOwnerCertifiedFaces > 0
  ) {
    conditionedGeometryCompleteOwners += 1;
    if (
      row.requestedOwnerBoundsMaximumCornerErrorFeet != null &&
      row.requestedOwnerBoundsMaximumCornerErrorFeet <= 0.5
    ) {
      conditionedGeometryBoundsWithinHalfFoot += 1;
    }
    if (row.requestedOwnerCertifiedTriangles === row.ifcTriangles) {
      conditionedGeometryExactTriangleCount += 1;
    }
  }
  if (
    embeddedGeometryCandidateOwnerIds.has(row.elementId) &&
    row.requestedOwnerCertifiedFaces > 0
  ) {
    embeddedGeometryCompleteOwners += 1;
    if (
      row.requestedOwnerBoundsMaximumCornerErrorFeet != null &&
      row.requestedOwnerBoundsMaximumCornerErrorFeet <= 0.5
    ) {
      embeddedGeometryBoundsWithinHalfFoot += 1;
    }
    if (row.requestedOwnerCertifiedTriangles === row.ifcTriangles) {
      embeddedGeometryExactTriangleCount += 1;
    }
  }
  byClass.set(row.className, summary);
}

const digestRows = rows.map((row) => ({
  elementId: row.elementId,
  className: row.className,
  primaryCarrier: row.primaryCarrier,
  markers: row.frames.map((frame) => frame.marker),
  typeCodes: row.frames.map((frame) => frame.typeCode),
  owningElementId: row.owningElementId,
  certifiedOwnedChildren: row.certifiedOwnedChildren,
  hostId: row.hostId,
  associatedLevelId: row.associatedLevelId,
  typeId: row.typeId,
  familySymbolId: row.familySymbolId,
  familyId: row.familyId,
}));
function requestedOwnerFailureCategory(detail: string): string {
  const missingReader = detail.match(/no certified Revit 2027 GRep reader for source slot (\d+)/u);
  if (missingReader) return `grep-replay-missing-reader-slot-${missingReader[1]}`;
  if (detail.startsWith("GRep FIFO replay failed:")) {
    if (detail.includes("boundary gap")) return "grep-replay-boundary-gap";
    if (detail.includes("token gap")) return "grep-replay-token-gap";
    if (detail.includes("below index")) return "grep-replay-unreserved-token";
    return "grep-replay-other";
  }
  if (detail.startsWith("framed GRep root decode failed:")) {
    return "framed-grep-root-decode";
  }
  if (detail.startsWith("nested-instance replay failed:")) {
    return "nested-instance-replay";
  }
  if (detail.startsWith("certified face meshing failed:")) {
    return "certified-face-meshing";
  }
  if (detail.startsWith("nested instance symbol target")) {
    return "nested-symbol-target-missing";
  }
  if (detail.includes("lacks complete local drawable-face coverage")) {
    return "nested-local-drawable-coverage";
  }
  if (detail.includes("no drawable topological faces")) {
    return "local-no-drawable-faces";
  }
  if (detail.includes("drawable Face token(s) have no certified mesh")) {
    const issueCodes = [
      ...detail.matchAll(/(?:^|, |; )[^:,;]+:([a-z][a-z-]+)/gu),
    ].map((match) => match[1]!);
    return issueCodes.length
      ? `local-incomplete-mesh:${[...new Set(issueCodes)].sort().join("+")}`
      : "local-incomplete-mesh:unclassified";
  }
  if (detail.includes("no framed GRep definition")) {
    return "no-framed-grep-definition";
  }
  if (detail.includes("duplicate or conflicting")) {
    return "duplicate-or-conflicting-definition";
  }
  if (detail.includes("storage") && detail.includes("truncat")) {
    return "storage-truncated";
  }
  if (detail.includes("resolves to no complete drawable faces")) {
    return "nested-empty";
  }
  return "unclassified";
}

if (
  requestedOwnerCollection.requestedOwnerFailureSamples.length !==
    requestedOwnerCollection.requestedOwnerFailures
) {
  throw new Error(
    "offline requested-owner audit did not retain every failure diagnostic",
  );
}
const requestedOwnerFailureCategories = new Map<string, number>();
const requestedOwnerFailureCategoriesByIfcClass =
  new Map<string, Map<string, number>>();
for (const failure of requestedOwnerCollection.requestedOwnerFailureSamples) {
  const category = requestedOwnerFailureCategory(failure.detail);
  requestedOwnerFailureCategories.set(
    category,
    (requestedOwnerFailureCategories.get(category) ?? 0) + 1,
  );
  const className = failure.ownerElementId == null
    ? "UnresolvedOwner"
    : ifcGeometryByTag.get(failure.ownerElementId)?.className ??
      "OutsideIfcOracle";
  const classCounts =
    requestedOwnerFailureCategoriesByIfcClass.get(className) ??
      new Map<string, number>();
  classCounts.set(category, (classCounts.get(category) ?? 0) + 1);
  requestedOwnerFailureCategoriesByIfcClass.set(className, classCounts);
}
const certifiedIfcTagPresence =
  baselineCertifiedIfcTagPresence +
  conditionedGeometryCompleteIfcTags +
  boundedTessellatorCompleteIfcTags +
  embeddedGeometryCompleteOwners;
const certifiedIfcSpatialParity =
  baselineCertifiedIfcTagPresence +
  conditionedGeometryIfcBoundsWithinHalfFoot +
  boundedTessellatorIfcBoundsWithinHalfFoot +
  embeddedGeometryBoundsWithinHalfFoot;
const report = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-revit-2027-missing-owner-routes.ts",
  inputs: {
    rvt: {
      name: basename(paths.rvt),
      bytes: rvtBytes.byteLength,
      sha256: sha256(rvtBytes),
    },
    ifc: {
      name: basename(paths.ifc),
      bytes: ifcBytes.byteLength,
      sha256: sha256(ifcBytes),
      role: "post-decode-geometry-population-oracle-only",
    },
    rvtAudit: {
      name: basename(paths.rvtAudit),
      bytes: rvtAuditBytes.byteLength,
      sha256: sha256(rvtAuditBytes),
    },
  },
  scope: {
    missingNoDirectOwnerOrPlacementTags: rows.length,
    ifcTriangles: rows.reduce((sum, row) => sum + row.ifcTriangles, 0),
    tagSha256: sha256(`${rows.map((row) => row.elementId).join(",")}\n`),
    routeDigestSha256: sha256(`${JSON.stringify(digestRows)}\n`),
    allNativeIdentitiesResolved: rows.every((row) => Boolean(row.uniqueId)),
    publicSyntacticDirectOwnerIds: directOwnerIds.size,
    baselineDirectOwnerIds: baselineDirectOwnerIds.size,
    conditionedGeometry: {
      candidateIfcTags: [...conditionedGeometryCandidateOwnerIds].filter(
        (elementId) =>
          ifcGeometryByTag.has(elementId) &&
          !tessellatorCandidateOwnerIds.has(elementId),
      ).length,
      completeIfcTags: conditionedGeometryCompleteIfcTags,
      ifcBoundsWithinHalfFoot: conditionedGeometryIfcBoundsWithinHalfFoot,
      exactIfcTriangleCount: conditionedGeometryExactIfcTriangleCount,
      fixedCorpusCandidateOwners: [...conditionedGeometryCandidateOwnerIds].filter(
        (elementId) => missingTags.has(elementId),
      ).length,
      fixedCorpusCompleteOwners: conditionedGeometryCompleteOwners,
      fixedCorpusIfcBoundsWithinHalfFoot:
        conditionedGeometryBoundsWithinHalfFoot,
      fixedCorpusExactIfcTriangleCount:
        conditionedGeometryExactTriangleCount,
    },
    embeddedGeometry: {
      candidateOwners: embeddedGeometryCandidateOwnerIds.size,
      completeOwners: embeddedGeometryCompleteOwners,
      productionEmittedOwners:
        conversion.decoderCoverage.nativeMeshEmbeddedGeometryElements ?? 0,
      ifcBoundsWithinHalfFoot: embeddedGeometryBoundsWithinHalfFoot,
      exactIfcTriangleCount: embeddedGeometryExactTriangleCount,
    },
    boundedTessellator: {
      candidateOwners: tessellatorCandidateOwnerIds.size,
      coverageCompleteOwners: boundedTessellatorCompleteIfcTags,
      productionEmittedOwners:
        conversion.decoderCoverage.nativeMeshBoundedTessellatorElements ?? 0,
      remainingWithoutCompleteCertifiedGeometry:
        rows.length - requestedOwnerCollection.completeRequestedOwners,
      ifcBoundsWithinHalfFoot: boundedTessellatorIfcBoundsWithinHalfFoot,
      exactIfcTriangleCount: boundedTessellatorExactIfcTriangleCount,
    },
    ifcCertifiedTagCoverage: {
      denominator: ifcGeometryNumericTags,
      baselineTagPresence: baselineCertifiedIfcTagPresence,
      boundedTessellatorCompleteTags: boundedTessellatorCompleteIfcTags,
      tagPresenceTotal: certifiedIfcTagPresence,
      tagPresenceRatio: certifiedIfcTagPresence / ifcGeometryNumericTags,
      boundedTessellatorIfcBoundsWithinHalfFoot:
        boundedTessellatorIfcBoundsWithinHalfFoot,
      conditionedGeometryIfcBoundsWithinHalfFoot,
      embeddedGeometryIfcBoundsWithinHalfFoot:
        embeddedGeometryBoundsWithinHalfFoot,
      ifcSpatialParityTotal: certifiedIfcSpatialParity,
      ifcSpatialParityRatio:
        certifiedIfcSpatialParity / ifcGeometryNumericTags,
      note:
        "Complete native Tag presence is distinct from IFC AABB agreement. " +
        "Complete conditioned, embedded, or tessellator roots outside half-foot IFC AABB " +
        "agreement remain certified native geometry but are not counted as " +
        "IFC spatial-parity matches.",
    },
    placementLinks: placementByElement.size,
    certifiedDrawableElements: certifiedElements.size,
  },
  byIfcClass: Object.fromEntries(
    [...byClass]
      .sort((left, right) =>
        right[1].tags - left[1].tags || left[0].localeCompare(right[0]))
      .map(([className, summary]) => [
        className,
        {
          ...summary,
          carriers: counts(summary.carriers),
          markers: counts(summary.markers),
          typeCodes: counts(summary.typeCodes),
          gRepShapes: counts(summary.gRepShapes),
          completeGRepShapes: counts(summary.completeGRepShapes),
          halfFootGRepShapes: counts(summary.halfFootGRepShapes),
        },
      ]),
  ),
  carriers: counts(carrierCounts),
  framedRecords: {
    markers: counts(markerCounts),
    typeCodes: counts(typeCodeCounts),
    categories: counts(categoryCounts),
    note:
      "Same-chunk previous/next frames are samples only. Byte adjacency is " +
      "never promoted to ownership or geometry membership.",
  },
  ownedCertifiedChildrenDiagnostic: {
    targetsWithCertifiedChildren: rows.filter((row) =>
      row.certifiedOwnedChildren.length > 0).length,
    boundsWithin1e6Feet: ownedChildBoundsWithinMicron,
    boundsWithinHalfFoot: ownedChildBoundsWithinHalfFoot,
    exactTriangleCount: ownedChildExactTriangleCount,
    note:
      "Persisted OwningElementId proves membership. AABB and triangle-count " +
      "agreement are diagnostics and do not by themselves prove complete " +
      "drawable-product composition.",
  },
  requestedOwnerFullFifoDiagnostic: {
    requestedOwners: requestedOwnerCollection.requestedOwnerDefinitions,
    completeOwners: requestedOwnerCollection.completeRequestedOwners,
    partialOwners: requestedOwnerCollection.partialRequestedOwners,
    certifiedTriangles: requestedOwnerCollection.requestedOwnerTriangles,
    failures: requestedOwnerCollection.requestedOwnerFailures,
    failureCategories: counts(requestedOwnerFailureCategories),
    failureCategoriesByIfcClass: Object.fromEntries(
      [...requestedOwnerFailureCategoriesByIfcClass]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([className, categoryCounts]) => [
          className,
          counts(categoryCounts),
        ]),
    ),
    failureSamples: requestedOwnerCollection.requestedOwnerFailureSamples,
    boundsWithin1e6Feet: requestedOwnerBoundsWithinMicron,
    boundsWithinHalfFoot: requestedOwnerBoundsWithinHalfFoot,
    exactTriangleCount: requestedOwnerExactTriangleCount,
    note:
      "Every complete owner passed the existing full FIFO, certified face " +
      "mesh, drawable-face coverage, nested-composition, conflict, and bounded " +
      "storage gates. IFC bounds and triangle counts remain diagnostics.",
  },
  samplesByIfcClass: Object.fromEntries(
    [...byClass.keys()]
      .sort()
      .map((className) => [
        className,
        rows
          .filter((row) => row.className === className)
          .slice(0, SAMPLE_LIMIT_PER_CLASS),
      ]),
  ),
  scan: {
    partitionChunks: chunks,
    failedPartitionChunks: failedChunks,
  },
  evidenceBoundary:
    "RVT identity, ownership, host, level, type/family fields, frames, and " +
    "bounds are decoded without IFC. The fixed 925-tag pre-tessellator corpus " +
    "is preserved while exact RVT coverage and envelope gates measure the new " +
    "production route. IFC is used only after decode as the geometry population, " +
    "bounds, and triangle-count oracle.",
};

mkdirSync(dirname(paths.json), { recursive: true });
writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `${rows.length} no-owner/no-placement tags; carriers ` +
  `${JSON.stringify(report.carriers)}`,
);
console.log(`Wrote ${paths.json}`);
