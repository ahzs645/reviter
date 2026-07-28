/**
 * Targeted clean-room audit for the two persisted SurfRev faces owned by the
 * exact UNBC element 245109.
 *
 * This script replays the complete direct Geometry FIFO so that token identity,
 * face-loop membership, UV samples, analytic surfaces, and GArc profiles are
 * read from the RVT rather than inferred from the IFC.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-surfrev-feasibility.ts model.rvt
 */
import { readFileSync } from "node:fs";

import CFB from "cfb";

import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import { readInstancePlacement } from "../lib/reviter/instanced-geometry.ts";
import { tessellateRevit2027ArcSurfRev } from "../lib/reviter/revit-2027-arc-surfrev.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import {
  decodeRevit2027EdgeLoopStatic,
  decodeRevit2027EdgeLoopWithChainEnvelopesStatic,
  REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  type Revit2027EdgeLoopStatic,
} from "../lib/reviter/revit-2027-edge-loop-static.ts";
import {
  decodeRevit2027GEdgeStatic,
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
  type Revit2027EdgePoint,
  type Revit2027GEdgeStatic,
} from "../lib/reviter/revit-2027-edge-1423.ts";
import {
  decodeRevit2027FaceStatic,
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  type Revit2027FaceStatic,
} from "../lib/reviter/revit-2027-face-static.ts";
import {
  decodeRevit2027FillPatternData,
  REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-fill-pattern-data.ts";
import {
  decodeRevit2027FillGrid,
  REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-fill-grid.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  decodeRevit2027GFilling,
  REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gfilling.ts";
import {
  decodeRevit2027GArc,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
  type Revit2027GArc,
} from "../lib/reviter/revit-2027-garc.ts";
import {
  decodeRevit2027GeometryStatic,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-geometry.ts";
import {
  decodeRevit2027AnalyticSurface,
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  type Revit2027AnalyticSurface,
  type Revit2027SurfaceOfRevolution,
} from "../lib/reviter/revit-2027-surfaces.ts";

const TARGET_ELEMENT_ID = 245109;
const MAX_OWNER_QUEUE = 1_000_000;
const SURFACE_SLOTS = new Set([
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
]);

type QueueRole =
  | "geometry-face"
  | "geometry-edge"
  | "geometry-shared-surface"
  | "face-first-loop"
  | "face-region"
  | "face-foreground-filling"
  | "face-background-filling"
  | "face-surface"
  | "loop-next"
  | "filling-data"
  | "fill-grid"
  | "surface-curve";

type QueueItem = {
  entry: CondInt16QueueEntry;
  role: QueueRole;
  faceToken: number | null;
  parentToken: number | null;
};

type TokenNamespace = {
  nextPositiveToken: number;
  reservedStaticTokens: Set<number>;
  propertySourceSlots: Map<number, number>;
};

type LoopRecord = {
  token: number;
  sourceClassSlot: number;
  faceToken: number | null;
  value: Revit2027EdgeLoopStatic;
  chainStartEdgeReferences: readonly number[];
};

type ArcRecord = {
  token: number;
  faceToken: number | null;
  parentToken: number | null;
  value: Revit2027GArc;
};

type WalkedEdge = {
  token: number;
  side: 0 | 1;
  nextToken: number;
  previousToken: number;
  firstUv: readonly [number, number];
  interiorUvs: readonly (readonly [number, number])[];
  lastUv: readonly [number, number];
  flags: number;
};

type LoopWalk = {
  status: string;
  edges: WalkedEdge[];
};

type Owner = {
  faces: Map<number, Revit2027FaceStatic>;
  edges: Map<number, Revit2027GEdgeStatic>;
  loops: Map<number, LoopRecord>;
  surfacesByFace: Map<number, Revit2027AnalyticSurface>;
  arcs: ArcRecord[];
  tokenNamespace: TokenNamespace;
  queueLength: number;
  endOffset: number;
  ownerEndOffset: number;
};

function requireTokens(
  entries: readonly CondInt16QueueEntry[],
  state: TokenNamespace,
): { ok: true; appended: readonly CondInt16QueueEntry[] } | {
  ok: false;
  error: string;
} {
  const appended: CondInt16QueueEntry[] = [];
  for (const entry of entries) {
    if (entry.token === 0 || entry.sourceClassSlot == null) {
      return { ok: false, error: "queued append list contains null" };
    }
    if (entry.token === -1) {
      appended.push(entry);
      continue;
    }
    if (entry.token < -1) {
      return {
        ok: false,
        error: `unproven negative queue token ${entry.token}`,
      };
    }
    const existing = state.propertySourceSlots.get(entry.token);
    if (existing != null) {
      if (existing !== entry.sourceClassSlot) {
        return {
          ok: false,
          error:
            `token ${entry.token} changed source slot from ${existing} ` +
            `to ${entry.sourceClassSlot}`,
        };
      }
      continue;
    }
    if (entry.token < state.nextPositiveToken) {
      if (!state.reservedStaticTokens.has(entry.token)) {
        return {
          ok: false,
          error:
            `token ${entry.token} is below ${state.nextPositiveToken} ` +
            "without a prior StaticInteger reservation",
        };
      }
      state.propertySourceSlots.set(entry.token, entry.sourceClassSlot);
      appended.push(entry);
      continue;
    }
    for (
      let skipped = state.nextPositiveToken;
      skipped < entry.token;
      skipped += 1
    ) {
      if (!state.reservedStaticTokens.has(skipped)) {
        return {
          ok: false,
          error: `token gap before ${entry.token} is not reserved at ${skipped}`,
        };
      }
    }
    state.propertySourceSlots.set(entry.token, entry.sourceClassSlot);
    state.nextPositiveToken = entry.token + 1;
    appended.push(entry);
  }
  return { ok: true, appended };
}

function reserveStaticTokens(
  state: TokenNamespace,
  tokens: readonly number[],
): void {
  for (const token of tokens) {
    if (token > 0) state.reservedStaticTokens.add(token);
  }
}

function faceChildren(
  face: Revit2027FaceStatic,
  faceToken: number,
): QueueItem[] {
  const result: QueueItem[] = [];
  const append = (
    entry: CondInt16QueueEntry,
    role: QueueRole,
  ): void => {
    if (entry.token !== 0) {
      result.push({
        entry,
        role,
        faceToken,
        parentToken: faceToken,
      });
    }
  };
  append(face.firstLoop, "face-first-loop");
  for (const region of face.faceRegions.entries) {
    append(region, "face-region");
  }
  append(face.foregroundFilling, "face-foreground-filling");
  append(face.backgroundFilling, "face-background-filling");
  append(face.surface, "face-surface");
  return result;
}

function replayOwner(
  data: Uint8Array,
  root: {
    children: readonly CondInt16QueueEntry[];
    dynamicPayloadOffset: number;
    dynamicPayloadEndOffset: number;
  },
  release: number,
): Owner {
  if (
    root.children.length !== 1 ||
    root.children[0]?.sourceClassSlot !== REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
  ) {
    throw new Error("target root is not a direct single-Geometry owner");
  }
  const tokenNamespace: TokenNamespace = {
    nextPositiveToken: 3,
    reservedStaticTokens: new Set(),
    propertySourceSlots: new Map(),
  };
  const rootTokens = requireTokens(root.children, tokenNamespace);
  if (!rootTokens.ok || rootTokens.appended.length !== 1) {
    throw new Error(
      `root token registration failed: ${
        rootTokens.ok ? "Geometry token was reused" : rootTokens.error
      }`,
    );
  }
  const geometry = decodeRevit2027GeometryStatic(
    data,
    root.dynamicPayloadOffset,
    root.dynamicPayloadEndOffset,
    release,
  );
  if (!geometry.ok) throw new Error(geometry.error);
  const geometryTokens = requireTokens(
    geometry.value.queuedProperties,
    tokenNamespace,
  );
  if (!geometryTokens.ok) {
    throw new Error(`Geometry tokens: ${geometryTokens.error}`);
  }

  const owner: Owner = {
    faces: new Map(),
    edges: new Map(),
    loops: new Map(),
    surfacesByFace: new Map(),
    arcs: [],
    tokenNamespace,
    queueLength: 0,
    endOffset: geometry.value.endOffset,
    ownerEndOffset: root.dynamicPayloadEndOffset,
  };
  const queue: QueueItem[] = [
    ...geometry.value.faces.entries.map((entry) => ({
      entry,
      role: "geometry-face" as const,
      faceToken: entry.token > 0 ? entry.token : null,
      parentToken: 3,
    })),
    ...geometry.value.edges.entries.map((entry) => ({
      entry,
      role: "geometry-edge" as const,
      faceToken: null,
      parentToken: 3,
    })),
    ...geometry.value.sharedSurfaceInfo.entries.map((entry) => ({
      entry,
      role: "geometry-shared-surface" as const,
      faceToken: null,
      parentToken: 3,
    })),
  ];
  let cursor = geometry.value.endOffset;
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    if (queue.length > MAX_OWNER_QUEUE) {
      throw new Error("owner queue exceeds safety bound");
    }
    const item = queue[queueIndex]!;
    const token = item.entry.token;
    const slot = item.entry.sourceClassSlot!;
    let endOffset = cursor;
    let children: QueueItem[] = [];
    let staticReferences: readonly number[] = [];

    if (slot === REVIT_2027_FACE_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027FaceStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      if (token <= 0) throw new Error("Face lacks positive token identity");
      owner.faces.set(token, decoded.value);
      endOffset = decoded.value.endOffset;
      children = faceChildren(decoded.value, token);
    } else if (slot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027GEdgeStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      if (token <= 0) throw new Error("GEdge lacks positive token identity");
      owner.edges.set(token, decoded.value);
      endOffset = decoded.value.endOffset;
      staticReferences = [
        ...decoded.value.faceReferences,
        ...decoded.value.nextReferences,
        ...decoded.value.previousReferences,
      ];
    } else if (slot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027EdgeLoopStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      if (token <= 0) throw new Error("EdgeLoop lacks positive token identity");
      owner.loops.set(token, {
        token,
        sourceClassSlot: slot,
        faceToken: item.faceToken,
        value: decoded.value,
        chainStartEdgeReferences: [],
      });
      endOffset = decoded.value.endOffset;
      staticReferences = decoded.value.staticReferences;
      if (decoded.value.nextLoop.token !== 0) {
        children = [{
          entry: decoded.value.nextLoop,
          role: "loop-next",
          faceToken: item.faceToken,
          parentToken: token,
        }];
      }
    } else if (slot === REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      if (token <= 0) {
        throw new Error(
          "EdgeLoopWithChainEnvelopes lacks positive token identity",
        );
      }
      owner.loops.set(token, {
        token,
        sourceClassSlot: slot,
        faceToken: item.faceToken,
        value: decoded.value.loop,
        chainStartEdgeReferences: decoded.value.chains.map(
          (chain) => chain.startEdgeReference,
        ),
      });
      endOffset = decoded.value.endOffset;
      staticReferences = decoded.value.staticReferences;
      if (decoded.value.loop.nextLoop.token !== 0) {
        children = [{
          entry: decoded.value.loop.nextLoop,
          role: "loop-next",
          faceToken: item.faceToken,
          parentToken: token,
        }];
      }
    } else if (slot === REVIT_2027_GFILLING_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027GFilling(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      endOffset = decoded.value.endOffset;
      reserveStaticTokens(tokenNamespace, [decoded.value.faceIdReference]);
      if (decoded.value.data.token !== 0) {
        children = [{
          entry: decoded.value.data,
          role: "filling-data",
          faceToken: item.faceToken,
          parentToken: token > 0 ? token : null,
        }];
      }
    } else if (slot === REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027FillPatternData(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      endOffset = decoded.value.endOffset;
      children = decoded.value.queuedProperties.map((entry) => ({
        entry,
        role: "fill-grid" as const,
        faceToken: item.faceToken,
        parentToken: token > 0 ? token : null,
      }));
    } else if (slot === REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027FillGrid(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      endOffset = decoded.value.endOffset;
    } else if (slot === REVIT_2027_GARC_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027GArc(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      owner.arcs.push({
        token,
        faceToken: item.faceToken,
        parentToken: item.parentToken,
        value: decoded.value,
      });
      endOffset = decoded.value.endOffset;
    } else if (SURFACE_SLOTS.has(slot)) {
      const decoded = decodeRevit2027AnalyticSurface(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
        slot,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      endOffset = decoded.value.endOffset;
      if (item.faceToken != null && item.role === "face-surface") {
        owner.surfacesByFace.set(item.faceToken, decoded.value);
      }
      children = decoded.value.queuedProperties.map((entry) => ({
        entry,
        role: "surface-curve" as const,
        faceToken: item.faceToken,
        parentToken: token > 0 ? token : null,
      }));
    } else {
      throw new Error(
        `blocked at ${item.role}:${slot}:${
          token === -1 ? "sentinel" : "numbered"
        }`,
      );
    }

    const tokenResult = requireTokens(
      children.map(({ entry }) => entry),
      tokenNamespace,
    );
    if (!tokenResult.ok) {
      throw new Error(`${slot} child tokens: ${tokenResult.error}`);
    }
    const appended = new Set(tokenResult.appended);
    reserveStaticTokens(tokenNamespace, staticReferences);
    queue.push(...children.filter(({ entry }) => appended.has(entry)));
    cursor = endOffset;
  }
  owner.queueLength = queue.length;
  owner.endOffset = cursor;
  if (cursor !== root.dynamicPayloadEndOffset) {
    throw new Error(
      `owner queue leaves ${root.dynamicPayloadEndOffset - cursor} bytes`,
    );
  }
  return owner;
}

function faceSide(edge: Revit2027GEdgeStatic, faceToken: number): 0 | 1 {
  const first = edge.faceReferences[0] === faceToken;
  const second = edge.faceReferences[1] === faceToken;
  if (first === second) {
    throw new Error(
      `edge references face ${faceToken} ${first ? "twice" : "zero times"}`,
    );
  }
  return first ? 0 : 1;
}

function uvForSide(
  point: Revit2027EdgePoint,
  side: 0 | 1,
): readonly [number, number] {
  return side === 0 ? point.firstFaceUv : point.secondFaceUv;
}

function walkLoop(
  owner: Owner,
  loop: LoopRecord,
): LoopWalk {
  const result: WalkedEdge[] = [];
  const visited = new Set<number>();
  let token = loop.value.nextEdgeReference;
  while (token !== loop.token) {
    if (visited.has(token)) {
      return { status: "cycle-before-loop-sentinel", edges: result };
    }
    visited.add(token);
    const edge = owner.edges.get(token);
    if (!edge) return { status: `unresolved-edge-${token}`, edges: result };
    const side = faceSide(edge, loop.value.faceReference);
    result.push({
      token,
      side,
      nextToken: edge.nextReferences[side],
      previousToken: edge.previousReferences[side],
      firstUv: uvForSide(edge.firstAndLastEdgePoints[0], side),
      interiorUvs: edge.interiorEdgePoints.map((point) =>
        uvForSide(point, side)
      ),
      lastUv: uvForSide(edge.firstAndLastEdgePoints[1], side),
      flags: edge.flags,
    });
    token = edge.nextReferences[side];
    if (result.length > owner.edges.size) {
      return { status: "safety-bound", edges: result };
    }
  }
  return {
    status:
      result.at(-1)?.token === loop.value.previousEdgeReference
        ? "closed"
        : "closed-last-edge-mismatch",
    edges: result,
  };
}

function near(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function certifyAndTessellateRectangle(
  surface: Revit2027SurfaceOfRevolution,
  profile: Revit2027GArc,
  loop: Revit2027EdgeLoopStatic,
  graph: LoopWalk,
): object {
  const tolerance = 1e-9;
  if (graph.status !== "closed" || graph.edges.length !== 4) {
    return {
      certified: false,
      reason: "trim is not one closed four-edge loop",
    };
  }
  const minimumUv = loop.envelope.minimum;
  const maximumUv = loop.envelope.maximum;
  const envelope = surface.surface.envelope;
  if (
    !near(minimumUv[0], envelope.firstCorner[0], tolerance) ||
    !near(minimumUv[1], envelope.firstCorner[1], tolerance) ||
    !near(maximumUv[0], envelope.secondCorner[0], tolerance) ||
    !near(maximumUv[1], envelope.secondCorner[1], tolerance)
  ) {
    return {
      certified: false,
      reason: "loop and surface envelopes differ",
    };
  }

  const sideSegments = new Map<string, number>();
  for (const edge of graph.edges) {
    const points = [edge.firstUv, ...edge.interiorUvs, edge.lastUv];
    const allNear = (axis: 0 | 1, value: number): boolean =>
      points.every((point) => near(point[axis], value, tolerance));
    const side =
      allNear(0, minimumUv[0])
        ? "u-min"
        : allNear(0, maximumUv[0])
          ? "u-max"
          : allNear(1, minimumUv[1])
            ? "v-min"
            : allNear(1, maximumUv[1])
              ? "v-max"
              : null;
    if (!side) {
      return {
        certified: false,
        reason: `edge ${edge.token} is not a constant envelope boundary`,
      };
    }
    if (sideSegments.has(side)) {
      return {
        certified: false,
        reason: `rectangle side ${side} occurs more than once`,
      };
    }
    sideSegments.set(side, points.length - 1);
  }
  for (const side of ["u-min", "u-max", "v-min", "v-max"]) {
    if (!sideSegments.has(side)) {
      return {
        certified: false,
        reason: `rectangle side ${side} is missing`,
      };
    }
  }
  const revolutionSegments = sideSegments.get("v-min")!;
  const profileSegments = sideSegments.get("u-min")!;
  if (
    revolutionSegments !== sideSegments.get("v-max") ||
    profileSegments !== sideSegments.get("u-max")
  ) {
    return {
      certified: false,
      reason: "opposite rectangle sides have different persisted sampling",
    };
  }
  const tessellated = tessellateRevit2027ArcSurfRev({
    surface,
    profile,
    minimumUv,
    maximumUv,
    revolutionSegments,
    profileSegments,
    tolerance,
  });
  if (!tessellated.ok) {
    return { certified: false, reason: tessellated.error };
  }
  const minimum: [number, number, number] = [
    Infinity,
    Infinity,
    Infinity,
  ];
  const maximum: [number, number, number] = [
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  for (
    let index = 0;
    index < tessellated.mesh.positions.length;
    index += 3
  ) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(
        minimum[axis]!,
        tessellated.mesh.positions[index + axis]!,
      );
      maximum[axis] = Math.max(
        maximum[axis]!,
        tessellated.mesh.positions[index + axis]!,
      );
    }
  }
  return {
    certified: true,
    tolerance,
    sides: Object.fromEntries(sideSegments),
    revolutionSegments,
    profileSegments,
    mesh: {
      positions: tessellated.mesh.positions.length / 3,
      triangles: tessellated.mesh.indices.length / 3,
      minimum,
      maximum,
    },
  };
}

function loopChain(owner: Owner, face: Revit2027FaceStatic): LoopRecord[] {
  const result: LoopRecord[] = [];
  const seen = new Set<number>();
  let token = face.firstLoop.token;
  while (token > 0 && !seen.has(token)) {
    seen.add(token);
    const loop = owner.loops.get(token);
    if (!loop) throw new Error(`unresolved loop token ${token}`);
    result.push(loop);
    token = loop.value.nextLoop.token;
  }
  if (token !== 0) throw new Error(`invalid loop chain terminator ${token}`);
  return result;
}

function surfaceResult(
  owner: Owner,
  faceToken: number,
  face: Revit2027FaceStatic,
  surface: Revit2027SurfaceOfRevolution,
): object {
  const loopRecords = loopChain(owner, face);
  const loops = loopRecords.map((loop) => {
    const graph = walkLoop(owner, loop);
    return {
      token: loop.token,
      sourceClassSlot: loop.sourceClassSlot,
      faceToken: loop.faceToken,
      persistedFaceReference: loop.value.faceReference,
      envelope: loop.value.envelope,
      open: loop.value.open,
      chainStartEdgeReferences: loop.chainStartEdgeReferences,
      graph,
    };
  });
  const profile = owner.arcs.find((arc) => arc.faceToken === faceToken);
  return {
    faceToken,
    faceFlags: face.faceFlags,
    surfaceDescriptor: face.surface,
    surface,
    profile: profile
      ? {
          token: profile.token,
          parentToken: profile.parentToken,
          byteOffset: profile.value.byteOffset,
          endOffset: profile.value.endOffset,
          endParameters: profile.value.endParameters,
          xDirection: profile.value.xDirection,
          yDirection: profile.value.yDirection,
          radius: profile.value.radius,
          center: profile.value.center,
          isFilled: profile.value.isFilled,
        }
      : null,
    loops,
    rectangularSubset:
      profile && loopRecords.length === 1
        ? certifyAndTessellateRectangle(
            surface,
            profile.value,
            loopRecords[0]!.value,
            loops[0]!.graph,
          )
        : {
            certified: false,
            reason:
              profile == null
                ? "profile body is unavailable"
                : "face has more than one trim loop",
          },
  };
}

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types " +
      "scripts/audit-revit-2027-surfrev-feasibility.ts model.rvt",
  );
}
const cfb = CFB.read(readFileSync(modelPath), { type: "buffer" });
const basicFileInfo = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .find(({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/i.test(path));
if (!basicFileInfo) throw new Error("RVT has no BasicFileInfo stream");
const release = revitVersionFromBasicFileInfo(
  asBytes(basicFileInfo.entry.content),
);
if (release !== 2027) {
  throw new Error(`audit requires Revit 2027, received ${release ?? "unknown"}`);
}

let result: object | null = null;
const targetPlacements = [];
const partitions = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
  );
for (const [partitionIndex, partition] of partitions.entries()) {
  const stored = stripRevitPageChecksums(asBytes(partition.entry.content));
  const offsets = gzipOffsets(stored);
  let dictionary: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      dictionary,
    );
    const inflated =
      read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        dictionary,
      );
    if (!inflated) continue;
    if (read) dictionary = revitWindowTail(read);
    for (const frame of scanFramedElementObjects(inflated)) {
      const placement = readInstancePlacement(inflated, frame);
      if (placement?.geometryId === TARGET_ELEMENT_ID) {
        targetPlacements.push(placement);
      }
      if (
        result != null ||
        frame.elementId !== TARGET_ELEMENT_ID ||
        frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER
      ) {
        continue;
      }
      const root = decodeRevit2027FramedGRepRoot(inflated, frame, release);
      if (!root.ok) throw new Error(root.error);
      const owner = replayOwner(inflated, root.value, release);
      const surfaces = [...owner.surfacesByFace]
        .flatMap(([faceToken, surface]) => {
          if (surface.kind !== "surface-of-revolution") return [];
          const face = owner.faces.get(faceToken);
          if (!face) throw new Error(`missing face ${faceToken}`);
          return [surfaceResult(owner, faceToken, face, surface)];
        });
      result = {
        modelPath,
        release,
        targetElementId: TARGET_ELEMENT_ID,
        location: {
          partitionIndex,
          partitionPath: partition.path,
          chunkIndex,
          frameOffset: frame.offset,
          dynamicPayloadOffset: root.value.dynamicPayloadOffset,
          dynamicPayloadEndOffset: root.value.dynamicPayloadEndOffset,
        },
        replay: {
          queueLength: owner.queueLength,
          queueExhausted: owner.endOffset === owner.ownerEndOffset,
          faces: owner.faces.size,
          edges: owner.edges.size,
          loops: owner.loops.size,
          arcs: owner.arcs.length,
          reservedStaticTokens: owner.tokenNamespace.reservedStaticTokens.size,
          materializedPositiveTokens:
            owner.tokenNamespace.propertySourceSlots.size,
        },
        surfaces,
      };
    }
  }
}
if (!result) {
  throw new Error(`element ${TARGET_ELEMENT_ID} was not found`);
}
console.log(JSON.stringify({ ...result, targetPlacements }, null, 2));
