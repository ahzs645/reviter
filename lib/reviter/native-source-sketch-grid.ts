/** Exact original view-grid role. The category alone never removes material.
 * Callers must supply fresh original semantic/GRep bytes and the complete
 * original ownership/header/class census. Cached envelopes are not authority. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { SchemaStream } from "./schema-reader.ts";
import type { ElementHeader } from "./element-headers.ts";
import { readNativeStairTypedFifo } from "./native-stair-typed-fifo.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const id = (value: unknown) =>
  (value as { m_id?: { m_id64?: number } } | undefined)?.m_id?.m_id64;
function checkedFrame(bytes: Uint8Array) {
  if (bytes.length < 40) throw Error("Truncated original view-grid frame");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    v.getUint32(12, true) + 20 !== bytes.length ||
    v.getUint32(bytes.length - 4, true) !== v.getUint32(12, true)
  )
    throw Error("Original view-grid frame echo differs");
  let a = 1,
    b = 0;
  for (let i = 16; i < bytes.length - 4; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  if ((b * 65536 + a) >>> 0 !== v.getUint32(8, true))
    throw Error("Original view-grid frame checksum differs");
  return v;
}
export function inspectOriginalNonPhysicalSketchGrid(input: {
  semanticBytes: Uint8Array;
  gElementBytes: Uint8Array;
  schema: SchemaStream;
  header: ElementHeader;
  /** Exact ElementTable parent, not a nearest view or bounding-box relation. */
  nativeParentId: number | null | undefined;
  originalOwnedChildIds: readonly number[];
  /** Resolved from checksummed original frames + the original schema ancestry. */
  originalViewClasses: ReadonlyMap<number, readonly string[]>;
}) {
  const semanticFrame = checkedFrame(input.semanticBytes),
    gFrame = checkedFrame(input.gElementBytes),
    parsed = readNativeStairTypedFifo(
      input.semanticBytes,
      input.schema,
      "SketchGrid",
    );
  if (!parsed.ok) throw Error(parsed.error);
  const semantic = parsed.value,
    root = semantic.root,
    nativeId = semantic.nativeElementId,
    viewId = id(root.m_dbviewId),
    classes = new Map(input.schema.classes.map((c) => [c.index, c]));
  // Independent virtual work-plane/view-grid role. Autodesk's Work Planes
  // documentation defines a virtual2D surface. Internal SketchGrid maps to that
  // role by its exact original schema, null material data, native view binding
  // and complete self-contained grid drawing—not by category/name alone.
  // Drawing controlCommand remains literal and UNQUALIFIED; it is never used
  // as a geometric no-op or as a proof that a physical body is absent.
  const sketchClass = classes.get(semantic.rootClassSlot),
    baseClass =
      sketchClass?.parent.kind === "none"
        ? undefined
        : classes.get(sketchClass?.parent.index ?? -1),
    rootFields = [
      "m_pParamValueSetDouble",
      "m_pParamValueSetInt",
      "m_pParamValueSetAString",
      "m_pParamValueSetElementId",
      "m_geomSteps",
      "m_pGeomTable",
      "m_constrInfo",
      "m_cellList",
      "m_docAccess",
      "m_id",
      "m_assocLevelId",
      "m_famId",
      "m_unplacedOwnerId",
      "m_ownerDBViewId",
      "m_createdPhaseId",
      "m_demolishedPhaseId",
      "m_designOptionId",
      "m_locked",
      "m_moribund",
      "m_dummy",
    ],
    field = sketchClass?.properties[0];
  if (
    !sketchClass ||
    sketchClass.name !== "SketchGrid" ||
    sketchClass.propertyCount !== 1 ||
    sketchClass.properties.length !== 1 ||
    sketchClass.unknownWord !== 0 ||
    !field ||
    field.name !== "m_dbviewId" ||
    field.fieldType !== 14 ||
    field.loadingMode !== 0 ||
    field.itemMode !== 0 ||
    field.unknownWord !== 0 ||
    field.staticType?.kind === "none" ||
    !field.staticType ||
    classes.get(field.staticType.index)?.name !== "ElementId" ||
    !baseClass ||
    baseClass.name !== "Element" ||
    baseClass.parent.kind !== "none" ||
    baseClass.propertyCount !== rootFields.length ||
    baseClass.properties.length !== rootFields.length ||
    baseClass.properties.some((f, i) => f.name !== rootFields[i]) ||
    Object.keys(root).length !== rootFields.length + 1 ||
    Object.keys(root).some((k) => ![...rootFields, "m_dbviewId"].includes(k))
  )
    throw Error("Original virtual view-grid schema role changed");
  for (const key of [
    "m_pParamValueSetDouble",
    "m_pParamValueSetInt",
    "m_pParamValueSetAString",
    "m_pParamValueSetElementId",
    "m_geomSteps",
    "m_pGeomTable",
    "m_cellList",
  ]) {
    const descriptor = root[key] as
      | { token?: unknown; sourceClassSlot?: unknown }
      | undefined;
    if (descriptor?.token !== 0 || descriptor.sourceClassSlot !== null)
      throw Error(
        "Original virtual view grid has nonnull parameter/material/cell data",
      );
  }
  const ancestry = (name: string) => {
    const names: string[] = [],
      seen = new Set<number>();
    let c = input.schema.classes.find((c) => c.name === name);
    while (c) {
      if (seen.has(c.index)) throw Error("Original view class ancestry cycle");
      seen.add(c.index);
      names.push(c.name);
      c = c.parent.kind === "none" ? undefined : classes.get(c.parent.index);
    }
    return names;
  };
  const isView = (view: number | null | undefined) => {
    if (!Number.isSafeInteger(view) || view! <= 0) return false;
    const names = input.originalViewClasses.get(view!);
    return (
      !!names?.length &&
      names.every((name) => ancestry(name).includes("DBView"))
    );
  };
  if (
    input.header.elementId !== nativeId ||
    input.header.categoryId !== -2000055 ||
    input.header.familyId !== null ||
    input.header.unplacedOwnerId != null ||
    (input.header.ownerViewId !== null &&
      input.header.ownerViewId !== viewId) ||
    id(root.m_id) !== nativeId ||
    id(root.m_famId) !== -1 ||
    id(root.m_assocLevelId) !== -1 ||
    ![-1, viewId].includes(id(root.m_ownerDBViewId)) ||
    id(root.m_unplacedOwnerId) !== -1 ||
    !isView(viewId) ||
    !isView(input.nativeParentId) ||
    input.originalOwnedChildIds.length ||
    root.m_moribund !== 0 ||
    root.m_dummy !== 0 ||
    semantic.entries.length ||
    !Array.isArray(root.m_constrInfo) ||
    root.m_constrInfo.length ||
    semanticFrame.getBigInt64(0, true) !== BigInt(nativeId) ||
    gFrame.getBigInt64(0, true) !== BigInt(nativeId) ||
    gFrame.getUint16(16, true) !== 2246
  )
    throw Error(
      "Original SketchGrid category, native view binding or complete semantic role differs",
    );
  const decoded = decodeRevit2027FramedGRepRoot(
    input.gElementBytes,
    {
      offset: 0,
      elementId: nativeId,
      marker: gFrame.getUint16(16, true),
      objectLength: gFrame.getUint32(12, true),
      typeCode: gFrame.getUint32(18, true),
    },
    2027,
  );
  if (!decoded.ok) throw Error(decoded.error);
  const replay = replayRevit2027GRepFifo(input.gElementBytes, decoded.value);
  if (!replay.ok) throw Error(replay.error);
  const drawing = replay.value,
    readers = new Set([
      "Revit2027GGTag",
      "Revit2027GFilter",
      "Revit2027GBitmap",
      "Revit2027GGroup",
      "Revit2027GConditionSelected",
      "Revit2027Geometry",
      "Revit2027Face",
      "Revit2027GEdge",
      "Revit2027EdgeLoop",
      "Revit2027GFilling",
      "Revit2027AnalyticSurface:634",
      "Revit2027FillPatternData",
      "Revit2027FillGrid",
    ]);
  if (
    drawing.spans.some(
      (s, i) =>
        s.ownerElementId !== BigInt(nativeId) ||
        s.replayIndex !== i ||
        !readers.has(s.readerId),
    ) ||
    drawing.descriptors.length !== drawing.spans.length ||
    drawing.descriptors.some((d) => d.state !== "queued")
  )
    throw Error(
      "Original view grid has unsupported, foreign or unread drawing children",
    );
  const parentRoles: Record<string, string | null> = {
    Revit2027GGTag: null,
    Revit2027GFilter: null,
    Revit2027GBitmap: "Revit2027GGTag",
    Revit2027GGroup: "Revit2027GFilter",
    Revit2027GConditionSelected: "Revit2027GFilter",
    Revit2027Geometry: "Revit2027GGroup",
    Revit2027Face: "Revit2027Geometry",
    Revit2027GEdge: "Revit2027Geometry",
    Revit2027EdgeLoop: "Revit2027Face",
    Revit2027GFilling: "Revit2027Face",
    "Revit2027AnalyticSurface:634": "Revit2027Face",
    Revit2027FillPatternData: "Revit2027GFilling",
    Revit2027FillGrid: "Revit2027FillPatternData",
  };
  const originalDrawingFlags: Record<string, number> = {
    Revit2027GGTag: 557252,
    Revit2027GFilter: 557060,
    Revit2027GGroup: 557060,
    Revit2027GBitmap: 557124,
    Revit2027Geometry: 573444,
    Revit2027Face: 539525636,
    Revit2027GEdge: 557572,
    Revit2027EdgeLoop: 524292,
    Revit2027GFilling: 134742020,
  };
  if (
    decoded.value.gInfo.controlCommand !== 0 ||
    decoded.value.gInfo.flags !== 559108
  )
    throw Error("Unknown original SketchGrid root drawing command/flags");
  for (const span of drawing.spans) {
    const parent =
      span.parentReplayIndex === null
        ? undefined
        : drawing.spans[span.parentReplayIndex];
    if ((parent?.readerId ?? null) !== parentRoles[span.readerId])
      throw Error(
        "Original SketchGrid drawing child has a foreign parent role",
      );
    const value = span.value as Record<string, unknown>,
      gInfo = ((value.group as { gInfo?: unknown } | undefined)?.gInfo ??
        value.gInfo) as { controlCommand: number; flags: number } | undefined;
    if (
      Object.hasOwn(originalDrawingFlags, span.readerId) &&
      (!gInfo ||
        gInfo.flags !== originalDrawingFlags[span.readerId] ||
        (span.readerId !== "Revit2027Geometry" &&
          gInfo.controlCommand !==
            (span.readerId === "Revit2027GBitmap" ? -2 : 0)))
    )
      throw Error(
        "Unknown original SketchGrid drawing primitive command/flags",
      );
  }
  const values = (reader: string) =>
    drawing.spans
      .filter((s) => s.readerId === reader)
      .map((s) => s.value) as Record<string, unknown>[];
  const faces = values("Revit2027Face"),
    geometry = values("Revit2027Geometry"),
    surfaces = values("Revit2027AnalyticSurface:634"),
    edges = values("Revit2027GEdge"),
    conditions = values("Revit2027GConditionSelected"),
    bounds = decoded.value.worldExtents;
  if (
    decoded.value.ownerElementId !== BigInt(nativeId) ||
    !bounds.valid ||
    bounds.minimum[2] !== bounds.maximum[2] ||
    values("Revit2027GGTag").length !== 1 ||
    values("Revit2027GFilter").length !== 1 ||
    values("Revit2027GGroup").length !== 1 ||
    geometry[0]?.flags !== 7 ||
    faces.length !== 1 ||
    geometry.length !== 1 ||
    surfaces.length !== 1 ||
    edges.length !== 4 ||
    values("Revit2027EdgeLoop").length !== 1 ||
    values("Revit2027GBitmap").length !== 4 ||
    conditions.length !== 1 ||
    conditions[0]!.viewElementId !== viewId ||
    conditions[0]!.compareMode !== -1 ||
    faces[0]!.faceFlags !== 4 ||
    surfaces[0]!.kind !== "plane" ||
    (surfaces[0]!.origin as number[])[2] !== bounds.minimum[2] ||
    (surfaces[0]!.xVector as number[])[2] !== 0 ||
    (surfaces[0]!.yVector as number[])[2] !== 0 ||
    edges.some(
      (e) => (e.faceReferences as number[]).filter((n) => n !== 0).length !== 1,
    ) ||
    values("Revit2027GFilling").length !== 1 ||
    values("Revit2027FillPatternData").length !== 1 ||
    values("Revit2027FillGrid").length !== 2
  )
    throw Error(
      "Original SketchGrid contains material, instance or unknown primitive roles",
    );
  return {
    nativeElementId: nativeId,
    originalViewId: viewId!,
    originalNativeParentId: input.nativeParentId!,
    originalCategoryId: input.header.categoryId,
    originalSemanticFrameSha256: hash(input.semanticBytes),
    originalGElementSha256: hash(input.gElementBytes),
    completeOriginalSemanticRootAndFifoReplayed: true as const,
    completeOriginalDrawingChildrenReplayed: true as const,
    originalDrawingReaderCounts: Object.fromEntries(
      [...readers].map((r) => [r, values(r).length]),
    ),
    originalDrawingGeometryGInfo: {
      ...(geometry[0]!.gInfo as Record<string, unknown>),
      gStyleElementId: String(
        (geometry[0]!.gInfo as { gStyleElementId: bigint }).gStyleElementId,
      ),
    },
    originalDrawingWorldBounds: bounds,
    sourceQualifiedNonPhysicalViewGrid: true as const,
    sourceCategoryAloneUsedAsPhysicalAbsence: false as const,
    independentVirtualViewGridRoleEstablished: true as const,
    drawingControlCommandQualified: false as const,
    drawingUsedForPhysicalClearance: false as const,
    routeApproved: false as const,
  };
}

/** Whole-ID role classification is allowed only when EVERY recognized source
 * variant is the same completely qualified drawing. Invalid, oversized and
 * unconsumed variants retain their original obstruction/blocker. */
export function originalSketchGridCensusVariantsMatch(
  proof: { nativeElementId: number; originalGElementSha256: string },
  rows: readonly {
    nativeElementId: number;
    sourceFrameSha256: string;
    blocker?: string;
  }[],
) {
  const own = rows.filter((r) => r.nativeElementId === proof.nativeElementId);
  return (
    own.length > 0 &&
    /^[a-f0-9]{64}$/.test(proof.originalGElementSha256) &&
    own.every(
      (r) =>
        r.blocker === undefined &&
        r.sourceFrameSha256 === proof.originalGElementSha256,
    )
  );
}
