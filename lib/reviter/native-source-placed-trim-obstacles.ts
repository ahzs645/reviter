/** New unwired orientation-independent placed planar obstruction proof.
 * Complete original selected source geometry is bounded through its exact
 * planar trims and twin endpoint embeddings. This grants no support, access,
 * stair-kinematic or runtime admission authority. */
/** Unwired source-owned obstruction envelopes. Never walking support or access approval. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openRevitContainer } from "./convert-container.ts";
import {
  activeClassTagTranslation,
  setActiveClassTagTranslation,
} from "./revit-class-tags.ts";
import {
  activeElementIdBytes,
  setActiveElementIdBytes,
} from "./element-id-width.ts";
import {
  asBytes,
  stripRevitPageChecksums,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
} from "./revit-container.ts";
import { createSplitFrameStream } from "./split-frame-stream.ts";
import { scanElementHeaders } from "./element-headers.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import { originalDefault3dDirectionSelection } from "./native-source-direction-selection.ts";
import {
  Rational,
  rational,
  type NativeRationalParts,
  nativeRationalOverlay,
} from "./native-rational-overlay.ts";
import { freezeNativeRationalParts } from "./native-exact-planar-topology.ts";
import { readInstancePlacement } from "./instanced-geometry.ts";
import { inspectOriginalWallTrimObstacleBranches } from "./native-source-wall-trim-obstacles.ts";

type Request = { nativeElementId: number; nativeDefinitionId?: number };
const hash = (b: Uint8Array) => bytesToHex(sha256(b));
const validId = (n: number) =>
  Number.isSafeInteger(n) && n > 0 && n <= 0xffff_ffff;
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const brand: unique symbol = Symbol("OriginalPlacedTrimObstacleContext");
export type OriginalPlacedTrimObstacleContext = {
  readonly [brand]: true;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly completeSourcePages: number;
};
type Stored = {
  frames: Map<string, Uint8Array>;
  categories: Map<number, Set<number | null>>;
  requests: readonly Request[];
  translation: ReturnType<typeof activeClassTagTranslation>;
  idBytes: ReturnType<typeof activeElementIdBytes>;
};
const contexts = new WeakMap<OriginalPlacedTrimObstacleContext, Stored>();

/** An absent, null or contradictory original declaration is unresolved; a
 * later positive category cannot erase it. This relation grants no authority. */
export function consistentOriginalObstacleCategories(
  declarations: readonly (number | null)[],
  expected: number,
) {
  return (
    declarations.length > 0 &&
    declarations.every((category) => category === expected)
  );
}

/** Pure guard only; no caller bounds can construct an opaque source handle. */
export function originalOccurrenceBoundsAreFiniteOrdered(bounds: {
  valid: boolean;
  minimum: readonly number[];
  maximum: readonly number[];
}) {
  if (
    !bounds ||
    bounds.valid !== true ||
    !Array.isArray(bounds.minimum) ||
    !Array.isArray(bounds.maximum) ||
    bounds.minimum.length !== 3 ||
    bounds.maximum.length !== 3
  )
    return false;
  for (let i = 0; i < 3; i++) {
    if (!Object.hasOwn(bounds.minimum, i) || !Object.hasOwn(bounds.maximum, i))
      return false;
    const low = bounds.minimum[i],
      high = bounds.maximum[i];
    if (
      typeof low !== "number" ||
      typeof high !== "number" ||
      !Number.isFinite(low) ||
      !Number.isFinite(high) ||
      low > high
    )
      return false;
  }
  return true;
}

function checkedFrame(b: Uint8Array, id: number, marker: number) {
  if (b.length < 40) throw Error("Original frame is truncated");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength),
    length = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== id ||
    v.getUint32(4, true) !== 0 ||
    v.getUint16(16, true) !== marker ||
    length + 20 !== b.length ||
    v.getUint32(length + 16, true) !== length
  )
    throw Error("Original frame identity/length mismatch");
  let a = 1,
    c = 0;
  for (let i = 16; i < 16 + length; i++) {
    a = (a + b[i]!) % 65521;
    c = (c + a) % 65521;
  }
  if ((c * 65536 + a) >>> 0 !== v.getUint32(8, true))
    throw Error("Original frame checksum mismatch");
}
function sourceRoot(b: Uint8Array, id: number) {
  checkedFrame(b, id, 2246);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const root = decodeRevit2027FramedGRepRoot(
    b,
    {
      offset: 0,
      elementId: id,
      marker: 2246,
      objectLength: v.getUint32(12, true),
      typeCode: v.getUint32(18, true),
    },
    2027,
  );
  if (
    !root.ok ||
    root.value.objectType !== 3 ||
    ![0, 2].includes(root.value.flags)
  )
    throw Error("Unsupported original GElement body semantics");
  return root.value;
}
function decode(b: Uint8Array, id: number) {
  const r = replayRevit2027GRepFifo(b, sourceRoot(b, id), undefined, {
    maxReplayEntries: 100000,
    maxDescriptors: 400000,
  });
  if (!r.ok) throw Error(r.error);
  return r.value;
}

/** Only complete, checksum-checked original RVT bytes establish membership.
 * Neither caller-provided ASTs, render meshes nor self-hashed manifests can
 * construct this opaque context. Source decoder global state is restored. */
export function createOriginalPlacedTrimObstacleContext(
  original: Uint8Array,
  expectedSHA: string,
  requests: readonly Request[],
): OriginalPlacedTrimObstacleContext {
  if (
    !/^[a-f0-9]{64}$/.test(expectedSHA) ||
    requests.length > 64 ||
    requests.some(
      (r) =>
        !validId(r.nativeElementId) ||
        (r.nativeDefinitionId !== undefined && !validId(r.nativeDefinitionId)),
    ) ||
    new Set(requests.map((r) => r.nativeElementId)).size !== requests.length
  )
    throw Error("Invalid original placed obstacle request");
  const bytes = Uint8Array.from(original);
  if (hash(bytes) !== expectedSHA)
    throw Error("Original RVT checksum mismatch");
  const oldTranslation = activeClassTagTranslation(),
    oldWidth = activeElementIdBytes();
  try {
    const c = openRevitContainer(bytes, {});
    if (
      c.decoderPlan.revitVersion !== 2027 ||
      !c.nativeSourceSchemaBytes ||
      activeElementIdBytes() !== 8 ||
      !c.classTagTranslation.identity ||
      c.classTagTranslation.movedClasses
    )
      throw Error("Requires original canonical wide-ID Revit2027 schema");
    const wanted = new Set(
        requests.flatMap((r) =>
          r.nativeDefinitionId === undefined
            ? [r.nativeElementId]
            : [r.nativeElementId, r.nativeDefinitionId],
        ),
      ),
      frames = new Map<string, Uint8Array>(),
      categories = new Map<number, Set<number | null>>();
    let pages = 0,
      total = 0;
    for (const partition of c.partitions) {
      const stream = createSplitFrameStream({
        markers: [2246, 2031, 2064, 3899],
        minObjectLength: 40,
        maxFrameBytes: 64 * 1024 * 1024,
        crossingOnly: false,
        acceptHeader: (v, at) => wanted.has(v.getUint32(at, true)),
      });
      const data = stripRevitPageChecksums(asBytes(partition.entry.content)),
        offsets = gzipOffsets(data);
      if (offsets.length > 10000)
        throw Error("Original source page census exceeded");
      let window: Uint8Array | null = null;
      for (let i = 0; i < offsets.length; i++) {
        const page = inflateRevitChunk(
          data,
          offsets[i]!,
          offsets[i + 1],
          window,
        );
        if (!page) throw Error("Original source page failed inflation");
        window = revitWindowTail(page);
        pages++;
        for (const header of scanElementHeaders(page))
          if (wanted.has(header.elementId)) {
            const values =
              categories.get(header.elementId) ?? new Set<number | null>();
            values.add(header.categoryId);
            categories.set(header.elementId, values);
          }
        for (const f of stream.push(page)) {
          const b = Uint8Array.from(f.data);
          checkedFrame(b, f.elementId, f.marker);
          const key = `${f.elementId}:${f.marker}`;
          if (frames.has(key))
            throw Error("Duplicate original placed-body source frame");
          frames.set(key, b);
          total += b.length;
          if (total > 128 * 1024 * 1024)
            throw Error("Original placed-body byte census exceeded");
        }
      }
    }
    const context = Object.freeze({
      [brand]: true as const,
      sourceModelSha256: expectedSHA,
      sourceSchemaSha256: hash(c.nativeSourceSchemaBytes),
      completeSourcePages: pages,
    });
    contexts.set(context, {
      frames,
      categories,
      requests: structuredClone(requests),
      translation: c.classTagTranslation,
      idBytes: activeElementIdBytes(),
    });
    return context;
  } finally {
    setActiveClassTagTranslation(oldTranslation);
    setActiveElementIdBytes(oldWidth);
  }
}

export type PlacedTrimObstacleComponent = {
  originalGeometryToken: number;
  physicalFaceTokens: number[];
  outerPlanEnvelope: NativeRationalParts;
  minimumElevationFeet: Rational;
  maximumElevationFeet: Rational;
};
export type PlacedTrimObstacleInspection =
  | {
      ok: true;
      nativeElementId: number;
      nativeDefinitionId: number;
      components: PlacedTrimObstacleComponent[];
      originalFreeGraphicsTokens: number[];
      originalHatchTokens: number[];
      sourceFalseFilters: number;
      originalSourceAuthorityGranted: false;
      walkingSupportApproved: false;
      routeApproved: false;
    }
  | {
      ok: false;
      blockers: string[];
      originalSourceAuthorityGranted: false;
      routeApproved: false;
    };

/** Pure original-record mathematics/role census, without source authority.
 * Every retained Geometry is consumed, unknown visibility conditions enlarge
 * obstruction unions, and only source-proved false view branches are omitted.
 * Free graphics must have original Group/Filter children and no body/profile
 * consumers; a curve merely named GLine is insufficient. */
export function inspectPlacedTrimObstacleBranches(
  occurrence: Revit2027GRepReplay,
  definition: Revit2027GRepReplay,
): PlacedTrimObstacleInspection {
  try {
    if (
      occurrence.spans.some(
        (s) =>
          !["Revit2027GInstance", "Revit2027InstanceInfo"].includes(
            s.readerId,
          ) || s.ownerElementId !== occurrence.ownerElementId,
      ) ||
      occurrence.spans.length !== 2
    )
      throw Error(
        "Additional original occurrence geometry remains unsupported",
      );
    const bindings = collectRevit2027GInstanceBindings(occurrence);
    if (
      !bindings.ok ||
      bindings.value.length !== 1 ||
      bindings.value[0]!.kind !== "external"
    )
      throw Error("Original occurrence lacks one external physical definition");
    const instance = bindings.value[0]!.instance;
    if (
      instance.symbolElementId !== definition.ownerElementId ||
      instance.gRepId !== 0 ||
      instance.cda !== 1 ||
      instance.hasScale ||
      instance.resolveSymbolInView ||
      instance.forbiddenTarget !== 0
    )
      throw Error("Original occurrence/definition selection is unsupported");
    const t = instance.transform;
    if (
      [...t.xAxis, ...t.yAxis, ...t.zAxis, ...t.origin].some(
        (v) => !Number.isFinite(v),
      ) ||
      t.xAxis[2] !== 0 ||
      t.yAxis[2] !== 0 ||
      t.zAxis[0] !== 0 ||
      t.zAxis[1] !== 0 ||
      t.zAxis[2] <= 0
    )
      throw Error("Original source affine is not finite/vertical");
    const det = new Rational(
      rational(t.xAxis[0]).n *
        rational(t.yAxis[1]).n *
        rational(t.xAxis[1]).d *
        rational(t.yAxis[0]).d -
        rational(t.xAxis[1]).n *
          rational(t.yAxis[0]).n *
          rational(t.xAxis[0]).d *
          rational(t.yAxis[1]).d,
      rational(t.xAxis[0]).d *
        rational(t.yAxis[1]).d *
        rational(t.xAxis[1]).d *
        rational(t.yAxis[0]).d,
    );
    if (det.n === 0n) throw Error("Original source affine is singular");
    const spans = definition.spans;
    if (
      spans.some(
        (s, i) =>
          s.replayIndex !== i ||
          s.ownerElementId !== definition.ownerElementId ||
          (s.parentReplayIndex !== null &&
            (!Number.isSafeInteger(s.parentReplayIndex) ||
              s.parentReplayIndex < 0 ||
              s.parentReplayIndex >= i)),
      )
    )
      throw Error("Invalid original source parent/owner graph");
    const positiveTokens = spans.filter((s) => s.propertyToken > 0);
    if (
      new Set(positiveTokens.map((s) => s.propertyToken)).size !==
      positiveTokens.length
    )
      throw Error("Repeated original source body/graphic token");
    for (const s of positiveTokens) {
      const consumers = definition.descriptors.filter(
        (d) => d.token === s.propertyToken,
      );
      if (
        consumers.length !== 1 ||
        consumers[0]!.state !== "queued" ||
        consumers[0]!.parentReplayIndex !== s.parentReplayIndex ||
        consumers[0]!.sourceClassSlot !== s.propertySourceClassSlot ||
        consumers[0]!.descriptorOffset !== s.descriptorOffset ||
        consumers[0]!.descriptorEndOffset !== s.descriptorEndOffset
      )
        throw Error("Reused or unbound original physical/graphic descendant");
    }
    const selection = originalDefault3dDirectionSelection(definition),
      excluded = selection.excludedReplayIndices;
    if (selection.unresolvedAliasedFilters)
      throw Error("Original view selection has an external drawable alias");
    const accounted = new Set<number>(),
      free: number[] = [],
      hatches: number[] = [],
      components: PlacedTrimObstacleComponent[] = [];
    const metadataSlots = new Map([
      ["Revit2027GGroup", 2248],
      ["Revit2027GFilter", 2254],
      ["Revit2027GConditionDir", 2235],
      ["Revit2027GConditionCut", 2234],
      ["Revit2027GConditionInt", 2238],
    ]);
    for (const s of spans) {
      if (excluded.has(s.replayIndex)) {
        accounted.add(s.replayIndex);
        continue;
      }
      if (metadataSlots.get(s.readerId) === s.propertySourceClassSlot) {
        accounted.add(s.replayIndex);
        continue;
      }
      if (s.readerId !== "Revit2027GLine") continue;
      const v = s.value as {
        endParameters: number[];
        origin: number[];
        direction: number[];
      };
      if (
        s.propertySourceClassSlot !== 1973 ||
        s.propertyToken <= 0 ||
        v.endParameters.length !== 2 ||
        v.origin.length !== 3 ||
        v.direction.length !== 3 ||
        [...v.endParameters, ...v.origin, ...v.direction].some(
          (n) => !Number.isFinite(n),
        )
      )
        throw Error("Unsupported original free graphic");
      const parent =
          s.parentReplayIndex === null ? undefined : spans[s.parentReplayIndex],
        pv = parent?.value as
          | {
              group?: {
                children?: {
                  token: number;
                  sourceClassSlot: number;
                  byteOffset: number;
                  endOffset: number;
                }[];
              };
              children?: {
                token: number;
                sourceClassSlot: number;
                byteOffset: number;
                endOffset: number;
              }[];
            }
          | undefined;
      const children =
        parent?.readerId === "Revit2027GFilter"
          ? pv?.group?.children
          : parent?.readerId === "Revit2027GGroup"
            ? pv?.children
            : undefined;
      if (
        !children?.some(
          (d) =>
            d.token === s.propertyToken &&
            d.sourceClassSlot === 1973 &&
            d.byteOffset === s.descriptorOffset &&
            d.endOffset === s.descriptorEndOffset,
        )
      )
        throw Error(
          "Original graphic is consumed by a body/profile or lacks its source child descriptor",
        );
      for (
        let at = s.parentReplayIndex;
        at !== null;
        at = spans[at]!.parentReplayIndex
      )
        if (
          !["Revit2027GGroup", "Revit2027GFilter"].includes(spans[at]!.readerId)
        )
          throw Error("Original graphic belongs to physical geometry/profile");
      const consumers = definition.descriptors.filter(
        (d) => d.token === s.propertyToken,
      );
      if (
        consumers.length !== 1 ||
        consumers[0]!.parentReplayIndex !== s.parentReplayIndex ||
        consumers[0]!.state === "reused"
      )
        throw Error("Original graphic has reused or unknown consumers");
      accounted.add(s.replayIndex);
      free.push(s.propertyToken);
    }
    for (const g of spans.filter(
      (s) => s.readerId === "Revit2027Geometry" && !excluded.has(s.replayIndex),
    )) {
      const indices = new Set([g.replayIndex]);
      for (const s of spans)
        if (s.parentReplayIndex !== null && indices.has(s.parentReplayIndex))
          indices.add(s.replayIndex);
      if ([...indices].some((i) => excluded.has(i)))
        throw Error(
          "Conditional physical Geometry descendants remain unsupported",
        );
      const branch = spans.filter((s) => indices.has(s.replayIndex));
      const gv = g.value as {
        faces: {
          count: number;
          entries: { token: number; sourceClassSlot: number }[];
        };
        edges: {
          count: number;
          entries: { token: number; sourceClassSlot: number }[];
        };
        sharedSurfaceInfo: { count: number };
      };
      const count = (reader: string) =>
        branch.filter((s) => s.readerId === reader);
      const declared = (field: typeof gv.faces, reader: string, slot: number) =>
        field.count === field.entries.length &&
        field.count === count(reader).length &&
        new Set(field.entries.map((d) => d.token)).size === field.count &&
        field.entries.every(
          (d) =>
            d.sourceClassSlot === slot &&
            count(reader).some((s) => s.propertyToken === d.token),
        );
      if (
        !declared(gv.faces, "Revit2027Face", 1825) ||
        !declared(gv.edges, "Revit2027GEdge", 1423) ||
        gv.sharedSurfaceInfo.count !== 0
      )
        throw Error(
          "Original Geometry does not account for its complete declared operands",
        );
      for (const fill of count("Revit2027GFilling")) {
        const parent =
            fill.parentReplayIndex === null
              ? undefined
              : spans[fill.parentReplayIndex],
          fv = fill.value as {
            faceIdReference: number;
            data: { token: number };
            queuedProperties: unknown[];
          },
          pv = parent?.value as
            | {
                foregroundFilling: { token: number };
                backgroundFilling: { token: number };
              }
            | undefined;
        if (
          parent?.readerId !== "Revit2027Face" ||
          fv.faceIdReference !== parent.propertyToken ||
          ![pv!.foregroundFilling.token, pv!.backgroundFilling.token].includes(
            fill.propertyToken,
          ) ||
          fv.data.token !== 0 ||
          fv.queuedProperties.length ||
          branch.some((s) => s.parentReplayIndex === fill.replayIndex)
        )
          throw Error(
            "Original hatch has unknown body/material children or wrong face binding",
          );
        hatches.push(fill.propertyToken);
      }
      if (gv.faces.count === 0) {
        if (gv.edges.count || branch.length !== 1)
          throw Error(
            "Empty original Geometry hides additional source operands",
          );
        accounted.add(g.replayIndex);
        continue;
      }
      // Reindex only FIFO graph positions for the isolated original Geometry.
      // Source face flags, loops, hatches, UV operands and descriptors are unchanged.
      // In particular reversed Face6 has the same conservative obstruction hull
      // as Face4; it does not acquire upward support authority.
      const positions = new Map(branch.map((s, i) => [s.replayIndex, i]));
      const mathematical = {
        ...definition,
        spans: branch.map((s, i) => ({
          ...s,
          replayIndex: i,
          parentReplayIndex:
            s.parentReplayIndex === null
              ? null
              : (positions.get(s.parentReplayIndex) ?? null),
        })),
      };
      const envelope = inspectOriginalWallTrimObstacleBranches(mathematical);
      if (
        !envelope.ok ||
        envelope.auxiliaryNullLoopFaceTokens.length ||
        envelope.finiteOpenReferenceEdgeTokens.length ||
        envelope.unlinkedGraphicEdgeTokens.length
      )
        throw Error(
          "Original physical branch lacks complete closed planar trim census: " +
            (envelope.ok
              ? "Unclosed or auxiliary boundary"
              : envelope.blockers.join("; ")),
        );
      const min = add(
        rational(t.origin[2]),
        mul(rational(t.zAxis[2]), envelope.minimumElevationFeet),
      );
      const max = add(
        rational(t.origin[2]),
        mul(rational(t.zAxis[2]), envelope.maximumElevationFeet),
      );
      if (min.n * max.d >= max.n * min.d)
        throw Error(
          "Original physical component has no positive vertical extent",
        );
      const placed = envelope.outerPlanEnvelope.map((part) =>
        part.map((ring) =>
          ring.map(
            (p) =>
              [
                add(
                  add(rational(t.origin[0]), mul(rational(t.xAxis[0]), p[0])),
                  mul(rational(t.yAxis[0]), p[1]),
                ),
                add(
                  add(rational(t.origin[1]), mul(rational(t.xAxis[1]), p[0])),
                  mul(rational(t.yAxis[1]), p[1]),
                ),
              ] as [Rational, Rational],
          ),
        ),
      );
      components.push({
        originalGeometryToken: g.propertyToken,
        physicalFaceTokens: [...envelope.sourceFaceTokens],
        outerPlanEnvelope: freezeNativeRationalParts(
          nativeRationalOverlay("union", placed),
        ),
        minimumElevationFeet: Object.freeze(min),
        maximumElevationFeet: Object.freeze(max),
      });
      for (const i of indices) accounted.add(i);
    }
    if (!components.length || accounted.size !== spans.length)
      throw Error(
        "Unconsumed original physical, control, graphics or metadata branch",
      );
    return {
      ok: true,
      nativeElementId: Number(occurrence.ownerElementId),
      nativeDefinitionId: Number(definition.ownerElementId),
      components,
      originalFreeGraphicsTokens: free,
      originalHatchTokens: hatches,
      sourceFalseFilters: selection.sourceFalseFilters.length,
      originalSourceAuthorityGranted: false,
      walkingSupportApproved: false,
      routeApproved: false,
    };
  } catch (e) {
    return {
      ok: false,
      blockers: [e instanceof Error ? e.message : String(e)],
      originalSourceAuthorityGranted: false,
      routeApproved: false,
    };
  }
}

const certificateBrand: unique symbol = Symbol(
  "OriginalPlacedTrimObstacleCertificate",
);
export type OriginalPlacedTrimObstacleCertificate = {
  readonly [certificateBrand]: true;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly nativeElementId: number;
  readonly nativeDefinitionId: number;
  readonly use: "foreign-material-envelope-only";
  readonly walkingSupportApproved: false;
  readonly routeApproved: false;
};
type StoredProof = {
  inspection: Extract<PlacedTrimObstacleInspection, { ok: true }>;
  sourceFacts: {
    occurrenceFrameHex: string;
    definitionFrameHex: string;
    occurrenceNativeFrameHex: string;
    definitionNativeFrameHex: string;
    frameSha256s: Record<string, string>;
    nativeCategoryId: number;
    originalWorldBoundsFeet: {
      minimum: readonly number[];
      maximum: readonly number[];
      valid: boolean;
    };
    sourceModelSha256: string;
    sourceSchemaSha256: string;
  };
};
const proofs = new WeakMap<
  OriginalPlacedTrimObstacleCertificate,
  StoredProof
>();

export function proveOriginalPlacedTrimObstacleEnvelope(
  context: OriginalPlacedTrimObstacleContext,
  nativeElementId: number,
) {
  const stored = contexts.get(context);
  if (!stored)
    throw Error(
      "A fabricated source context cannot prove an original physical body",
    );
  const request = stored.requests.find(
    (r) => r.nativeElementId === nativeElementId,
  );
  if (!request)
    throw Error(
      "Native physical body is outside the original requested census",
    );
  const definitionId = request.nativeDefinitionId;
  if (definitionId === undefined)
    throw Error("Requested source body is not a placed family definition");
  for (const id of [nativeElementId, definitionId])
    if (
      !consistentOriginalObstacleCategories(
        [...(stored.categories.get(id) ?? [])],
        -2000023,
      )
    )
      throw Error(
        "Original instance/definition is not unambiguously native door category",
      );
  const frame = (id: number, marker: number) => {
    const b = stored.frames.get(`${id}:${marker}`);
    if (!b) throw Error("Missing original placed-body source root");
    return b;
  };
  const occurrence = frame(nativeElementId, 2246),
    definition = frame(definitionId, 2246),
    nativeOccurrence = frame(nativeElementId, 2031),
    nativeDefinition = frame(definitionId, 2064);
  const previousTranslation = activeClassTagTranslation(),
    previousWidth = activeElementIdBytes();
  let inspected: PlacedTrimObstacleInspection;
  let originalWorldBoundsFeet: ReturnType<typeof sourceRoot>["worldExtents"];
  try {
    setActiveClassTagTranslation(stored.translation);
    setActiveElementIdBytes(stored.idBytes);
    originalWorldBoundsFeet = sourceRoot(
      occurrence,
      nativeElementId,
    ).worldExtents;
    if (!originalOccurrenceBoundsAreFiniteOrdered(originalWorldBoundsFeet))
      throw Error("Original occurrence bounds are unbounded or inverted");
    const occurrenceReplay = decode(occurrence, nativeElementId);
    const bindings = collectRevit2027GInstanceBindings(occurrenceReplay);
    const nativeView = new DataView(
      nativeOccurrence.buffer,
      nativeOccurrence.byteOffset,
      nativeOccurrence.byteLength,
    );
    const nativePlacement = readInstancePlacement(nativeOccurrence, {
      offset: 0,
      elementId: nativeElementId,
      marker: 2031,
      objectLength: nativeView.getUint32(12, true),
      typeCode: nativeView.getUint32(18, true),
    });
    if (
      !bindings.ok ||
      bindings.value.length !== 1 ||
      bindings.value[0]!.kind !== "external" ||
      !nativePlacement
    )
      throw Error(
        "Original native instance placement lacks independently readable correspondence",
      );
    const t = bindings.value[0]!.instance.transform;
    const basis = [
      t.xAxis[0],
      t.yAxis[0],
      t.zAxis[0],
      t.xAxis[1],
      t.yAxis[1],
      t.zAxis[1],
      t.xAxis[2],
      t.yAxis[2],
      t.zAxis[2],
    ];
    if (
      nativePlacement.geometryId !== definitionId ||
      nativePlacement.symbolId !== definitionId ||
      JSON.stringify(nativePlacement.origin) !== JSON.stringify(t.origin) ||
      JSON.stringify(nativePlacement.basis) !== JSON.stringify(basis)
    )
      throw Error(
        "Original native instance and GInstance disagree on definition or affine",
      );
    inspected = inspectPlacedTrimObstacleBranches(
      occurrenceReplay,
      decode(definition, definitionId),
    );
  } finally {
    setActiveClassTagTranslation(previousTranslation);
    setActiveElementIdBytes(previousWidth);
  }
  if (!inspected.ok) return inspected;
  const certificate = Object.freeze({
    [certificateBrand]: true as const,
    sourceModelSha256: context.sourceModelSha256,
    sourceSchemaSha256: context.sourceSchemaSha256,
    nativeElementId,
    nativeDefinitionId: definitionId,
    use: "foreign-material-envelope-only" as const,
    walkingSupportApproved: false as const,
    routeApproved: false as const,
  });
  proofs.set(certificate, {
    inspection: inspected,
    sourceFacts: {
      occurrenceFrameHex: bytesToHex(occurrence),
      definitionFrameHex: bytesToHex(definition),
      occurrenceNativeFrameHex: bytesToHex(nativeOccurrence),
      definitionNativeFrameHex: bytesToHex(nativeDefinition),
      frameSha256s: {
        occurrence: hash(occurrence),
        definition: hash(definition),
        nativeOccurrence: hash(nativeOccurrence),
        nativeDefinition: hash(nativeDefinition),
      },
      nativeCategoryId: -2000023,
      originalWorldBoundsFeet,
      sourceModelSha256: context.sourceModelSha256,
      sourceSchemaSha256: context.sourceSchemaSha256,
    },
  });
  return { ok: true as const, certificate };
}
export function originalPlacedTrimObstacleFacts(
  certificate: OriginalPlacedTrimObstacleCertificate,
) {
  const stored = proofs.get(certificate);
  if (!stored) throw Error("Unregistered original physical-body certificate");
  return {
    components: stored.inspection.components.map((c) => ({
      ...c,
      physicalFaceTokens: [...c.physicalFaceTokens],
    })),
    sourceFacts: structuredClone(stored.sourceFacts),
    census: {
      freeGraphics: [...stored.inspection.originalFreeGraphicsTokens],
      hatches: [...stored.inspection.originalHatchTokens],
      sourceFalseFilters: stored.inspection.sourceFalseFilters,
    },
    walkingSupportApproved: false as const,
    routeApproved: false as const,
  };
}
