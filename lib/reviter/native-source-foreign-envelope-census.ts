import { originalTwoFootStandingSquare } from "./native-source-standing-footprint.ts";
/** Unwired complete original GElement envelope census. Source snapshots and
 * unknown/unbounded records are retained independently of display meshes. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openRevitContainer } from "./convert-container.ts";
import {
  asBytes,
  stripRevitPageChecksums,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
} from "./revit-container.ts";
import { createSplitFrameStream } from "./split-frame-stream.ts";
import { indexPageFrames } from "./page-frame-index.ts";
import { readSchema } from "./schema-reader.ts";
import { scanElementHeaders, type ElementHeader } from "./element-headers.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
import {
  inspectOriginalPartMakerPrefix,
  inspectOriginalZeroChildGElement,
} from "./native-source-partmaker-prefix.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import { inspectOriginalUnboundedInstanceEnvelope } from "./native-source-unbounded-instance-envelope.ts";
import { originalInstanceOnlyContainer } from "./native-material-source.ts";
import { createNativeDrawingReferenceSourceCollector } from "./native-drawing-reference-source.ts";
import { reviewedDrawingReferenceElementIds } from "./reviewed-drawing-reference-source.ts";
import {
  validateReviewedDrawingReferences,
  type ReviewedDrawingReferences,
} from "./reviewed-drawing-references.ts";
import { nonModelReason, NON_MODEL_CATEGORY_IDS } from "./model-elements.ts";
import {
  activeClassTagTranslation,
  setActiveClassTagTranslation,
} from "./revit-class-tags.ts";
import {
  activeElementIdBytes,
  setActiveElementIdBytes,
} from "./element-id-width.ts";
import {
  Rational,
  rational,
  type NativeRationalPoint,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import {
  projectStatedTwoFootWalkingVolume,
  type SourceWalkingPoint3,
} from "./native-source-walking-volume.ts";
import { exactClosedSourcePlanarContact } from "./native-source-planar-slab-envelope.ts";
import type { Bounds3, ConvertResult } from "./types.ts";
const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes)),
  objectHash = (value: unknown) =>
    hash(new TextEncoder().encode(JSON.stringify(value)));
const cmp = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const validBounds = (b: Bounds3) =>
  b &&
  ["x", "y", "z"].every((axis) => {
    const k = axis as "x" | "y" | "z";
    return (
      Number.isFinite(b.min[k]) &&
      Number.isFinite(b.max[k]) &&
      b.min[k] <= b.max[k]
    );
  });
const overlaps = (a: Bounds3, b: Bounds3) =>
  ["x", "y", "z"].every((axis) => {
    const k = axis as "x" | "y" | "z";
    return a.min[k] <= b.max[k] && a.max[k] >= b.min[k];
  });
const plan = (b: Bounds3): NativeRationalParts =>
  b.min.x === b.max.x || b.min.y === b.max.y
    ? []
    : [
        [
          [
            [rational(b.min.x), rational(b.min.y)],
            [rational(b.max.x), rational(b.min.y)],
            [rational(b.max.x), rational(b.max.y)],
            [rational(b.min.x), rational(b.max.y)],
          ],
        ],
      ];
const segments = (b: Bounds3): NativeRationalPoint[][] => [
  [
    [rational(b.min.x), rational(b.min.y)],
    [rational(b.max.x), rational(b.max.y)],
  ],
];
const planBounds = (points: NativeRationalPoint[]) => ({
  minX: points.map((p) => p[0]).reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
  maxX: points.map((p) => p[0]).reduce((a, b) => (cmp(a, b) > 0 ? a : b)),
  minY: points.map((p) => p[1]).reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
  maxY: points.map((p) => p[1]).reduce((a, b) => (cmp(a, b) > 0 ? a : b)),
});
const apart = (box: Bounds3, b: ReturnType<typeof planBounds>) =>
  cmp(rational(box.max.x), b.minX) < 0 ||
  cmp(rational(box.min.x), b.maxX) > 0 ||
  cmp(rational(box.max.y), b.minY) < 0 ||
  cmp(rational(box.min.y), b.maxY) > 0;
type Row = {
  nativeElementId: number;
  sourceFrameSha256: string;
  boundsFeet?: Bounds3;
  blocker?: string;
  categoryId?: number | null;
};
const brand: unique symbol = Symbol("OriginalNativeForeignEnvelopeCensus");
export type OriginalNativeForeignEnvelopeCensus = {
  readonly [brand]: true;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly sourceCensusSha256: string;
};
const contexts = new WeakMap<
  OriginalNativeForeignEnvelopeCensus,
  {
    rows: Row[];
    scope: Bounds3;
    delegated: [number, number[]][];
    sourceFrames: Map<number, Uint8Array>;
    floorFrames: Map<number, Uint8Array>;
    stairFrames: Map<number, Uint8Array>;
    nativeInstanceFrames: Map<number, Uint8Array>;
    nativePanelSymbolFrames: Map<number, Uint8Array>;
    nativeCurtainGeneratorFrames: Map<string, Uint8Array>;
    sourceSchemaBytes: Uint8Array;
    sourceCategories: Map<number, Set<number | null>>;
  }
>();

/** Complete original bytes are required. A cached model or a self-authored
 * inventory cannot construct this handle. Every actual source variant remains
 * a material envelope; unknown categories remain physical. Exact owner/view
 * and enumerated non-surface roles plus source-identity-bound reviewed imports
 * are the only omissions. Identity-only containers may delegate ONLY when
 * every original child has its own bounded source frame. */
export function createOriginalNativeForeignEnvelopeCensus(
  originalRvtBytes: Uint8Array,
  expectedSha256: string,
  scopeBoundsFeet: Bounds3,
  review?: ReviewedDrawingReferences,
  requestedOriginalFrameIds: readonly number[] = [],
) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !validBounds(scopeBoundsFeet))
    throw Error("Invalid original source or finite census scope");
  if (
    requestedOriginalFrameIds.length > 4096 ||
    requestedOriginalFrameIds.some(
      (id) => !Number.isSafeInteger(id) || id <= 0 || id > 0x7fffffff,
    )
  )
    throw Error("Invalid requested original source frame IDs");
  const requestedFrames = new Set(requestedOriginalFrameIds);
  validateReviewedDrawingReferences(review, expectedSha256);
  const bytes = Uint8Array.from(originalRvtBytes);
  if (hash(bytes) !== expectedSha256)
    throw Error("Original foreign census RVT checksum mismatch");
  const previousTranslation = activeClassTagTranslation(),
    previousWidth = activeElementIdBytes();
  try {
    const opened = openRevitContainer(bytes, {});
    if (
      opened.decoderPlan.revitVersion !== 2027 ||
      activeElementIdBytes() !== 8 ||
      !opened.nativeSourceSchemaBytes ||
      !opened.classTagTranslation.identity ||
      opened.classTagTranslation.movedClasses
    )
      throw Error("Unsupported complete original envelope schema");
    const headers = new Map<number, ElementHeader[]>(),
      rows: Row[] = [],
      seen = new Set<string>(),
      sourceFrames = new Map<number, Uint8Array>(),
      ambiguousFrames = new Set<number>(),
      oversized = new Set<number>(),
      rawScopeFrames = new Map<number, Uint8Array>(),
      requestedOnlyFrames = new Map<number, Uint8Array>(),
      requestedOnlyAmbiguous = new Set<number>(),
      unboundedFrames = new Map<number, Uint8Array>(),
      unboundedAmbiguous = new Set<number>(),
      nativeInstanceFrames = new Map<number, Uint8Array>(),
      nativeInstanceAmbiguous = new Set<number>();
    let pages = 0;
    const sourceHeadersSeen = new Map<
        string,
        { nativeElementId: number; sourceFrameSha256: string; blocker: string }
      >(),
      consumedSourceHeaders = new Set<string>();
    const drawings = createNativeDrawingReferenceSourceCollector(
      2027,
      opened.nativeSourceSchemaBytes,
    );
    const decodedSchema = readSchema(opened.nativeSourceSchemaBytes);
    if (!decodedSchema.ok)
      throw Error("Complete original schema did not replay");
    const schemaClasses = new Map(
        decodedSchema.schema.classes.map((c) => [c.index, c]),
      ),
      elementClassNames = new Map<number, string>(),
      symbolClassNames = new Map<number, string>();
    for (const c of schemaClasses.values()) {
      let p: typeof c | undefined = c;
      const ancestors: string[] = [];
      for (let n = 0; p && n < 1024; n++) {
        ancestors.push(p.name);
        p =
          p.parent.kind === "none"
            ? undefined
            : schemaClasses.get(p.parent.index);
      }
      if (p) throw Error("Original class ancestry cycle");
      if (ancestors.includes("Element")) elementClassNames.set(c.index, c.name);
      if (ancestors.includes("Symbol")) symbolClassNames.set(c.index, c.name);
    }
    const semanticClasses = new Map<number, Map<string, string>>(),
      floorFrames = new Map<number, Uint8Array>(),
      floorAmbiguous = new Set<number>(),
      stairFrames = new Map<number, Uint8Array>(),
      stairAmbiguous = new Set<number>(),
      panelSymbolFrames = new Map<number, Uint8Array>(),
      panelSymbolAmbiguous = new Set<number>(),
      partMakerFrames = new Map<number, Uint8Array>(),
      partMakerAmbiguous = new Set<number>(),
      nativeCurtainGeneratorFrames = new Map<string, Uint8Array>(),
      nativeCurtainGeneratorAmbiguous = new Set<string>();
    const nonPhysicalCategories = new Set([
      ...NON_MODEL_CATEGORY_IDS,
      -2000945,
      -2000576,
      -2000500,
      -2003000,
      -2000977,
      -2000700,
    ]);
    const checkChecksum = (raw: Uint8Array) => {
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      let a = 1,
        b = 0;
      for (let i = 16; i < raw.length - 4; i++) {
        a = (a + raw[i]!) % 65521;
        b = (b + a) % 65521;
      }
      return (b * 65536 + a) >>> 0 === view.getUint32(8, true);
    };
    for (const partition of opened.partitions) {
      const splitter = createSplitFrameStream({
          markers: [2246, 2153, 2031, 4075, 4318, 3234, 3899, 1049, 4316],
          minObjectLength: 40,
          maxFrameBytes: 16 * 1024 * 1024,
          crossingOnly: false,
          acceptHeader: (view, offset) => {
            const id = view.getUint32(offset, true),
              length = view.getUint32(offset + 12, true);
            if (
              view.getUint16(offset + 16, true) === 2246 &&
              id > 0 &&
              id <= 0x7fffffff &&
              length >= 40
            ) {
              const key = `${id}:${length}:${view.getUint32(offset + 8, true)}`;
              sourceHeadersSeen.set(key, {
                nativeElementId: id,
                sourceFrameSha256: "",
                blocker: "Unconsumed recognized original GElement header",
              });
            }
            if (id > 0 && id <= 0x7fffffff && length + 20 > 16 * 1024 * 1024)
              oversized.add(id);
            return id > 0 && id <= 0x7fffffff;
          },
        }),
        data = stripRevitPageChecksums(asBytes(partition.entry.content)),
        offsets = gzipOffsets(data);
      let window: Uint8Array | null = null;
      for (let i = 0; i < offsets.length; i++) {
        const page = inflateRevitChunk(
          data,
          offsets[i]!,
          offsets[i + 1],
          window,
        );
        if (!page) throw Error("Original foreign census page failed inflation");
        window = revitWindowTail(page);
        pages++;
        const pageFrames = indexPageFrames(page).frames;
        drawings.scanPage(page, pageFrames);
        for (const f of pageFrames) {
          const name = elementClassNames.get(f.marker);
          if (!name) continue;
          const raw = page.subarray(f.offset, f.offset + f.objectLength + 20);
          if (!checkChecksum(raw)) continue;
          const classes =
            semanticClasses.get(f.elementId) ?? new Map<string, string>();
          classes.set(name, hash(raw));
          semanticClasses.set(f.elementId, classes);
        }
        for (const header of scanElementHeaders(page)) {
          const list = headers.get(header.elementId) ?? [];
          if (!list.some((h) => JSON.stringify(h) === JSON.stringify(header)))
            list.push(header);
          headers.set(header.elementId, list);
        }
        for (const frame of splitter.push(page)) {
          if (
            frame.marker === 3899 ||
            frame.marker === 1049 ||
            frame.marker === 4316
          ) {
            if (!checkChecksum(frame.data))
              throw Error(
                "Original curtain generator semantic checksum failed",
              );
            const key = `${frame.elementId}:${frame.marker}`;
            const previous = nativeCurtainGeneratorFrames.get(key);
            if (previous && hash(previous) !== hash(frame.data))
              nativeCurtainGeneratorAmbiguous.add(key);
            nativeCurtainGeneratorFrames.set(key, Uint8Array.from(frame.data));
            continue;
          }
          if (
            frame.marker === 2031 ||
            frame.marker === 4075 ||
            frame.marker === 4318 ||
            frame.marker === 3234
          ) {
            if (!checkChecksum(frame.data))
              throw Error("Original semantic instance/stair checksum failed");
            const target =
                frame.marker === 2031
                  ? nativeInstanceFrames
                  : frame.marker === 4075
                    ? stairFrames
                    : frame.marker === 4318
                      ? panelSymbolFrames
                      : partMakerFrames,
              ambiguous =
                frame.marker === 2031
                  ? nativeInstanceAmbiguous
                  : frame.marker === 4075
                    ? stairAmbiguous
                    : frame.marker === 4318
                      ? panelSymbolAmbiguous
                      : partMakerAmbiguous;
            const previous = target.get(frame.elementId);
            if (previous && hash(previous) !== hash(frame.data))
              ambiguous.add(frame.elementId);
            target.set(frame.elementId, Uint8Array.from(frame.data));
            continue;
          }
          if (frame.marker === 2153) {
            if (!checkChecksum(frame.data))
              throw Error("Original semantic Floor checksum failed");
            if (
              floorFrames.has(frame.elementId) &&
              hash(floorFrames.get(frame.elementId)!) !== hash(frame.data)
            )
              floorAmbiguous.add(frame.elementId);
            floorFrames.set(frame.elementId, Uint8Array.from(frame.data));
            continue;
          }
          consumedSourceHeaders.add(
            `${frame.elementId}:${frame.objectLength}:${new DataView(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength).getUint32(8, true)}`,
          );
          const frameSha = hash(frame.data),
            key = `${frame.elementId}:${frameSha}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const row: Row = {
            nativeElementId: frame.elementId,
            sourceFrameSha256: frameSha,
          };
          const view = new DataView(
            frame.data.buffer,
            frame.data.byteOffset,
            frame.data.byteLength,
          );
          let a = 1,
            b = 0;
          for (let at = 16; at < frame.data.length - 4; at++) {
            a = (a + frame.data[at]!) % 65521;
            b = (b + a) % 65521;
          }
          if ((b * 65536 + a) >>> 0 !== view.getUint32(8, true)) {
            row.blocker = "Original GElement checksum failed";
            rows.push(row);
            continue;
          }
          const decoded = decodeRevit2027FramedGRepRoot(
            frame.data,
            {
              offset: 0,
              elementId: frame.elementId,
              marker: 2246,
              objectLength: frame.objectLength,
              typeCode: view.getUint32(18, true),
            },
            2027,
          );
          if (!decoded.ok || !decoded.value.worldExtents.valid) {
            {
              const previous = unboundedFrames.get(frame.elementId);
              if (previous && hash(previous) !== frameSha)
                unboundedAmbiguous.add(frame.elementId);
              unboundedFrames.set(frame.elementId, Uint8Array.from(frame.data));
            }
            row.blocker = decoded.ok
              ? "Original GElement world extent is unbounded"
              : decoded.error;
            rows.push(row);
            continue;
          }
          const e = decoded.value.worldExtents;
          row.boundsFeet = {
            min: { x: e.minimum[0], y: e.minimum[1], z: e.minimum[2] },
            max: { x: e.maximum[0], y: e.maximum[1], z: e.maximum[2] },
          };
          if (!validBounds(row.boundsFeet))
            row.blocker = "Invalid original finite world extent";
          rows.push(row);
          if (requestedFrames.has(frame.elementId)) {
            const previous = requestedOnlyFrames.get(frame.elementId);
            if (previous && hash(previous) !== frameSha)
              requestedOnlyAmbiguous.add(frame.elementId);
            requestedOnlyFrames.set(
              frame.elementId,
              Uint8Array.from(frame.data),
            );
          }
          if (overlaps(row.boundsFeet, scopeBoundsFeet)) {
            if (rawScopeFrames.has(frame.elementId))
              ambiguousFrames.add(frame.elementId);
            rawScopeFrames.set(frame.elementId, Uint8Array.from(frame.data));
          }
        }
      }
      drawings.finishPartition();
    }
    for (const [key, row] of sourceHeadersSeen)
      if (!consumedSourceHeaders.has(key) && headers.has(row.nativeElementId))
        rows.push(row);
    for (const id of oversized)
      if (
        headers.has(id) ||
        opened.nativeIdentity?.identities.some(
          (identity) => identity.elementId === id,
        )
      )
        rows.push({
          nativeElementId: id,
          sourceFrameSha256: "",
          blocker:
            "Unconsumed original source header exceeds bounded whole-frame reader",
        });
    const header = (id: number) => {
      const list = headers.get(id);
      return list?.length === 1 ? list[0] : undefined;
    };
    for (const row of rows)
      row.categoryId = header(row.nativeElementId)?.categoryId;
    const drawingSource = drawings.snapshot(expectedSha256);
    const drawingIds = reviewedDrawingReferenceElementIds(
      {
        nativeDrawingReferenceSource: drawingSource,
        nativeIdentity: opened.nativeIdentity,
        elementBounds: [],
      } as unknown as ConvertResult,
      review,
      expectedSha256,
    );
    const currentSourceIds = new Set(
      opened.nativeIdentity?.identities.map((identity) => identity.elementId) ??
        [],
    );
    const symbolNames = new Set(symbolClassNames.values()),
      typeOwners = new Set(
        [...semanticClasses]
          .filter(
            ([, classes]) =>
              classes.size > 0 &&
              [...classes.keys()].every((name) => symbolNames.has(name)),
          )
          .map(([id]) => id),
      );
    if (
      !opened.elementOwnership ||
      new Set(opened.elementOwnership.records.map((r) => r.elementId)).size !==
        opened.elementOwnership.records.length
    )
      throw Error("Original source ownership absent or ambiguous");
    const sourceParents = new Map(
      opened.elementOwnership?.records.map((r) => [
        r.elementId,
        r.owningElementId,
      ]) ?? [],
    );
    const typeAncestor = (id: number) => {
      const visited = new Set<number>();
      for (let n = 0; n < 128; n++) {
        if (visited.has(id)) return undefined;
        visited.add(id);
        if (typeOwners.has(id)) return id;
        const next = sourceParents.get(id);
        if (next === null || next === undefined || next === id)
          return undefined;
        id = next;
      }
      return undefined;
    };
    const hardNonPhysicalIds = new Set(
      rows
        .filter((row) => {
          const h = header(row.nativeElementId);
          return (
            drawingIds.has(row.nativeElementId) ||
            (!!h &&
              (h.ownerViewId !== null ||
                (h.categoryId !== null &&
                  nonPhysicalCategories.has(h.categoryId))))
          );
        })
        .map((row) => row.nativeElementId),
    );
    const exclusionReason = (row: Row) => {
      const h = header(row.nativeElementId);
      if (drawingIds.has(row.nativeElementId))
        return "owner-reviewed-original-drawing-reference";
      if (
        h?.categoryId !== null &&
        h?.categoryId !== undefined &&
        nonPhysicalCategories.has(h.categoryId)
      )
        return `original-BuiltInCategory-non-surface:${h.categoryId}`;
      const type = typeAncestor(row.nativeElementId);
      if (type !== undefined)
        return `original-Symbol-type-ancestry:${type}:${[...(semanticClasses.get(type)?.keys() ?? [])]}`;
      if (h) {
        const reason = nonModelReason(h, undefined);
        if (reason) return `original-ElementHeader:${reason}`;
      }
      if (
        currentSourceIds.size &&
        !currentSourceIds.has(row.nativeElementId) &&
        !h
      )
        return "absent-from-complete-original-project-ElementTable-and-headers;not-an-independent-current-project-element";
      return undefined;
    };
    const recoveredOriginalPhysicalInstances: object[] = [],
      refusedOriginalPhysicalInstances: object[] = [];
    for (const row of rows) {
      if (
        !row.blocker ||
        exclusionReason(row) !== undefined ||
        unboundedAmbiguous.has(row.nativeElementId) ||
        nativeInstanceAmbiguous.has(row.nativeElementId)
      )
        continue;
      const raw = unboundedFrames.get(row.nativeElementId),
        native = nativeInstanceFrames.get(row.nativeElementId),
        h = header(row.nativeElementId);
      if (!raw || !native || !h || h.categoryId === null) continue;
      const decode = (bytes: Uint8Array, id: number) => {
        const v = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength,
          ),
          root = decodeRevit2027FramedGRepRoot(
            bytes,
            {
              offset: 0,
              elementId: id,
              marker: 2246,
              objectLength: bytes.length - 20,
              typeCode: v.getUint32(18, true),
            },
            2027,
          );
        if (!root.ok) throw Error(root.error);
        const replay = replayRevit2027GRepFifo(bytes, root.value);
        if (!replay.ok) throw Error(replay.error);
        return replay.value;
      };
      try {
        const occurrence = decode(raw, row.nativeElementId),
          bindings = collectRevit2027GInstanceBindings(occurrence);
        if (
          !bindings.ok ||
          bindings.value.length !== 1 ||
          bindings.value[0]!.kind !== "external"
        )
          continue;
        const definitionId = Number(
            bindings.value[0]!.instance.symbolElementId,
          ),
          definition = unboundedFrames.get(definitionId),
          dh = header(definitionId);
        if (
          !definition ||
          unboundedAmbiguous.has(definitionId) ||
          !typeOwners.has(definitionId) ||
          dh?.categoryId !== h.categoryId
        )
          continue;
        const result = inspectOriginalUnboundedInstanceEnvelope(
          occurrence,
          decode(definition, definitionId),
          native,
        );
        if (!result.ok) {
          refusedOriginalPhysicalInstances.push({
            nativeElementId: row.nativeElementId,
            nativeDefinitionId: definitionId,
            blockers: result.blockers,
          });
          continue;
        }
        row.boundsFeet = result.boundsFeet;
        delete row.blocker;
        recoveredOriginalPhysicalInstances.push({
          nativeElementId: row.nativeElementId,
          nativeDefinitionId: definitionId,
          categoryId: h.categoryId,
          occurrenceGElementSha256: hash(raw),
          definitionGElementSha256: hash(definition),
          nativeInstanceSha256: hash(native),
          originalDefinitionSemanticClasses: Object.fromEntries(
            semanticClasses.get(definitionId)!,
          ),
          ...result,
        });
        if (overlaps(result.boundsFeet, scopeBoundsFeet))
          rawScopeFrames.set(row.nativeElementId, raw);
      } catch (e) {
        refusedOriginalPhysicalInstances.push({
          nativeElementId: row.nativeElementId,
          blocker: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const exclusions = rows.filter((row) => exclusionReason(row) !== undefined),
      excluded = new Set(exclusions.map((row) => row.nativeElementId)),
      retained = rows.filter((row) => !excluded.has(row.nativeElementId)),
      byId = new Map<number, Row[]>();
    for (const row of retained) {
      const list = byId.get(row.nativeElementId) ?? [];
      list.push(row);
      byId.set(row.nativeElementId, list);
    }
    const delegated: [number, number[]][] = [],
      originalPartMakerDelegationProofs: object[] = [];
    for (const [id, native] of partMakerFrames) {
      const raw = unboundedFrames.get(id),
        h = header(id);
      if (
        !raw ||
        partMakerAmbiguous.has(id) ||
        unboundedAmbiguous.has(id) ||
        excluded.has(id) ||
        h?.categoryId !== -2000291 ||
        h.ownerViewId !== null ||
        h.familyId !== null
      )
        continue;
      try {
        const empty = inspectOriginalZeroChildGElement(raw),
          prefix = inspectOriginalPartMakerPrefix(native, decodedSchema.schema);
        if (
          empty.nativeElementId !== id ||
          empty.originalControlCommand !== 0 ||
          empty.originalTag !== id ||
          empty.originalGInfoFlags !== 557220 ||
          prefix.nativeElementId !== id ||
          prefix.originalSketchId !== -1 ||
          prefix.originalDividedElementIds.some(
            (child) =>
              !byId.has(child) ||
              byId.get(child)!.some((row) => !row.boundsFeet || row.blocker),
          )
        )
          continue;
        delegated.push([id, prefix.originalDividedElementIds]);
        originalPartMakerDelegationProofs.push({
          nativeElementId: id,
          nativeCategoryId: h.categoryId,
          sourceSemanticClass: "PartMaker",
          sourceSemanticFrameSha256: hash(native),
          sourceGElementFrameSha256: hash(raw),
          originalZeroChildSource: empty,
          originalNativeDependencyPrefix: prefix,
          originalDividedMaterialChildren: prefix.originalDividedElementIds.map(
            (child) => ({
              nativeElementId: child,
              sourceRows: byId.get(child),
            }),
          ),
          allOriginalDividedMaterialsRetained: true,
          additionalPhysicalBodyAbsenceInferred: false,
          routeApproved: false,
        });
      } catch {}
    }

    for (const [id, raw] of rawScopeFrames) {
      if (ambiguousFrames.has(id) || excluded.has(id)) continue;
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength),
        root = decodeRevit2027FramedGRepRoot(
          raw,
          {
            offset: 0,
            elementId: id,
            marker: 2246,
            objectLength: raw.length - 20,
            typeCode: view.getUint32(18, true),
          },
          2027,
        );
      if (!root.ok) continue;
      const replay = replayRevit2027GRepFifo(raw, root.value);
      if (!replay.ok) continue;
      const proof = originalInstanceOnlyContainer(replay.value, raw);
      if (
        !proof ||
        proof.childElementIds.some(
          (child) =>
            !hardNonPhysicalIds.has(child) &&
            (!byId.has(child) ||
              byId.get(child)!.some((row) => !row.boundsFeet || row.blocker)),
        )
      )
        continue;
      delegated.push([id, proof.childElementIds]);
    }
    // A cycle cannot remove two parents and thereby erase their only material.
    const graph = new Map(delegated),
      active = new Set<number>(),
      done = new Set<number>();
    const visit = (id: number): boolean => {
      if (active.has(id)) return false;
      if (done.has(id)) return true;
      active.add(id);
      for (const child of graph.get(id) ?? []) if (!visit(child)) return false;
      active.delete(id);
      done.add(id);
      return true;
    };
    if (delegated.some(([id]) => !visit(id)))
      throw Error("Original source material delegation cycle");
    const delegatedIds = new Set(delegated.map(([id]) => id)),
      census = retained.filter((row) => !delegatedIds.has(row.nativeElementId));
    for (const [id, raw] of rawScopeFrames)
      if (!ambiguousFrames.has(id)) sourceFrames.set(id, raw);
    for (const [id, raw] of unboundedFrames)
      if (!unboundedAmbiguous.has(id) && !sourceFrames.has(id))
        sourceFrames.set(id, raw);
    // Diagnostic retention must not enter the scope-only delegation pipeline.
    // It is appended only after the complete physical census is finalized.
    for (const [id, raw] of requestedOnlyFrames)
      if (!requestedOnlyAmbiguous.has(id) && !sourceFrames.has(id))
        sourceFrames.set(id, raw);
    const sourceCensusSha256 = objectHash({
      version: 1,
      sourceModelSha256: expectedSha256,
      sourceSchemaSha256: hash(opened.nativeSourceSchemaBytes),
      pages,
      scopeBoundsFeet,
      review: review ?? null,
      originalWorldEnvelopes: rows,
      originalSourceRoleExclusions: exclusions.map((row) => ({
        nativeElementId: row.nativeElementId,
        sourceFrameSha256: row.sourceFrameSha256,
        reason: exclusionReason(row),
      })),
      delegated,
      recoveredOriginalPhysicalInstances,
      refusedOriginalPhysicalInstances,
      originalPartMakerDelegationProofs,
      census,
    });
    const certificate = Object.freeze({
      [brand]: true as const,
      sourceModelSha256: expectedSha256,
      sourceSchemaSha256: hash(opened.nativeSourceSchemaBytes),
      sourceCensusSha256,
    });
    contexts.set(certificate, {
      rows: census,
      scope: structuredClone(scopeBoundsFeet),
      delegated,
      sourceFrames,
      sourceSchemaBytes: Uint8Array.from(opened.nativeSourceSchemaBytes),
      nativeInstanceFrames: new Map(
        [...nativeInstanceFrames].filter(
          ([id]) => !nativeInstanceAmbiguous.has(id),
        ),
      ),
      nativeCurtainGeneratorFrames: new Map(
        [...nativeCurtainGeneratorFrames].filter(
          ([key]) => !nativeCurtainGeneratorAmbiguous.has(key),
        ),
      ),
      nativePanelSymbolFrames: new Map(
        [...panelSymbolFrames].filter(([id]) => !panelSymbolAmbiguous.has(id)),
      ),
      stairFrames: new Map(
        [...stairFrames].filter(([id]) => !stairAmbiguous.has(id)),
      ),
      floorFrames: new Map(
        [...floorFrames].filter(([id]) => !floorAmbiguous.has(id)),
      ),
      sourceCategories: new Map(
        [...headers].map(([id, list]) => [
          id,
          new Set(list.map((h) => h.categoryId)),
        ]),
      ),
    });
    return {
      certificate,
      summary: {
        sourceModelSha256: expectedSha256,
        sourceSchemaSha256: certificate.sourceSchemaSha256,
        sourceCensusSha256,
        pages,
        originalGElementVariants: rows.length,
        originalHeaderOwners: headers.size,
        originalSemanticSymbolTypes: typeOwners.size,
        originalPartMakerDelegationProofs,
        recoveredOriginalPhysicalInstances,
        refusedOriginalPhysicalInstances,
        originalRoleExcludedVariants: exclusions.length,
        originalRoleExcludedUnboundedVariants: exclusions
          .filter((row) => row.blocker)
          .map((row) => ({ ...row, reason: exclusionReason(row) })),
        reviewedDrawingInstanceCount: drawingIds.size,
        sourceDelegatedContainers: delegated,
        censusRecords: census.length,
        unboundedSourceRecords: census.filter(
          (row) => !row.boundsFeet || row.blocker,
        ),
        unknownCategorySourceRecords: census.filter(
          (row) => row.categoryId === undefined || row.categoryId === null,
        ).length,
        completeOriginalFramedGElementScan: true as const,
        completeAllSemanticPhysicalElementsApproved: false as const,
        routeApproved: false as const,
      },
    };
  } finally {
    setActiveClassTagTranslation(previousTranslation);
    setActiveElementIdBytes(previousWidth);
  }
}

/** Exact full-height station queries retain unknown and tangent source boxes.
 * Explicit replacements are reported, never silently exempted; a caller must
 * compose a separate original-source material proof for each replacement. */
export function auditOriginalForeignEnvelopeHorizontal(
  certificate: OriginalNativeForeignEnvelopeCensus,
  start: SourceWalkingPoint3,
  end: SourceWalkingPoint3,
  headroomFeet: number,
  replacementElementIds: readonly number[] = [],
) {
  const source = contexts.get(certificate);
  if (!source) throw Error("Untrusted original foreign envelope census");
  const replacements = new Set(replacementElementIds),
    low =
      cmp(rational(start[2]), rational(end[2])) < 0
        ? rational(start[2])
        : rational(end[2]),
    contacts: number[] = [],
    unbounded: number[] = [];
  const broad = planBounds(
    projectStatedTwoFootWalkingVolume(start, end, low, low, headroomFeet)
      .unclippedStatedStripFeet,
  );
  const higherFoot =
      cmp(rational(start[2]), rational(end[2])) > 0
        ? rational(start[2])
        : rational(end[2]),
    qHead = rational(headroomFeet),
    high = new Rational(
      higherFoot.n * qHead.d + qHead.n * higherFoot.d,
      higherFoot.d * qHead.d,
    );
  for (const row of source.rows) {
    if (replacements.has(row.nativeElementId)) continue;
    if (!row.boundsFeet || row.blocker) {
      unbounded.push(row.nativeElementId);
      continue;
    }
    const b = row.boundsFeet;
    if (
      cmp(rational(b.max.z), low) <= 0 ||
      cmp(rational(b.min.z), high) > 0 ||
      apart(b, broad)
    )
      continue;
    const demand = projectStatedTwoFootWalkingVolume(
        start,
        end,
        rational(b.min.z),
        rational(b.max.z),
        headroomFeet,
      ),
      ring = demand.possibleClosedProjectionFeet;
    if (
      demand.positiveProjectionArea
        ? exactClosedSourcePlanarContact([[ring]], plan(b), segments(b))
        : ring.length > 0 &&
          exactClosedSourcePlanarContact([], plan(b), segments(b), [ring])
    )
      contacts.push(row.nativeElementId);
  }
  return {
    sourceCensusSha256: certificate.sourceCensusSha256,
    candidateNativeElementIds: [...new Set(contacts)].sort((a, b) => a - b),
    unboundedNativeElementIds: [...new Set(unbounded)].sort((a, b) => a - b),
    explicitSourceReplacementsRequireSeparateMaterialProof: [
      ...replacements,
    ].sort((a, b) => a - b),
    censusRecordsChecked: source.rows.length,
    foreignHumanClearanceApproved: false as const,
    routeApproved: false as const,
  };
}

export function auditOriginalForeignEnvelopeVertical(
  certificate: OriginalNativeForeignEnvelopeCensus,
  lateralEndpointsFeet: NativeRationalPoint[],
  lowerFootFeet: Rational,
  upperFootFeet: Rational,
  headroomFeet: number,
  replacementElementIds: readonly number[] = [],
) {
  const source = contexts.get(certificate);
  if (!source) throw Error("Untrusted original foreign envelope census");
  if (
    !Number.isFinite(headroomFeet) ||
    headroomFeet <= 0 ||
    headroomFeet > 30 ||
    cmp(lowerFootFeet, upperFootFeet) > 0 ||
    !lateralEndpointsFeet.length
  )
    throw Error("Invalid vertical original foreign census demand");
  const high = new Rational(
      upperFootFeet.n * rational(headroomFeet).d +
        rational(headroomFeet).n * upperFootFeet.d,
      upperFootFeet.d * rational(headroomFeet).d,
    ),
    replacements = new Set(replacementElementIds),
    contacts: number[] = [],
    unbounded: number[] = [];
  const broad = planBounds(lateralEndpointsFeet);
  for (const row of source.rows) {
    if (replacements.has(row.nativeElementId)) continue;
    if (!row.boundsFeet || row.blocker) {
      unbounded.push(row.nativeElementId);
      continue;
    }
    const b = row.boundsFeet;
    if (
      cmp(rational(b.max.z), lowerFootFeet) <= 0 ||
      cmp(rational(b.min.z), high) > 0 ||
      apart(b, broad)
    )
      continue;
    if (
      exactClosedSourcePlanarContact([], plan(b), segments(b), [
        lateralEndpointsFeet,
      ])
    )
      contacts.push(row.nativeElementId);
  }
  return {
    sourceCensusSha256: certificate.sourceCensusSha256,
    candidateNativeElementIds: [...new Set(contacts)].sort((a, b) => a - b),
    unboundedNativeElementIds: [...new Set(unbounded)].sort((a, b) => a - b),
    explicitSourceReplacementsRequireSeparateMaterialProof: [
      ...replacements,
    ].sort((a, b) => a - b),
    censusRecordsChecked: source.rows.length,
    foreignHumanClearanceApproved: false as const,
    routeApproved: false as const,
  };
}

/** Fresh copy of a source frame retained in this context's exact finite scope.
 * This is diagnostic data, not an alternative source authority constructor. */
export function readOriginalForeignEnvelopeScopedFrame(
  certificate: OriginalNativeForeignEnvelopeCensus,
  nativeElementId: number,
) {
  const source = contexts.get(certificate);
  if (!source) throw Error("Untrusted original foreign envelope census");
  const bytes = source.sourceFrames.get(nativeElementId);
  if (!bytes) throw Error("Original scoped frame missing or ambiguous");
  return Uint8Array.from(bytes);
}

/** Original semantic Floor marker, category and geometry are retrieved from
 * the SAME actual-RVT context; a caller cannot relabel arbitrary GElements. */
export function readOriginalForeignEnvelopeScopedFloor(
  certificate: OriginalNativeForeignEnvelopeCensus,
  nativeFloorElementId: number,
) {
  const context = contexts.get(certificate);
  if (!context) throw Error("Untrusted original foreign envelope census");
  const floor = context.floorFrames.get(nativeFloorElementId),
    geometry = context.sourceFrames.get(nativeFloorElementId),
    categories = context.sourceCategories.get(nativeFloorElementId);
  if (
    !floor ||
    !geometry ||
    categories?.size !== 1 ||
    !categories.has(-2000032)
  )
    throw Error(
      "Original scoped Floor semantic, category or geometry absent/ambiguous",
    );
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    sourceSchemaSha256: certificate.sourceSchemaSha256,
    nativeFloorElementId,
    nativeCategoryId: -2000032,
    originalSourceSchemaBytes: Uint8Array.from(context.sourceSchemaBytes),
    originalFloorFrameBytes: Uint8Array.from(floor),
    originalGElementFrameBytes: Uint8Array.from(geometry),
    originalFloorFrameSha256: hash(floor),
    originalGElementFrameSha256: hash(geometry),
  };
}

/** Fresh original semantic root and embedded schema from this actual-RVT census.
 * No caller-selected JSON can mint semantic identity. */
export function readOriginalForeignEnvelopeScopedSemantic(
  certificate: OriginalNativeForeignEnvelopeCensus,
  nativeElementId: number,
  marker: 2153 | 4075 | 2031 | 4318 | 3899 | 1049 | 4316,
) {
  const context = contexts.get(certificate);
  if (!context) throw Error("Untrusted original foreign envelope census");
  const frame =
    marker === 3899 || marker === 1049 || marker === 4316
      ? context.nativeCurtainGeneratorFrames.get(`${nativeElementId}:${marker}`)
      : (marker === 2153
          ? context.floorFrames
          : marker === 4075
            ? context.stairFrames
            : marker === 2031
              ? context.nativeInstanceFrames
              : context.nativePanelSymbolFrames
        ).get(nativeElementId);
  if (!frame) throw Error("Original semantic frame absent/ambiguous");
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    sourceSchemaSha256: certificate.sourceSchemaSha256,
    nativeElementId,
    marker,
    originalCategoryDeclarations: [
      ...(context.sourceCategories.get(nativeElementId) ?? []),
    ],
    originalFrameSha256: hash(frame),
    originalFrameBytes: Uint8Array.from(frame),
    originalSourceSchemaBytes: Uint8Array.from(context.sourceSchemaBytes),
  };
}

/** Complete axis-aligned two-foot standing cap, including interior and closed
 * side/head contact. This is stronger than testing only its perimeter lines. */
export function auditOriginalForeignEnvelopeStandingSquare(
  certificate: OriginalNativeForeignEnvelopeCensus,
  center: NativeRationalPoint,
  footHeightFeet: Rational,
  headroomFeet: number,
  replacementElementIds: readonly number[] = [],
) {
  const source = contexts.get(certificate);
  if (!source) throw Error("Untrusted original foreign envelope census");
  if (
    !(footHeightFeet instanceof Rational) ||
    !Number.isFinite(headroomFeet) ||
    headroomFeet <= 0 ||
    headroomFeet > 30
  )
    throw Error("Invalid original standing demand");
  const footprint = originalTwoFootStandingSquare(center),
    broad = planBounds(footprint.flat(2)),
    h = rational(headroomFeet),
    high = new Rational(
      footHeightFeet.n * h.d + h.n * footHeightFeet.d,
      footHeightFeet.d * h.d,
    ),
    replacements = new Set(replacementElementIds),
    contacts: number[] = [],
    unbounded: number[] = [];
  for (const row of source.rows) {
    if (replacements.has(row.nativeElementId)) continue;
    if (!row.boundsFeet || row.blocker) {
      unbounded.push(row.nativeElementId);
      continue;
    }
    const b = row.boundsFeet;
    if (
      cmp(rational(b.max.z), footHeightFeet) <= 0 ||
      cmp(rational(b.min.z), high) > 0 ||
      apart(b, broad)
    )
      continue;
    if (exactClosedSourcePlanarContact(footprint, plan(b), segments(b)))
      contacts.push(row.nativeElementId);
  }
  return {
    sourceCensusSha256: certificate.sourceCensusSha256,
    candidateNativeElementIds: [...new Set(contacts)].sort((a, b) => a - b),
    unboundedNativeElementIds: [...new Set(unbounded)].sort((a, b) => a - b),
    explicitSourceReplacementsRequireSeparateMaterialProof: [
      ...replacements,
    ].sort((a, b) => a - b),
    censusRecordsChecked: source.rows.length,
    completeStatedStandingFootprintChecked: true as const,
    foreignHumanClearanceApproved: false as const,
    routeApproved: false as const,
  };
}

/** Full original retained census, with unknowns intact. These fresh transport
 * copies cannot be passed back as an original source-issued opaque handle. */
export function originalNativeForeignEnvelopeFacts(
  certificate: OriginalNativeForeignEnvelopeCensus,
) {
  const source = contexts.get(certificate);
  if (!source) throw Error("Untrusted original foreign envelope census");
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    sourceSchemaSha256: certificate.sourceSchemaSha256,
    sourceCensusSha256: certificate.sourceCensusSha256,
    scopeBoundsFeet: structuredClone(source.scope),
    rows: structuredClone(source.rows),
    delegatedOriginalContainers: structuredClone(source.delegated),
    unboundedSourceRecordCount: source.rows.filter(
      (r) => !r.boundsFeet || r.blocker,
    ).length,
    completeAllSemanticPhysicalElementsApproved: false as const,
    foreignHumanClearanceApproved: false as const,
    routeApproved: false as const,
  };
}
