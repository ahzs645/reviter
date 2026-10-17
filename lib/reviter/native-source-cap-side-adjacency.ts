/** Unwired original reciprocal cap/side incidence. Source topology supplies
 * adjacency only; all numerical UV/twin embeddings remain unchanged. No
 * material contact, support, headroom or route approval is granted here. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  readOriginalNativeStairPhysicalSource,
  type OriginalNativeStairPhysicalContext,
} from "./native-source-stair-physical-inventory.ts";
import {
  readOriginalForeignEnvelopeScopedFloor,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import { revit2027OwnerMeshIndex } from "./revit-2027-owner-mesh-index.ts";
import { walkRevit2027DirectedLoopEdges } from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027FaceStatic } from "./revit-2027-face-static.ts";
import type { Revit2027EdgeLoopStatic } from "./revit-2027-edge-loop-static.ts";
type Use = {
  faceToken: number;
  loopToken: number;
  edgeToken: number;
  side: 0 | 1;
  direction: 1 | -1;
};
/** Pure replay-shaped mathematics. A copied replay cannot mint source facts. */
export function inspectReciprocalCapSideTopology(
  replay: Revit2027GRepReplay,
  capFaceToken: number,
) {
  const index = revit2027OwnerMeshIndex(replay),
    spans = replay.spans,
    geometries = spans.filter((s) => s.readerId === "Revit2027Geometry");
  if (
    !index.faces.has(capFaceToken) ||
    index.faces.size !==
      spans.filter((s) => s.readerId === "Revit2027Face").length ||
    index.edges.size !==
      spans.filter((s) => s.readerId === "Revit2027GEdge").length ||
    index.loops.size !==
      spans.filter((s) => s.readerId === "Revit2027EdgeLoop").length ||
    spans.some((s) => s.ownerElementId !== replay.ownerElementId)
  )
    throw Error("Missing, duplicated or foreign original cap topology census");
  const faceGeometry = new Map<number, number>(),
    edgeGeometry = new Map<number, number>();
  for (const geometry of geometries) {
    const value = geometry.value as {
      faces: {
        count: number;
        entries: { token: number; sourceClassSlot: number }[];
      };
      edges: {
        count: number;
        entries: { token: number; sourceClassSlot: number }[];
      };
    };
    if (
      value.faces.count !== value.faces.entries.length ||
      value.edges.count !== value.edges.entries.length
    )
      throw Error("Original Geometry declaration is incomplete");
    for (const [entries, slot, map, indexMap] of [
      [value.faces.entries, 1825, faceGeometry, index.faces],
      [value.edges.entries, 1423, edgeGeometry, index.edges],
    ] as const)
      for (const item of entries) {
        if (
          item.sourceClassSlot !== slot ||
          map.has(item.token) ||
          !indexMap.has(item.token)
        )
          throw Error(
            "Original Geometry ownership is missing, duplicated or unsupported",
          );
        map.set(item.token, geometry.replayIndex);
        const actual = spans.filter(
          (s) =>
            s.propertyToken === item.token &&
            s.readerId === (slot === 1825 ? "Revit2027Face" : "Revit2027GEdge"),
        );
        if (
          actual.length !== 1 ||
          actual[0]!.parentReplayIndex !== geometry.replayIndex
        )
          throw Error(
            "Original declared cap primitive has a different Geometry parent",
          );
      }
  }
  if (
    faceGeometry.size !== index.faces.size ||
    edgeGeometry.size !== index.edges.size
  )
    throw Error("Unconsumed original cap Face/Edge declaration");
  const faces: {
      faceToken: number;
      face: Revit2027FaceStatic;
      loopUses: {
        loopToken: number;
        loop: Revit2027EdgeLoopStatic;
        directedEdges: Use[];
      }[];
    }[] = [],
    allUses = new Map<number, Use[]>(),
    consumedLoops = new Set<number>();
  for (const [faceToken, face] of index.faces) {
    let next = face.firstLoop.token;
    if (!next)
      throw Error("Original physical face has no complete source loops");
    const loopUses = [];
    while (next) {
      if (consumedLoops.has(next))
        throw Error("Original cap loop is reused or cyclic");
      const loop = index.loops.get(next);
      if (!loop || loop.loop.faceReference !== faceToken || loop.loop.open)
        throw Error(
          "Original cap loop has unsupported ownership or open state",
        );
      consumedLoops.add(next);
      const walk = walkRevit2027DirectedLoopEdges({
        faceToken,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (!walk.ok)
        throw Error("Original reciprocal directed loop does not close");
      const directedEdges = walk.edges.map((e) => ({
        faceToken,
        loopToken: next,
        edgeToken: e.token,
        side: e.side,
        direction: e.direction,
      }));
      for (const use of directedEdges) {
        const list = allUses.get(use.edgeToken) ?? [];
        list.push(use);
        allUses.set(use.edgeToken, list);
      }
      loopUses.push({
        loopToken: next,
        loop: structuredClone(loop.loop),
        directedEdges,
      });
      next = loop.loop.nextLoop.token;
    }
    faces.push({ faceToken, face: structuredClone(face), loopUses });
  }
  if (
    consumedLoops.size !== index.loops.size ||
    allUses.size !== index.edges.size
  )
    throw Error("Original cap graph leaves source loops or coedges unconsumed");
  for (const [edgeToken, edge] of index.edges) {
    const uses = allUses.get(edgeToken)!;
    if (
      uses.length !== 2 ||
      uses[0]!.side === uses[1]!.side ||
      edge.faceReferences[0] === edge.faceReferences[1] ||
      !index.faces.has(edge.faceReferences[0]) ||
      !index.faces.has(edge.faceReferences[1]) ||
      uses.some((u) => edge.faceReferences[u.side] !== u.faceToken) ||
      edge.faceReferences.some(
        (f) => faceGeometry.get(f) !== edgeGeometry.get(edgeToken),
      )
    )
      throw Error(
        "Original shared edge is not reciprocal within one source Geometry",
      );
  }
  const component = new Set<number>([capFaceToken]),
    pending = [capFaceToken];
  while (pending.length) {
    const face = pending.pop()!;
    for (const loop of faces.find((f) => f.faceToken === face)!.loopUses)
      for (const use of loop.directedEdges) {
        const e = index.edges.get(use.edgeToken)!;
        for (const other of e.faceReferences)
          if (!component.has(other)) {
            component.add(other);
            pending.push(other);
          }
      }
  }
  const componentFaceTokens = [...component].sort((a, b) => a - b),
    componentEdgeTokens = [...index.edges]
      .filter(([, e]) => e.faceReferences.every((f) => component.has(f)))
      .map(([token]) => token)
      .sort((a, b) => a - b),
    geometryReplayIndex = faceGeometry.get(capFaceToken)!,
    geometry = spans.find((s) => s.replayIndex === geometryReplayIndex)!,
    adjacentSides = [];
  for (const sideFaceToken of componentFaceTokens) {
    if (sideFaceToken === capFaceToken) continue;
    const sharedEdges = [];
    for (const token of componentEdgeTokens) {
      const uses = allUses.get(token)!;
      const cap = uses.find((u) => u.faceToken === capFaceToken),
        side = uses.find((u) => u.faceToken === sideFaceToken);
      if (!cap || !side) continue;
      if (cap.side === side.side)
        throw Error("Cap and side do not have distinct reciprocal source uses");
      sharedEdges.push({
        edgeToken: token,
        capLoopToken: cap.loopToken,
        sideLoopToken: side.loopToken,
        capUse: { side: cap.side, direction: cap.direction },
        sideUse: { side: side.side, direction: side.direction },
      });
    }
    if (sharedEdges.length) adjacentSides.push({ sideFaceToken, sharedEdges });
  }
  return {
    nativeOwnerElementId: Number(replay.ownerElementId),
    sourceGeometryToken: geometry.propertyToken,
    sourceGeometryReplayIndex: geometryReplayIndex,
    capFaceToken,
    componentFaceTokens,
    componentEdgeTokens,
    componentId: `native:${replay.ownerElementId}:geometry:${geometry.propertyToken}:component:${componentFaceTokens[0]}`,
    faces: faces.filter((f) => component.has(f.faceToken)),
    edges: componentEdgeTokens.map((edgeToken) => ({
      edgeToken,
      ...structuredClone(index.edges.get(edgeToken)!),
    })),
    adjacentSides,
    completeDeclaredGeometryCount: geometries.length,
    completeDeclaredFaceCount: index.faces.size,
    completeDeclaredEdgeCount: index.edges.size,
    completeDeclaredLoopCount: index.loops.size,
    originalSourceAuthorityGranted: false as const,
    numericalCoordinatesChanged: false as const,
    contactApproved: false as const,
    routeApproved: false as const,
  };
}
export function inspectOriginalNativeStairCapSideTopology(
  context: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
  capFaceToken: number,
) {
  const source = readOriginalNativeStairPhysicalSource(context, nativeRunId);
  return {
    ...inspectReciprocalCapSideTopology(
      source.physicalDefinition,
      capFaceToken,
    ),
    nativeStairId: source.nativeStairId,
    nativeRunId,
    nativeDefinitionId: source.nativeDefinitionId,
    sourceModelSha256: source.sourceModelSha256,
    sourceSchemaSha256: source.sourceSchemaSha256,
    sourceFrameSha256s: structuredClone(source.sourceFrameSha256s),
    sourceBoundOriginalOperands: true as const,
  };
}
export function inspectOriginalNativeFloorCapSideTopology(
  census: OriginalNativeForeignEnvelopeCensus,
  nativeFloorId: number,
  capFaceToken: number,
) {
  const source = readOriginalForeignEnvelopeScopedFloor(census, nativeFloorId),
    bytes = source.originalGElementFrameBytes,
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    n = v.getUint32(12, true);
  if (
    bytes.length < 40 ||
    v.getUint32(0, true) !== nativeFloorId ||
    v.getUint32(4, true) !== 0 ||
    v.getUint16(16, true) !== 2246 ||
    n + 20 !== bytes.length ||
    v.getUint32(n + 16, true) !== n
  )
    throw Error("Original floor topology frame identity mismatch");
  let a = 1,
    b = 0;
  for (let i = 16; i < n + 16; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  if (
    (b * 65536 + a) >>> 0 !== v.getUint32(8, true) ||
    bytesToHex(sha256(bytes)) !== source.originalGElementFrameSha256
  )
    throw Error("Original floor topology checksum mismatch");
  const root = decodeRevit2027FramedGRepRoot(
    bytes,
    {
      offset: 0,
      elementId: nativeFloorId,
      marker: 2246,
      objectLength: n,
      typeCode: v.getUint32(18, true),
    },
    2027,
  );
  if (!root.ok) throw Error(root.error);
  if (root.value.objectType !== 3 || ![0, 2].includes(root.value.flags))
    throw Error("Unsupported source Floor topology frame semantics");
  const replay = replayRevit2027GRepFifo(bytes, root.value);
  if (!replay.ok) throw Error(replay.error);
  return {
    ...inspectReciprocalCapSideTopology(replay.value, capFaceToken),
    nativeFloorId,
    sourceModelSha256: source.sourceModelSha256,
    sourceSchemaSha256: source.sourceSchemaSha256,
    sourceFrameSha256s: {
      floor: source.originalFloorFrameSha256,
      geometry: source.originalGElementFrameSha256,
    },
    sourceBoundOriginalOperands: true as const,
  };
}

/** One original-context snapshot for a complete requested tread-cap batch. */
export function inspectOriginalNativeStairCapSideTopologies(
  context: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
  capFaceTokens: readonly number[],
) {
  if (
    !capFaceTokens.length ||
    capFaceTokens.length > 1024 ||
    new Set(capFaceTokens).size !== capFaceTokens.length
  )
    throw Error("Invalid original cap topology batch");
  const source = readOriginalNativeStairPhysicalSource(context, nativeRunId);
  return capFaceTokens.map((capFaceToken) => ({
    ...inspectReciprocalCapSideTopology(
      source.physicalDefinition,
      capFaceToken,
    ),
    nativeStairId: source.nativeStairId,
    nativeRunId,
    nativeDefinitionId: source.nativeDefinitionId,
    sourceModelSha256: source.sourceModelSha256,
    sourceSchemaSha256: source.sourceSchemaSha256,
    sourceFrameSha256s: structuredClone(source.sourceFrameSha256s),
    sourceBoundOriginalOperands: true as const,
  }));
}
