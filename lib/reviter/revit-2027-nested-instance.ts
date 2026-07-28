import type { RevitTransform3d } from "./dynamic-geometry-queue.ts";
import {
  REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
  REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT,
  type Revit2027GInstance,
  type Revit2027InstanceInfo,
} from "./revit-2027-ginstance.ts";
import type {
  Revit2027GRepReplay,
  Revit2027GRepReplayPath,
  Revit2027GRepReplaySpan,
} from "./revit-2027-grep-replay.ts";

const GINSTANCE_READER_ID = "Revit2027GInstance";
const INSTANCE_INFO_READER_ID = "Revit2027InstanceInfo";
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_OCCURRENCES = 1_000_000;
const DEFAULT_MAX_TRAVERSALS = 1_000_000;

export type Revit2027NestedInstance = {
  ownerElementId: bigint;
  instanceReplayIndex: number;
  instanceInfoReplayIndex: number;
  path: Revit2027GRepReplayPath;
  symbolElementId: bigint;
  gRepId: number;
  cda: number;
  transform: RevitTransform3d;
  tagElementId: bigint;
  forbiddenTarget: number;
  resolveSymbolInView: boolean;
  hasScale: boolean;
};

export type Revit2027NestedInstanceCollectionResult =
  | { ok: true; value: readonly Revit2027NestedInstance[] }
  | { ok: false; error: string };

export type Revit2027NestedMeshOwner<TGeometry> = {
  ownerElementId: bigint;
  /**
   * Independently certified geometry owned directly by this element. Null
   * means that this owner can contribute geometry only through instances.
   */
  geometry: TGeometry | null;
  nestedInstances: readonly Revit2027NestedInstance[];
};

export type Revit2027NestedMeshOccurrence<TGeometry> = {
  rootOwnerElementId: bigint;
  geometryOwnerElementId: bigint;
  geometry: TGeometry;
  /** Outer-to-inner instance chain leading to this shared geometry. */
  chain: readonly Revit2027NestedInstance[];
  /** Column-major `outer * ... * inner` affine transform. */
  transform: RevitTransform3d["matrix"];
};

export type Revit2027NestedMeshComposition<TGeometry> = {
  rootOwnerElementId: bigint;
  occurrences: readonly Revit2027NestedMeshOccurrence<TGeometry>[];
};

export type Revit2027NestedMeshCompositionResult<TGeometry> =
  | { ok: true; value: Revit2027NestedMeshComposition<TGeometry> }
  | { ok: false; error: string };

export type Revit2027NestedMeshCompositionOptions = {
  maxDepth?: number;
  maxOccurrences?: number;
  maxTraversals?: number;
};

const IDENTITY: RevitTransform3d["matrix"] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function validInt32(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= -0x8000_0000 &&
    (value as number) <= 0x7fff_ffff
  );
}

function validMatrix(value: unknown): value is RevitTransform3d["matrix"] {
  return (
    Array.isArray(value) &&
    value.length === 16 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry)) &&
    value[3] === 0 &&
    value[7] === 0 &&
    value[11] === 0 &&
    value[15] === 1
  );
}

function asGInstance(value: unknown): Revit2027GInstance | null {
  const candidate = record(value);
  const instanceInfo = record(candidate?.instanceInfo);
  if (
    candidate == null ||
    typeof candidate.byteOffset !== "number" ||
    typeof candidate.endOffset !== "number" ||
    typeof candidate.tagElementId !== "bigint" ||
    !validInt32(candidate.forbiddenTarget) ||
    typeof candidate.resolveSymbolInView !== "boolean" ||
    typeof candidate.hasScale !== "boolean" ||
    instanceInfo == null ||
    instanceInfo.token !== -1 ||
    instanceInfo.sourceClassSlot !==
      REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT ||
    !Number.isSafeInteger(instanceInfo.byteOffset) ||
    !Number.isSafeInteger(instanceInfo.endOffset)
  ) {
    return null;
  }
  return value as Revit2027GInstance;
}

function asInstanceInfo(value: unknown): Revit2027InstanceInfo | null {
  const candidate = record(value);
  const transform = record(candidate?.transform);
  if (
    candidate == null ||
    typeof candidate.byteOffset !== "number" ||
    typeof candidate.endOffset !== "number" ||
    typeof candidate.symbolElementId !== "bigint" ||
    !validInt32(candidate.gRepId) ||
    !validInt32(candidate.cda) ||
    transform == null ||
    !validMatrix(transform.matrix)
  ) {
    return null;
  }
  return value as Revit2027InstanceInfo;
}

function pathIsFirstChild(
  parent: Revit2027GRepReplayPath,
  child: Revit2027GRepReplayPath,
): boolean {
  return (
    child.length === parent.length + 1 &&
    parent.every((entry, index) => child[index] === entry) &&
    child[child.length - 1] === 0
  );
}

/**
 * Pair every exact GInstance replay span with the InstanceInfo body appended by
 * its token--1 descriptor. Pairing uses the replay parent index and descriptor
 * offsets, never adjacency: older siblings can occur between the two bodies.
 */
export function collectRevit2027NestedInstances(
  replay: Revit2027GRepReplay,
): Revit2027NestedInstanceCollectionResult {
  const instanceSpans = replay.spans.filter(
    (span) =>
      span.readerId === GINSTANCE_READER_ID &&
      span.propertySourceClassSlot ===
        REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
  );
  const infoByParent = new Map<number, Revit2027GRepReplaySpan[]>();
  for (const span of replay.spans) {
    if (
      span.readerId !== INSTANCE_INFO_READER_ID ||
      span.propertySourceClassSlot !==
        REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT ||
      span.parentReplayIndex == null
    ) {
      continue;
    }
    const siblings = infoByParent.get(span.parentReplayIndex) ?? [];
    siblings.push(span);
    infoByParent.set(span.parentReplayIndex, siblings);
  }

  const result: Revit2027NestedInstance[] = [];
  for (const instanceSpan of instanceSpans) {
    const instance = asGInstance(instanceSpan.value);
    if (!instance) {
      return {
        ok: false,
        error:
          `GInstance replay ${instanceSpan.replayIndex} has an invalid exact-reader value`,
      };
    }
    const infoSpans = infoByParent.get(instanceSpan.replayIndex) ?? [];
    if (infoSpans.length !== 1) {
      return {
        ok: false,
        error:
          `GInstance replay ${instanceSpan.replayIndex} has ${infoSpans.length} ` +
          "InstanceInfo children instead of exactly one",
      };
    }
    const infoSpan = infoSpans[0]!;
    const info = asInstanceInfo(infoSpan.value);
    if (!info) {
      return {
        ok: false,
        error:
          `InstanceInfo replay ${infoSpan.replayIndex} has an invalid exact-reader value`,
      };
    }
    if (
      infoSpan.propertyToken !== -1 ||
      infoSpan.descriptorOffset !== instance.instanceInfo.byteOffset ||
      infoSpan.descriptorEndOffset !== instance.instanceInfo.endOffset ||
      !pathIsFirstChild(instanceSpan.path, infoSpan.path)
    ) {
      return {
        ok: false,
        error:
          `InstanceInfo replay ${infoSpan.replayIndex} does not match its ` +
          `GInstance ${instanceSpan.replayIndex} descriptor and path`,
      };
    }
    if (info.symbolElementId <= 0n) {
      return {
        ok: false,
        error:
          `InstanceInfo replay ${infoSpan.replayIndex} has a null or negative symbol id`,
      };
    }
    result.push({
      ownerElementId: replay.ownerElementId,
      instanceReplayIndex: instanceSpan.replayIndex,
      instanceInfoReplayIndex: infoSpan.replayIndex,
      path: instanceSpan.path,
      symbolElementId: info.symbolElementId,
      gRepId: info.gRepId,
      cda: info.cda,
      transform: info.transform,
      tagElementId: instance.tagElementId,
      forbiddenTarget: instance.forbiddenTarget,
      resolveSymbolInView: instance.resolveSymbolInView,
      hasScale: instance.hasScale,
    });
  }
  return { ok: true, value: result };
}

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function multiply(
  left: RevitTransform3d["matrix"],
  right: RevitTransform3d["matrix"],
): RevitTransform3d["matrix"] | null {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += left[index * 4 + row]! * right[column * 4 + index]!;
      }
      if (!Number.isFinite(value)) return null;
      result[column * 4 + row] = value;
    }
  }
  return result as unknown as RevitTransform3d["matrix"];
}

/**
 * Resolve a root owner into reusable geometry occurrences by following exact
 * `InstanceInfo.m_symbolId` links.
 *
 * Native `OdBmInstanceInfoImpl::getGeometryWithOpts` opens `m_symbolId` as an
 * element and asks it for geometry. Native nested marker traversal composes
 * matrices as `instanceTrf * nestedTrf`; this routine preserves that order.
 * Nonzero GRep selectors and view-dependent symbol resolution remain rejected
 * because those transitions are not yet reconstructed for the browser.
 */
export function composeRevit2027NestedMesh<TGeometry>(
  rootOwnerElementId: bigint,
  ownerDefinitions: Iterable<Revit2027NestedMeshOwner<TGeometry>>,
  options: Revit2027NestedMeshCompositionOptions = {},
): Revit2027NestedMeshCompositionResult<TGeometry> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxOccurrences = options.maxOccurrences ?? DEFAULT_MAX_OCCURRENCES;
  const maxTraversals = options.maxTraversals ?? DEFAULT_MAX_TRAVERSALS;
  if (
    !validLimit(maxDepth) ||
    !validLimit(maxOccurrences) ||
    !validLimit(maxTraversals) ||
    rootOwnerElementId <= 0n
  ) {
    return {
      ok: false,
      error: "nested instance composition options or root owner id are invalid",
    };
  }

  const owners = new Map<bigint, Revit2027NestedMeshOwner<TGeometry>>();
  for (const owner of ownerDefinitions) {
    if (
      owner.ownerElementId <= 0n ||
      !Array.isArray(owner.nestedInstances)
    ) {
      return {
        ok: false,
        error: "nested instance owner definition is invalid",
      };
    }
    if (owners.has(owner.ownerElementId)) {
      return {
        ok: false,
        error: `duplicate nested instance owner ${owner.ownerElementId}`,
      };
    }
    owners.set(owner.ownerElementId, owner);
  }
  if (!owners.has(rootOwnerElementId)) {
    return {
      ok: false,
      error: `nested instance root owner ${rootOwnerElementId} is missing`,
    };
  }

  const occurrences: Revit2027NestedMeshOccurrence<TGeometry>[] = [];
  let traversals = 0;
  const visit = (
    ownerElementId: bigint,
    transform: RevitTransform3d["matrix"],
    chain: readonly Revit2027NestedInstance[],
    activeOwners: readonly bigint[],
  ): string | null => {
    if (activeOwners.length > maxDepth) {
      return `nested instance depth exceeds ${maxDepth}`;
    }
    if (activeOwners.includes(ownerElementId)) {
      return (
        "nested instance owner cycle: " +
        [...activeOwners, ownerElementId].join(" -> ")
      );
    }
    const owner = owners.get(ownerElementId);
    if (!owner) {
      return `nested instance symbol target ${ownerElementId} is missing`;
    }
    const nextActiveOwners = [...activeOwners, ownerElementId];
    if (owner.geometry !== null) {
      if (occurrences.length >= maxOccurrences) {
        return `nested instance occurrence count exceeds ${maxOccurrences}`;
      }
      occurrences.push({
        rootOwnerElementId,
        geometryOwnerElementId: ownerElementId,
        geometry: owner.geometry,
        chain,
        transform,
      });
    }
    const seenReplayIndices = new Set<number>();
    for (const instance of owner.nestedInstances) {
      traversals += 1;
      if (traversals > maxTraversals) {
        return `nested instance traversal count exceeds ${maxTraversals}`;
      }
      if (
        instance.ownerElementId !== ownerElementId ||
        seenReplayIndices.has(instance.instanceReplayIndex)
      ) {
        return `nested instance definitions conflict for owner ${ownerElementId}`;
      }
      seenReplayIndices.add(instance.instanceReplayIndex);
      if (instance.gRepId !== 0) {
        return (
          `nested instance ${instance.instanceReplayIndex} uses unsupported ` +
          `GRep selector ${instance.gRepId}`
        );
      }
      if (instance.cda !== 1) {
        return (
          `nested instance ${instance.instanceReplayIndex} uses unsupported ` +
          `CDA selector ${instance.cda}`
        );
      }
      if (instance.hasScale) {
        return (
          `nested instance ${instance.instanceReplayIndex} requires ` +
          "unsupported scale-bearing symbol resolution"
        );
      }
      if (instance.resolveSymbolInView) {
        return (
          `nested instance ${instance.instanceReplayIndex} requires ` +
          "view-dependent symbol resolution"
        );
      }
      const composed = multiply(transform, instance.transform.matrix);
      if (!composed) {
        return `nested instance ${instance.instanceReplayIndex} transform overflowed`;
      }
      const error = visit(
        instance.symbolElementId,
        composed,
        [...chain, instance],
        nextActiveOwners,
      );
      if (error) return error;
    }
    return null;
  };

  const error = visit(rootOwnerElementId, IDENTITY, [], []);
  if (error) return { ok: false, error };
  if (occurrences.length === 0) {
    return {
      ok: false,
      error:
        `nested instance root owner ${rootOwnerElementId} resolves to no ` +
        "certified geometry",
    };
  }
  return {
    ok: true,
    value: { rootOwnerElementId, occurrences },
  };
}
