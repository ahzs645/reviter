/** Unwired native simple-system-panel constructor replay. Current generator
 * cell ownership is source-bound; empty graphics never imply absent material.
 * Candidate enclosures remain unissued pending independent source review. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { readSchema } from "./schema-reader.ts";
import { readOriginalCurtainHostTypedFifo } from "./native-source-curtain-host.ts";
import { readOriginalCurtainInstanceTypedFifo } from "./native-source-curtain-instance.ts";
import { readOriginalPanelSymbolTypedFifo } from "./native-source-panel-symbol.ts";
import {
  readOriginalForeignEnvelopeScopedSemantic,
  readOriginalForeignEnvelopeScopedFrame,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  walkRevit2027DirectedLoopEdges,
  revit2027DirectedEdgeUvs,
} from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import { Rational, rational } from "./native-rational-overlay.ts";
type Obj = Record<string, unknown>;
type Q3 = [Rational, Rational, Rational];
export type NativeSimplePanelFrames = {
  schema: Uint8Array;
  instanceNative: Uint8Array;
  symbolNative: Uint8Array;
  hostNative: Uint8Array;
  instanceGElement: Uint8Array;
  symbolGElement: Uint8Array;
  hostGElement: Uint8Array;
};
const hash = (b: Uint8Array) => bytesToHex(sha256(b));
const add = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
  sub = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
  mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d),
  cmp = (a: Rational, b: Rational) =>
    a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0,
  abs = (a: Rational) => new Rational(a.n < 0n ? -a.n : a.n, a.d);
const id = (v: unknown) => (v as { m_id?: { m_id64?: unknown } })?.m_id?.m_id64;
const rec = (v: unknown): Obj => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Missing original native object");
  return v as Obj;
};
const array = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw Error("Missing original native collection");
  return v;
};
const tuple = (v: unknown, n: number): number[] => {
  if (
    !Array.isArray(v) ||
    v.length !== n ||
    v.some((x) => typeof x !== "number" || !Number.isFinite(x))
  )
    throw Error("Unsupported original finite tuple");
  return v as number[];
};
function checkedNativeFrame(bytes: Uint8Array, marker: number) {
  if (bytes.length < 40) throw Error("Truncated native panel source frame");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    n = v.getUint32(12, true);
  if (
    v.getUint32(4, true) !== 0 ||
    v.getUint16(16, true) !== marker ||
    n + 20 !== bytes.length ||
    v.getUint32(n + 16, true) !== n
  )
    throw Error("Native panel frame identity/length mismatch");
  let a = 1,
    b = 0;
  for (let i = 16; i < n + 16; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  if ((b * 65536 + a) >>> 0 !== v.getUint32(8, true))
    throw Error("Native panel source checksum mismatch");
}
function geometry(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 40 ||
    v.getUint32(4, true) !== 0 ||
    v.getUint16(16, true) !== 2246
  )
    throw Error("Unsupported original GElement identity");
  const nativeId = v.getUint32(0, true),
    length = v.getUint32(12, true);
  if (length + 20 !== bytes.length || v.getUint32(length + 16, true) !== length)
    throw Error("Original GElement length mismatch");
  let a = 1,
    b = 0;
  for (let i = 16; i < length + 16; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  if ((b * 65536 + a) >>> 0 !== v.getUint32(8, true))
    throw Error("Original GElement checksum mismatch");
  const r = decodeRevit2027FramedGRepRoot(
    bytes,
    {
      offset: 0,
      elementId: nativeId,
      marker: 2246,
      objectLength: length,
      typeCode: v.getUint32(18, true),
    },
    2027,
  );
  if (!r.ok) throw Error(r.error);
  if (r.value.objectType !== 3 || ![0, 2].includes(r.value.flags))
    throw Error("Unsupported original GElement frame semantics");
  const p = replayRevit2027GRepFifo(bytes, r.value, undefined, {
    maxReplayEntries: 100000,
    maxDescriptors: 400000,
  });
  if (!p.ok) throw Error(p.error);
  return p.value;
}
/** Exact row-absolute affine image of a local all-axis padding cube. Both
 * normal orientations and nonuniform scales/reflections remain enclosed. */
export function simplePanelAffinePadding(
  matrix: readonly (readonly number[])[],
  thickness: number,
  offset: number,
) {
  if (
    matrix.length !== 3 ||
    matrix.some((r) => r.length !== 3) ||
    [...matrix.flat(), thickness, offset].some((x) => !Number.isFinite(x)) ||
    thickness < 0
  )
    throw Error("Unsupported panel affine or native thickness");
  const m = matrix.map((r) => r.map(rational));
  const determinant = add(
    sub(
      mul(m[0]![0]!, sub(mul(m[1]![1]!, m[2]![2]!), mul(m[1]![2]!, m[2]![1]!))),
      mul(m[0]![1]!, sub(mul(m[1]![0]!, m[2]![2]!), mul(m[1]![2]!, m[2]![0]!))),
    ),
    mul(m[0]![2]!, sub(mul(m[1]![0]!, m[2]![1]!), mul(m[1]![1]!, m[2]![0]!))),
  );
  if (determinant.n === 0n) throw Error("Singular original panel affine");
  const localPadding = add(abs(rational(thickness)), abs(rational(offset))),
    worldPadding = m.map((r) =>
      mul(
        r.reduce((a, b) => add(a, abs(b)), rational(0)),
        localPadding,
      ),
    ) as Q3;
  return {
    localPaddingFeet: localPadding,
    worldAxisPaddingFeet: worldPadding,
    exactAffineDeterminant: determinant,
  };
}
function point(plane: Revit2027PlaneSurface, uv: readonly number[]): Q3 {
  return [0, 1, 2].map((i) =>
    add(
      add(
        rational(plane.origin[i]!),
        mul(rational(plane.xVector[i]!), rational(uv[0]!)),
      ),
      mul(rational(plane.yVector[i]!), rational(uv[1]!)),
    ),
  ) as Q3;
}
function finitePlane(p: Revit2027PlaneSurface) {
  if (
    p.kind !== "plane" ||
    p.sourceClassSlot !== 634 ||
    p.queuedProperties.length
  )
    throw Error("Unsupported native cell surface operand");
  const corners = p.surface.envelope;
  for (const a of [
    ...p.origin,
    ...p.xVector,
    ...p.yVector,
    ...corners.firstCorner,
    ...corners.secondCorner,
  ])
    if (!Number.isFinite(a) || Math.abs(a) >= 1e29)
      throw Error("Unbounded original cell plane domain");
  if (corners.firstCorner.some((v, i) => v >= corners.secondCorner[i]!))
    throw Error("Degenerate original cell plane domain");
  const [x, y] = [p.xVector.map(rational), p.yVector.map(rational)];
  if (
    [
      sub(mul(x[1]!, y[2]!), mul(x[2]!, y[1]!)),
      sub(mul(x[2]!, y[0]!), mul(x[0]!, y[2]!)),
      sub(mul(x[0]!, y[1]!), mul(x[1]!, y[0]!)),
    ].every((x) => x.n === 0n)
  )
    throw Error("Degenerate original native plane basis");
  return [
    point(p, corners.firstCorner),
    point(p, [corners.firstCorner[0], corners.secondCorner[1]]),
    point(p, corners.secondCorner),
    point(p, [corners.secondCorner[0], corners.firstCorner[1]]),
  ];
}
function bounds(points: Q3[], pad: Q3) {
  if (!points.length) throw Error("Missing native profile points");
  return {
    minimumFeet: [0, 1, 2].map((i) =>
      sub(
        points.map((p) => p[i]!).reduce((a, b) => (cmp(a, b) < 0 ? a : b)),
        pad[i]!,
      ),
    ) as Q3,
    maximumFeet: [0, 1, 2].map((i) =>
      add(
        points.map((p) => p[i]!).reduce((a, b) => (cmp(a, b) > 0 ? a : b)),
        pad[i]!,
      ),
    ) as Q3,
  };
}
function emptyFields(root: Obj, names: string[]) {
  for (const name of names)
    if (array(root[name]).length)
      throw Error(`Unsupported native panel operation ${name}`);
}
function exactAffine(
  matrix: number[][],
  origin: number[],
  p: readonly Rational[],
): Q3 {
  return [0, 1, 2].map((i) =>
    matrix[i]!.reduce(
      (a, v, j) => add(a, mul(rational(v), p[j]!)),
      rational(origin[i]!),
    ),
  ) as Q3;
}
/** Pure reconstruction on untrusted ORIGINAL-frame-shaped bytes. This may
 * support fixtures/independent controls, but cannot mint source authority. */
export function inspectSimpleSystemPanelFrames(
  frames: NativeSimplePanelFrames,
) {
  try {
    checkedNativeFrame(frames.instanceNative, 2031);
    checkedNativeFrame(frames.symbolNative, 4318);
    checkedNativeFrame(frames.hostNative, 3899);
    const parsed = readSchema(frames.schema);
    if (!parsed.ok) throw Error(parsed.error);
    const schema = parsed.schema,
      instance = readOriginalCurtainInstanceTypedFifo(
        frames.instanceNative,
        schema,
      ),
      symbol = readOriginalPanelSymbolTypedFifo(frames.symbolNative, schema),
      host = readOriginalCurtainHostTypedFifo(
        frames.hostNative,
        schema,
        "SWall",
      );
    if (!instance.ok) throw Error(instance.error);
    if (!symbol.ok) throw Error(symbol.error);
    if (!host.ok) throw Error(host.error);
    const ir = instance.value.root,
      sr = symbol.value.root,
      one = (rows: unknown[], message: string) => {
        if (rows.length !== 1) throw Error(message);
        return rows[0]!;
      },
      info = rec(
        one(
          instance.value.entries.filter(
            (e) => e.sourceClassName === "InstanceInfo",
          ),
          "Ambiguous native panel InstanceInfo",
        ),
      ).value as Obj,
      reference = rec(
        rec(
          one(
            instance.value.entries.filter(
              (e) => e.sourceClassName === "CurtainCellFamRef",
            ),
            "Unsupported native panel reference",
          ),
        ).value,
      ),
      nativeInstanceId = instance.value.nativeElementId,
      nativeDefinitionId = symbol.value.nativeElementId,
      nativeHostId = host.value.nativeElementId;
    if (
      id(ir.m_hostId) !== nativeHostId ||
      id(reference.m_hostId) !== nativeHostId ||
      id(info.m_symbolId) !== nativeDefinitionId ||
      reference.m_driverId !== -1 ||
      info.m_GRepId !== 0
    )
      throw Error("Original instance/host/symbol/cell ownership differs");
    if (sr.m_isHostPanelSym !== 0 && sr.m_isHostPanelSym !== 1)
      throw Error("Unsupported original system-panel mode");
    if (
      sr.m_hasBadLoops !== 0 ||
      sr.m_stretchCount !== 0 ||
      sr.m_bMayBeStretchable !== 0 ||
      sr.m_bConfirmedStretchable !== 0
    )
      throw Error("Unsupported source panel stretch/bad-loop semantics");
    emptyFields(ir, [
      "m_constrInfo",
      "m_extraHostIds",
      "m_explicitHostIds",
      "m_offsetPosArr",
      "m_subInstTable",
    ]);
    emptyFields(sr, [
      "m_constrInfo",
      "m_pCutLoops",
      "m_cutDirs",
      "m_cutIndices",
      "m_closurePlanes",
      "m_nonBRepGeomPtrs",
      "m_complexCutRefIds",
      "m_complexCutGeoms",
      "m_dummyHostGeoms",
      "m_arrProfileLoops",
      "m_subInstData",
      "m_subElemData",
      "m_lightSrcGReps",
      "m_imposterLightTrfs",
    ]);
    for (const v of [instance.value, symbol.value]) {
      for (const e of v.entries) {
        if (
          e.sourceClassName === "FamilyParams" &&
          array(e.value.m_params).length
        )
          throw Error(
            "Uninterpreted native panel instance/symbol parameter operand",
          );
        if (
          e.sourceClassName === "SysPanelFamSymPatternHelper" &&
          (array(e.value.m_PatternPositionMap).length ||
            array(e.value.m_substituteFaceMap).length)
        )
          throw Error("Unsupported native panel pattern substitution");
        if (e.sourceClassName === "GeomStepList") {
          for (const [k, value] of Object.entries(e.value))
            if (
              k.endsWith("GList") &&
              k !== "m_bRepFormGList" &&
              array(value).length
            )
              throw Error("Unsupported extra panel geometry generator");
          if (v === instance.value && array(e.value.m_bRepFormGList).length)
            throw Error("Unsupported instance panel geometry generator");
          if (v === symbol.value) {
            const list = array(e.value.m_bRepFormGList);
            if (list.length !== 1 || rec(list[0]).sourceClassSlot !== 588)
              throw Error("Unsupported simple system-panel form generator");
          }
        }
      }
    }
    const permittedInstanceEntries = new Set([
      "GeomTable",
      "CellList",
      "InstanceInfo",
      "CurtainCellFamRef",
      "FamilyParams",
      "AnalyticalSpaceBoundingCell",
      "FamilyInstancePatternHelper",
      "FamInstDoor",
      "HostPanelRefData",
    ]);
    const permittedSymbolEntries = new Set([
      "GeomStepList",
      "GeomTable",
      "CellList",
      "SymbolInfo",
      "FamilyParams",
      "CurtainCellSymFamRef",
      "Matrix",
      "BaseFamilySymbolGStep",
      "SysPanelFamSymPatternHelper",
      "Plane",
      "CurveLoop",
      "GLine",
    ]);
    if (
      instance.value.entries.some(
        (e) => !permittedInstanceEntries.has(e.sourceClassName),
      ) ||
      symbol.value.entries.some(
        (e) => !permittedSymbolEntries.has(e.sourceClassName),
      )
    )
      throw Error("Uninterpreted simple panel source operand class");
    for (const key of [
      "m_geomSteps",
      "m_pDesignPropManager",
      "m_pCurveDriver",
      "m_pInplaceInsertionHelper",
      "m_pConnectorManager",
      "m_posRelToGrid",
      "m_oFamInstUserData",
      "m_oPOFDriver",
    ])
      if (rec(ir[key]).token !== 0)
        throw Error(`Unsupported native instance source driver ${key}`);
    if (rec(ir.m_oFamInstSpec).token !== 0) {
      const descriptor = rec(ir.m_oFamInstSpec),
        entry = instance.value.entries.filter(
          (e) =>
            e.descriptor.start === descriptor.start &&
            e.descriptor.end === descriptor.end,
        );
      if (
        entry.length !== 1 ||
        entry[0]!.sourceClassName !== "FamInstDoor" ||
        rec(entry[0]!.value.m_pInst).staticReference !== 2 ||
        typeof entry[0]!.value.m_doorNumber !== "string"
      )
        throw Error("Unsupported original instance specification operand");
    }
    if (
      array(ir.m_refs).length !== 1 ||
      rec(array(ir.m_refs)[0]).sourceClassSlot !== 1043 ||
      array(sr.m_refs).length !== 1 ||
      rec(array(sr.m_refs)[0]).sourceClassSlot !== 1044
    )
      throw Error("Unexpected native panel reference consumer");
    for (const e of instance.value.entries)
      if (
        e.sourceClassName === "FamilyInstancePatternHelper" &&
        (array(e.value.m_PatternPositionMap).length ||
          array(e.value.m_substituteFaceMap).length)
      )
        throw Error("Unsupported native instance pattern substitution");
    for (const e of symbol.value.entries)
      if (
        e.sourceClassName === "BaseFamilySymbolGStep" &&
        rec(e.value.m_oExtraDatas).token !== 0
      )
        throw Error("Unsupported extra native panel form data");
    if (
      sr.m_isHostPanelSym === 0 &&
      rec(reference.m_hostPanelRefData).token !== 0
    )
      throw Error("Unsupported mode0 host-panel material delegation");
    const trf = rec(info.m_Trf),
      matrix = array(trf.m_3x3).map((r) => tuple(r, 3)),
      origin = tuple(trf.m_or, 3),
      thickness = sr.m_thickness,
      offset = sr.m_offset;
    if (typeof thickness !== "number" || typeof offset !== "number")
      throw Error("Missing native system-panel thickness/offset");
    const padding = simplePanelAffinePadding(matrix, thickness, offset);
    const occurrence = geometry(frames.instanceGElement),
      definition = geometry(frames.symbolGElement),
      hostGeometry = geometry(frames.hostGElement);
    if (
      Number(occurrence.ownerElementId) !== nativeInstanceId ||
      Number(definition.ownerElementId) !== nativeDefinitionId ||
      Number(hostGeometry.ownerElementId) !== nativeHostId
    )
      throw Error("Original geometry owner mismatch");
    const bindings = collectRevit2027GInstanceBindings(occurrence);
    if (
      !bindings.ok ||
      bindings.value.length !== 1 ||
      bindings.value[0]!.kind !== "external" ||
      bindings.value[0]!.instance.cda !== 1 ||
      bindings.value[0]!.instance.hasScale !== false ||
      bindings.value[0]!.instance.resolveSymbolInView !== false ||
      bindings.value[0]!.instance.forbiddenTarget !== 0 ||
      occurrence.spans.length !== 2 ||
      occurrence.spans.some(
        (s) =>
          !["Revit2027GInstance", "Revit2027InstanceInfo"].includes(s.readerId),
      )
    )
      throw Error("Unsupported original panel occurrence branches");
    const binding = bindings.value[0]!.instance,
      t = binding.transform,
      gMatrix = [0, 1, 2].map((i) => [t.xAxis[i], t.yAxis[i], t.zAxis[i]]);
    if (
      Number(binding.symbolElementId) !== nativeDefinitionId ||
      binding.gRepId !== 0 ||
      JSON.stringify(gMatrix) !== JSON.stringify(matrix) ||
      JSON.stringify(t.origin) !== JSON.stringify(origin)
    )
      throw Error("Native and GInstance panel affine/definition disagree");
    const gridEntry = one(
        host.value.entries.filter((e) => e.sourceClassName === "CurtainGrid"),
        "Missing/ambiguous original current curtain grid",
      ) as (typeof host.value.entries)[number],
      divide = one(
        host.value.entries.filter(
          (e) => e.sourceClassName === "CGridDivideFaceGStep",
        ),
        "Missing/ambiguous original cell generator",
      ) as (typeof host.value.entries)[number];
    if (
      !array(gridEntry.value.m_panelIds).some(
        (v) => id(v) === nativeInstanceId,
      ) ||
      divide.value.m_version !== 16 ||
      divide.value.m_driverId !== -1 ||
      divide.value.m_flags !== 761725 ||
      rec(divide.value.m_pElem).staticReference !== 2 ||
      rec(divide.value.m_oExtraDatas).token !== 0
    )
      throw Error("Unsupported current panel generator/membership/version");
    const hostStep = one(
        host.value.entries.filter((e) => e.sourceClassName === "GeomStepList"),
        "Missing current host operation list",
      ) as (typeof host.value.entries)[number],
      tweaks = array(hostStep.value.m_bRepTweakGList),
      last = rec(tweaks.at(-1));
    if (
      last.start !== divide.descriptor.start ||
      last.end !== divide.descriptor.end ||
      last.sourceClassSlot !== 704
    )
      throw Error(
        "Cell generator is not the final original host tweak operation",
      );
    const precedingDescriptor = rec(tweaks.at(-2)),
      preceding = host.value.entries.filter(
        (e) =>
          e.sourceClassName === "CWallGridFaceGStep" &&
          e.descriptor.start === precedingDescriptor.start &&
          e.descriptor.end === precedingDescriptor.end,
      );
    if (
      preceding.length !== 1 ||
      precedingDescriptor.sourceClassSlot !== 710 ||
      preceding[0]!.value.m_version !== 1 ||
      preceding[0]!.value.m_flags !== 761725 ||
      rec(preceding[0]!.value.m_pElem).staticReference !== 2 ||
      rec(preceding[0]!.value.m_oExtraDatas).token !== 0
    )
      throw Error("Unsupported original predecessor grid-face operation state");
    const cell = rec(
        one(
          array(divide.value.m_cellMap).filter(
            (c) => id(rec(rec(c).second).m_panelId) === nativeInstanceId,
          ),
          "Missing/ambiguous current source cell",
        ),
      ),
      cellBody = rec(cell.second),
      faceTag = cellBody.m_faceTag;
    if (!Number.isSafeInteger(faceTag) || Number(faceTag) <= 0)
      throw Error("Unsupported original cell face tag");
    const cellUV = rec(cell.first),
      outputRole = one(
        array(divide.value.m_faceHistTable).filter(
          (item) => rec(item).m_id === faceTag,
        ),
        "Missing or ambiguous native current output cell role",
      );
    if (
      !Number.isSafeInteger(cellUV.m_u) ||
      !Number.isSafeInteger(cellUV.m_v) ||
      JSON.stringify(rec(rec(outputRole).m_faceHist).m_keys) !==
        JSON.stringify([14, cellUV.m_v, cellUV.m_u])
    )
      throw Error("Native current cell UV/output role14 disagree");
    const index = revit2027OwnerMeshIndex(hostGeometry),
      facePair = one(
        [...index.faces].filter(([, f]) => f.gInfo.tag === faceTag),
        "Current cell face tag is missing/duplicated",
      ) as [
        number,
        typeof index.faces extends ReadonlyMap<number, infer F> ? F : never,
      ],
      faceToken = facePair[0],
      face = facePair[1],
      surface = revit2027OwnerSurface<Revit2027PlaneSurface>(
        index,
        634,
        faceToken,
      );
    if (
      !surface ||
      face.surface.sourceClassSlot !== 634 ||
      face.faceRegions.count ||
      face.cutType !== 0
    )
      throw Error("Unsupported original finite panel cell Face");
    const spanIndex = hostGeometry.spans.findIndex(
      (s) => s.readerId === "Revit2027Face" && s.propertyToken === faceToken,
    );
    if (spanIndex < 0) throw Error("Missing source cell face span");
    const ancestors = [];
    let parent = hostGeometry.spans[spanIndex]!.parentReplayIndex;
    while (parent !== null) {
      const s = hostGeometry.spans[parent]!;
      if (
        !["Revit2027Geometry", "Revit2027GGroup", "Revit2027GFilter"].includes(
          s.readerId,
        )
      )
        throw Error("Unsupported affine/view branch above current source cell");
      ancestors.push({
        replayIndex: parent,
        readerId: s.readerId,
        propertyToken: s.propertyToken,
      });
      parent = s.parentReplayIndex;
    }
    const originalDeclaredCellDomain = surface.surface.envelope;
    const hasDirectFiniteDomain = originalDeclaredCellDomain.firstCorner.every(
      (v, i) => v < originalDeclaredCellDomain.secondCorner[i]!,
    );
    const profilePoints: Q3[] = [];
    const trimOperands: unknown[] = [];
    const retainedPredecessorProfileOperands: unknown[] = [];
    let inputBounds: ReturnType<typeof bounds> | undefined;
    if (hasDirectFiniteDomain) profilePoints.push(...finitePlane(surface));
    else {
      if (
        JSON.stringify(originalDeclaredCellDomain) !==
        JSON.stringify({ firstCorner: [1, 1], secondCorner: [0, 0] })
      )
        throw Error("Unsupported inverted source cell domain");
      const previousDescriptor = rec(tweaks.at(-2));
      const previous = host.value.entries.filter(
        (e) =>
          e.sourceClassName === "CWallGridFaceGStep" &&
          e.descriptor.start === previousDescriptor.start &&
          e.descriptor.end === previousDescriptor.end,
      );
      if (
        previous.length !== 1 ||
        previousDescriptor.sourceClassSlot !== 710 ||
        previous[0]!.value.m_version !== 1 ||
        previous[0]!.value.m_flags !== 761725 ||
        rec(previous[0]!.value.m_pElem).staticReference !== 2 ||
        rec(previous[0]!.value.m_oExtraDatas).token !== 0
      )
        throw Error("Missing exact predecessor grid-face operation lineage");
      for (const item of array(divide.value.m_originalToEdgeSegs))
        for (const segment of array(rec(rec(item).second).m_edgeSegs)) {
          const v = rec(segment);
          if (
            typeof v.m_start !== "number" ||
            typeof v.m_end !== "number" ||
            v.m_start < 0 ||
            v.m_start > v.m_end ||
            v.m_end > 1
          )
            throw Error("Original subdivision range extends input geometry");
        }
      const sameFrame = (p: Revit2027PlaneSurface) =>
        JSON.stringify([p.origin, p.xVector, p.yVector]) ===
        JSON.stringify([surface.origin, surface.xVector, surface.yVector]);
      // Class-specific native2027 CWallGridFace(v1) input-role14 and
      // CGridDivideFace(v16) output-role14 bind the retained input profile to
      // this exact current cell. Other wall history operations are not decoded.
      const inputRole = one(
        array(previous[0]!.value.m_faceHistTable).filter(
          (item) =>
            JSON.stringify(rec(rec(item).m_faceHist).m_keys) ===
            JSON.stringify([14, -1, -1]),
        ),
        "Missing or ambiguous native predecessor grid-input role14",
      );
      const inputTag = rec(inputRole).m_id,
        matches = [...index.faces].filter(([, f]) => f.gInfo.tag === inputTag);
      if (matches.length !== 1)
        throw Error(
          "Native predecessor input profile tag is missing or duplicated",
        );
      const [ft, f] = matches[0]!,
        sf = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, ft);
      if (
        !sf ||
        !sameFrame(sf) ||
        f.surface.sourceClassSlot !== 634 ||
        f.cutType !== 0 ||
        f.faceRegions.count
      )
        throw Error(
          "Native predecessor input profile frame differs from current cell",
        );
      profilePoints.push(...finitePlane(sf));
      retainedPredecessorProfileOperands.push({
        sourceGenerator: previous[0],
        sourceInputRole: inputRole,
        sourceOutputRole: outputRole,
        sourceFaceToken: ft,
        sourceFace: f,
        sourcePlane: sf,
      });
    }
    const appendBoundaries = (
      selectedFaceToken: number,
      selectedSurface: Revit2027PlaneSurface,
    ) => {
      const selectedFace = index.faces.get(selectedFaceToken)!;
      const usedLoops = new Set<number>();
      let loopToken = selectedFace.firstLoop.token;
      while (loopToken) {
        if (usedLoops.has(loopToken))
          throw Error("Repeated original cell loop");
        usedLoops.add(loopToken);
        const loop = index.loops.get(loopToken);
        if (
          !loop ||
          loop.loop.open ||
          loop.loop.faceReference !== selectedFaceToken
        )
          throw Error("Unsupported original cell loop");
        const walk = walkRevit2027DirectedLoopEdges({
          faceToken: selectedFaceToken,
          loop,
          edges: index.edges,
          loopArity: "open",
        });
        if (!walk.ok) throw Error("Incomplete original current cell coedges");
        for (const e of walk.edges) {
          if (e.edge.interiorEdgePoints.length)
            throw Error("Curved or sampled original panel trim is unsupported");
          const uvs = revit2027DirectedEdgeUvs(e);
          profilePoints.push(...uvs.map((uv) => point(selectedSurface, uv)));
          for (const [side, ft] of e.edge.faceReferences.entries()) {
            if (ft === 0) continue;
            const sf = revit2027OwnerSurface<Revit2027PlaneSurface>(
              index,
              634,
              ft,
            );
            if (!sf) throw Error("Unsupported original panel twin surface");
            finitePlane(sf);
            for (const p of e.edge.firstAndLastEdgePoints)
              profilePoints.push(
                point(sf, side === 0 ? p.firstFaceUv : p.secondFaceUv),
              );
          }
          trimOperands.push({
            sourceEdgeToken: e.token,
            sourceEdge: e.edge,
            side: e.side,
            uvs,
          });
        }
        loopToken = loop.loop.nextLoop.token;
      }
    };
    if (!hasDirectFiniteDomain) {
      for (const operand of retainedPredecessorProfileOperands) {
        const p = rec(operand);
        appendBoundaries(
          Number(p.sourceFaceToken),
          p.sourcePlane as Revit2027PlaneSurface,
        );
      }
      inputBounds = bounds(profilePoints, [
        rational(0),
        rational(0),
        rational(0),
      ]);
    }
    const inputPointCount = profilePoints.length;
    appendBoundaries(faceToken, surface);
    const retainedCurrentCellEdgeReferences = [];
    if (!hasDirectFiniteDomain) {
      for (const tag of array(cellBody.m_edgeTags)) {
        if (!Number.isSafeInteger(tag) || Number(tag) < -1)
          throw Error("Unsupported original cell edge reference");
        if (tag === -1) {
          retainedCurrentCellEdgeReferences.push({
            tag,
            explicitAbsentBoundary: true,
          });
          continue;
        }
        const matches = [...index.edges].filter(([, e]) => e.gInfo.tag === tag);
        if (matches.length > 1)
          throw Error("Duplicated positive current cell edge tag");
        for (const [token, e] of matches) {
          if (e.interiorEdgePoints.length)
            throw Error("Unsupported sampled current cell boundary");
          for (const [side, ft] of e.faceReferences.entries()) {
            if (ft === 0) continue;
            const sf = revit2027OwnerSurface<Revit2027PlaneSurface>(
              index,
              634,
              ft,
            );
            if (!sf) throw Error("Unsupported cell-boundary twin source plane");
            for (const p of e.firstAndLastEdgePoints)
              profilePoints.push(
                point(sf, side === 0 ? p.firstFaceUv : p.secondFaceUv),
              );
          }
          retainedCurrentCellEdgeReferences.push({
            tag,
            sourceToken: token,
            sourceEdge: e,
          });
        }
        if (!matches.length)
          retainedCurrentCellEdgeReferences.push({
            tag,
            notPresentInFinalSavedGeometry: true,
          });
      }
      if (
        !inputBounds ||
        profilePoints
          .slice(inputPointCount)
          .some((p) =>
            p.some(
              (v, i) =>
                cmp(v, inputBounds!.minimumFeet[i]!) < 0 ||
                cmp(v, inputBounds!.maximumFeet[i]!) > 0,
            ),
          )
      )
        throw Error(
          "Current cell embedding exits complete finite predecessor input profile",
        );
    }
    const envelopes = [
      {
        kind: "original-current-cell-profile",
        ...bounds(profilePoints, padding.worldAxisPaddingFeet),
      },
    ];
    const retainedSymbolProfileOperands = [];
    const symbolProfileLinePoints: Q3[] = [];
    for (const e of symbol.value.entries) {
      if (e.sourceClassName === "Plane") {
        const v = e.value,
          c = tuple(
            rec(v.m_Envelope).m_corners
              ? array(rec(v.m_Envelope).m_corners)[0]
              : null,
            2,
          ),
          d = tuple(array(rec(v.m_Envelope).m_corners)[1], 2),
          o = tuple(v.m_origin, 3),
          x = tuple(v.m_xVec, 3),
          y = tuple(v.m_yVec, 3),
          local = [c, [c[0]!, d[1]!], d, [d[0]!, c[1]!]].map(
            (uv) =>
              [0, 1, 2].map((i) =>
                add(
                  add(rational(o[i]!), mul(rational(x[i]!), rational(uv[0]!))),
                  mul(rational(y[i]!), rational(uv[1]!)),
                ),
              ) as Q3,
          );
        if (
          c.some((v, i) => v >= d[i]!) ||
          [...c, ...d, ...o, ...x, ...y].some((v) => Math.abs(v) >= 1e29)
        )
          throw Error("Unbounded original symbol profile");
        const world = local.map((p) => exactAffine(matrix, origin, p));
        envelopes.push({
          kind: "retained-original-symbol-plane-profile",
          ...bounds(world, padding.worldAxisPaddingFeet),
        });
        retainedSymbolProfileOperands.push({
          replayIndex: e.replayIndex,
          descriptor: e.descriptor,
          value: e.value,
        });
      } else if (e.sourceClassName === "GLine") {
        const v = e.value,
          o = tuple(v.m_origin, 3),
          d = tuple(v.m_dirVec, 3),
          params = tuple(v.m_endParams, 2),
          world = params.map((t) =>
            exactAffine(
              matrix,
              origin,
              o.map((a, i) =>
                add(rational(a), mul(rational(d[i]!), rational(t))),
              ),
            ),
          );
        symbolProfileLinePoints.push(...world);
        envelopes.push({
          kind: "retained-original-symbol-finite-profile-line",
          ...bounds(world, padding.worldAxisPaddingFeet),
        });
        retainedSymbolProfileOperands.push({
          replayIndex: e.replayIndex,
          descriptor: e.descriptor,
          value: e.value,
        });
      }
    }
    for (const e of symbol.value.entries)
      if (
        e.sourceClassName === "CurveLoop" &&
        (e.value.m_open !== 0 ||
          array(e.value.m_curves).some((d) => rec(d).sourceClassSlot !== 1973))
      )
        throw Error("Unsupported native panel profile curve/loop");
    if (
      symbolProfileLinePoints.length &&
      !envelopes.some(
        (b) =>
          b.kind === "retained-original-symbol-plane-profile" &&
          symbolProfileLinePoints.every((p) =>
            p.every(
              (v, i) =>
                cmp(v, b.minimumFeet[i]!) >= 0 &&
                cmp(v, b.maximumFeet[i]!) <= 0,
            ),
          ),
      )
    )
      throw Error(
        "Complete symbol profile is not inside one finite convex plane enclosure",
      );
    const bodyAllowedReaders = new Set([
      "Revit2027Geometry",
      "Revit2027Face",
      "Revit2027GEdge",
      "Revit2027EdgeLoop",
      "Revit2027AnalyticSurface:634",
      "Revit2027GFilling",
    ]);
    if (
      definition.spans.some(
        (s) =>
          !bodyAllowedReaders.has(s.readerId) ||
          s.ownerElementId !== definition.ownerElementId,
      )
    )
      throw Error("Unsupported saved native panel body operand");
    const retainedSavedBodyFillingAttributes = definition.spans
      .filter((s) => s.readerId === "Revit2027GFilling")
      .map((s) => {
        const p =
            s.parentReplayIndex === null
              ? undefined
              : definition.spans[s.parentReplayIndex],
          f = rec(s.value),
          face = p ? rec(p.value) : undefined;
        if (
          !p ||
          p.readerId !== "Revit2027Face" ||
          f.faceIdReference !== p.propertyToken ||
          ![
            rec(face!.foregroundFilling).token,
            rec(face!.backgroundFilling).token,
          ].includes(s.propertyToken) ||
          rec(f.data).token !== 0 ||
          array(f.queuedProperties).length ||
          f.flags !== 18
        )
          throw Error("Unowned or geometric saved panel filling operand");
        return {
          sourceToken: s.propertyToken,
          sourceFaceToken: p.propertyToken,
          value: s.value,
        };
      });
    const bodyGeometries = definition.spans.filter(
      (s) => s.readerId === "Revit2027Geometry",
    );
    if (
      bodyGeometries.length !== 1 ||
      bodyGeometries[0]!.parentReplayIndex !== null
    )
      throw Error("Unsupported saved source panel Geometry branches");
    const bodyDeclared = bodyGeometries[0]!.value as {
      faces: {
        count: number;
        entries: { token: number; sourceClassSlot: number }[];
      };
      edges: {
        count: number;
        entries: { token: number; sourceClassSlot: number }[];
      };
      sharedSurfaceInfo: { count: number; entries: unknown[] };
      flags: number;
    };
    if (
      bodyDeclared.flags !== 7 ||
      bodyDeclared.sharedSurfaceInfo.count !== 0 ||
      bodyDeclared.sharedSurfaceInfo.entries.length
    )
      throw Error("Unsupported saved panel Geometry flags/shared operands");
    const declaredFaces = bodyDeclared.faces.entries.map((d) => d.token),
      declaredEdges = bodyDeclared.edges.entries.map((d) => d.token);
    if (
      bodyDeclared.faces.count !== declaredFaces.length ||
      bodyDeclared.edges.count !== declaredEdges.length ||
      new Set(declaredFaces).size !== declaredFaces.length ||
      new Set(declaredEdges).size !== declaredEdges.length ||
      bodyDeclared.faces.entries.some((d) => d.sourceClassSlot !== 1825) ||
      bodyDeclared.edges.entries.some((d) => d.sourceClassSlot !== 1423)
    )
      throw Error("Incomplete saved native panel body declaration");
    const bodyIndex = revit2027OwnerMeshIndex(definition),
      bodyPoints: Q3[] = [];
    if (
      bodyIndex.faces.size !== declaredFaces.length ||
      bodyIndex.edges.size !== declaredEdges.length ||
      declaredFaces.some((t) => !bodyIndex.faces.has(t)) ||
      declaredEdges.some((t) => !bodyIndex.edges.has(t))
    )
      throw Error("Original panel body census differs from declaration");
    const consumedBodyLoops = new Set<number>();
    for (const [ft, f] of bodyIndex.faces) {
      const sf = revit2027OwnerSurface<Revit2027PlaneSurface>(
        bodyIndex,
        634,
        ft,
      );
      if (
        !sf ||
        f.surface.sourceClassSlot !== 634 ||
        f.faceFlags !== 4 ||
        f.cutType !== 0 ||
        f.faceRegions.count
      )
        throw Error("Unsupported saved panel body surface");
      let sourceLoop = f.firstLoop.token;
      if (!sourceLoop)
        throw Error("Saved physical panel face has no complete source loop");
      while (sourceLoop) {
        if (consumedBodyLoops.has(sourceLoop))
          throw Error("Repeated saved panel body loop");
        consumedBodyLoops.add(sourceLoop);
        const loop = bodyIndex.loops.get(sourceLoop);
        if (!loop || loop.loop.open || loop.loop.faceReference !== ft)
          throw Error("Unowned saved panel body loop");
        const walk = walkRevit2027DirectedLoopEdges({
          faceToken: ft,
          loop,
          edges: bodyIndex.edges,
          loopArity: "open",
        });
        if (!walk.ok)
          throw Error("Saved panel body source coedges do not close");
        sourceLoop = loop.loop.nextLoop.token;
      }
      bodyPoints.push(
        ...finitePlane(sf).map((p) => exactAffine(matrix, origin, p)),
      );
      for (const e of bodyIndex.edges.values()) {
        const sides = e.faceReferences
          .map((v, i) => (v === ft ? i : -1))
          .filter((i) => i >= 0);
        for (const side of sides) {
          if (e.interiorEdgePoints.length)
            throw Error("Unsupported curved saved panel body");
          for (const p of e.firstAndLastEdgePoints)
            bodyPoints.push(
              exactAffine(
                matrix,
                origin,
                point(sf, side === 0 ? p.firstFaceUv : p.secondFaceUv),
              ),
            );
        }
      }
    }
    if (
      consumedBodyLoops.size !== bodyIndex.loops.size ||
      [...bodyIndex.edges.values()].some((e) =>
        e.faceReferences.some((ft) => !bodyIndex.faces.has(ft)),
      )
    )
      throw Error(
        "Saved panel body leaves unconsumed loop/twin source operands",
      );
    const oneConvexBoxContainsWholeSavedBody =
      !bodyPoints.length ||
      envelopes.some((b) =>
        bodyPoints.every((p) =>
          p.every(
            (v, i) =>
              cmp(v, b.minimumFeet[i]!) >= 0 && cmp(v, b.maximumFeet[i]!) <= 0,
          ),
        ),
      );
    if (!oneConvexBoxContainsWholeSavedBody)
      throw Error(
        "Actual saved native panel body extends beyond parametric reconstruction",
      );
    if (
      !bodyPoints.length &&
      (definition.spans.length !== 1 ||
        definition.spans[0]!.readerId !== "Revit2027Geometry" ||
        bodyIndex.edges.size ||
        bodyIndex.faces.size)
    )
      throw Error("Unsupported empty saved panel body branches");
    return {
      ok: true as const,
      nativeInstanceId,
      nativeDefinitionId,
      nativeHostId,
      originalSystemPanelMode: sr.m_isHostPanelSym,
      originalSourceCell: cell,
      originalNativeCurrentOutputRole: outputRole,
      originalSourceFaceToken: faceToken,
      originalSourceFaceTag: faceTag,
      originalFiniteCellPlane: surface,
      originalDeclaredCellDomain,
      profileDomainRecipe: hasDirectFiniteDomain
        ? "original-finite-cell-domain"
        : "complete-original-predecessor-grid-input",
      retainedPredecessorProfileOperands,
      retainedCurrentCellEdgeReferences,
      sourceCellAncestors: ancestors,
      originalNativeThicknessFeet: rational(thickness),
      originalNativeOffsetFeet: rational(offset),
      originalNativeAffine: { matrix, origin },
      ...padding,
      originalCellProfilePointCount: profilePoints.length,
      retainedOriginalTrimAndTwinOperands: trimOperands,
      retainedSymbolProfileOperands,
      conservativeMaterialBoxesFeet: envelopes,
      originalSavedBodyControl: {
        sourceFaceCount: bodyIndex.faces.size,
        retainedSavedBodyFillingAttributes,
        sourceEdgeCount: bodyIndex.edges.size,
        originalEndpointEmbeddingCount: bodyPoints.length,
        allActualSavedBodyEndpointsEnclosed: oneConvexBoxContainsWholeSavedBody,
        wholeSavedBodyInsideOneConvexConstructorBox:
          oneConvexBoxContainsWholeSavedBody,
      },
      originalTypedOperandReceipts: {
        instance: instance.value,
        symbol: symbol.value,
        currentHostGenerator: divide,
        currentHostGrid: gridEntry,
        currentHostStep: hostStep,
      },
      sourceFrameSha256s: Object.fromEntries(
        Object.entries(frames).map(([k, b]) => [k, hash(b)]),
      ),
      completeOriginalParametricCandidateReplay: true as const,
      sourceAuthorityGranted: false as const,
      sourceIssuedMaterialEnclosureApproved: false as const,
      fullHumanClearanceApproved: false as const,
      routeApproved: false as const,
    };
  } catch (error) {
    return {
      ok: false as const,
      blockers: [error instanceof Error ? error.message : String(error)],
      sourceAuthorityGranted: false as const,
      sourceIssuedMaterialEnclosureApproved: false as const,
      routeApproved: false as const,
    };
  }
}
/** Original frames/schema only from the actual-RVT private census. Returned
 * values remain a diagnostic candidate, never a caller-mintable certificate. */
export function inspectOriginalNativeSimpleSystemPanelEnvelope(
  census: OriginalNativeForeignEnvelopeCensus,
  nativeInstanceId: number,
) {
  try {
    const original = readOriginalForeignEnvelopeScopedSemantic(
        census,
        nativeInstanceId,
        2031,
      ),
      schema = readSchema(original.originalSourceSchemaBytes);
    if (!schema.ok) throw Error(schema.error);
    const instance = readOriginalCurtainInstanceTypedFifo(
      original.originalFrameBytes,
      schema.schema,
    );
    if (!instance.ok) throw Error(instance.error);
    const info = instance.value.entries.filter(
      (e) => e.sourceClassName === "InstanceInfo",
    );
    if (info.length !== 1) throw Error("Missing original panel instance info");
    const hostId = id(instance.value.root.m_hostId),
      definitionId = id(info[0]!.value.m_symbolId);
    if (!Number.isSafeInteger(hostId) || !Number.isSafeInteger(definitionId))
      throw Error("Invalid original panel host/definition");
    const instanceCategories = original.originalCategoryDeclarations;
    if (instanceCategories.length !== 1 || instanceCategories[0] !== -2000170)
      throw Error("Original instance panel category is absent or ambiguous");
    const h = Number(hostId),
      d = Number(definitionId),
      host = readOriginalForeignEnvelopeScopedSemantic(census, h, 3899),
      symbol = readOriginalForeignEnvelopeScopedSemantic(census, d, 4318);
    if (
      host.originalCategoryDeclarations.length !== 1 ||
      host.originalCategoryDeclarations[0] !== -2000011 ||
      symbol.originalCategoryDeclarations.length !== 1 ||
      symbol.originalCategoryDeclarations[0] !== -2000170
    )
      throw Error(
        "Original panel type/host category role is absent or ambiguous",
      );
    if (
      [host, symbol].some(
        (x) =>
          x.sourceModelSha256 !== original.sourceModelSha256 ||
          x.sourceSchemaSha256 !== original.sourceSchemaSha256,
      )
    )
      throw Error("Original panel source identity differs");
    return {
      ...inspectSimpleSystemPanelFrames({
        schema: original.originalSourceSchemaBytes,
        instanceNative: original.originalFrameBytes,
        symbolNative: symbol.originalFrameBytes,
        hostNative: host.originalFrameBytes,
        instanceGElement: readOriginalForeignEnvelopeScopedFrame(
          census,
          nativeInstanceId,
        ),
        symbolGElement: readOriginalForeignEnvelopeScopedFrame(census, d),
        hostGElement: readOriginalForeignEnvelopeScopedFrame(census, h),
      }),
      sourceModelSha256: original.sourceModelSha256,
      sourceSchemaSha256: original.sourceSchemaSha256,
      originalOpaqueRvtFrameMembershipVerified: true as const,
    };
  } catch (error) {
    return {
      ok: false as const,
      blockers: [error instanceof Error ? error.message : String(error)],
      sourceAuthorityGranted: false as const,
      sourceIssuedMaterialEnclosureApproved: false as const,
      routeApproved: false as const,
    };
  }
}

const issuedPanelEnvelopeBrand: unique symbol = Symbol(
  "OriginalSimpleSystemPanelSourceEnvelope",
);
export type OriginalSimpleSystemPanelSourceEnvelope = {
  readonly [issuedPanelEnvelopeBrand]: true;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly sourceCensusSha256: string;
  readonly nativeInstanceId: number;
  readonly geometrySha256: string;
};
type IssuedPanelEnvelopeFacts = {
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  sourceCensusSha256: string;
  nativeInstanceId: number;
  nativeDefinitionId: number;
  nativeHostId: number;
  originalOccurrenceGElementFrameSha256: string;
  sourceFrameSha256s: Record<string, string>;
  recipeIdentifier: "native2027-simple-system-panel-mode0-v1";
  recipeSha256: string;
  geometrySha256: string;
  conservativeMaterialBoxesFeet: {
    kind: string;
    minimumFeet: Q3;
    maximumFeet: Q3;
  }[];
  originalSystemPanelMode: 0;
  sourceIssuedMaterialEnclosureApproved: true;
  sourceBodyAbsenceApproved: false;
  fullHumanClearanceApproved: false;
  routeApproved: false;
};
const issuedPanelEnvelopes = new WeakMap<
  OriginalSimpleSystemPanelSourceEnvelope,
  {
    census: OriginalNativeForeignEnvelopeCensus;
    facts: IssuedPanelEnvelopeFacts;
  }
>();
const encodeRecipe = (v: unknown): unknown =>
  v instanceof Rational
    ? { $rational: [String(v.n), String(v.d)] }
    : typeof v === "bigint"
      ? { $bigint: String(v) }
      : Array.isArray(v)
        ? v.map(encodeRecipe)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v).map(([k, x]) => [k, encodeRecipe(x)]),
            )
          : v;
function copyRecipe<T>(v: T): T {
  if (v instanceof Rational) return new Rational(v.n, v.d) as T;
  if (Array.isArray(v)) return v.map(copyRecipe) as T;
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, copyRecipe(x)]),
    ) as T;
  return v;
}
/** Issues ONLY a parametric obstruction enclosure for reviewed native mode0.
 * Actual source lookup is repeated from the private census; copied math,
 * arbitrary JSON, stale receipts and caller assertion flags cannot issue it.
 * It grants no stair route, floor support, access or clearance authority. */
export function certifyOriginalSimpleSystemPanelSourceEnvelope(
  census: OriginalNativeForeignEnvelopeCensus,
  nativeInstanceId: number,
) {
  const report = inspectOriginalNativeSimpleSystemPanelEnvelope(
    census,
    nativeInstanceId,
  );
  if (!report.ok) return report;
  if (report.originalSystemPanelMode !== 0)
    return {
      ok: false as const,
      blockers: ["Mode1 host-panel material delegation needs its own proof"],
    };
  const recipeIdentifier = "native2027-simple-system-panel-mode0-v1" as const,
    recipeSha256 = hash(
      new TextEncoder().encode(
        "native2027:2031+4318(mode0);currentCurtainGrid;CWallGridFace.v1[14,-1,-1]->CGridDivideFace.v16[14,V,U];finite-profile-plus-all-native-UV-twins;strict-selector-affine;world-row-absolute-padding(abs(thickness)+abs(offset));one-convex-profile-body-controls",
      ),
    ),
    geometrySha256 = hash(
      new TextEncoder().encode(
        JSON.stringify(
          encodeRecipe({
            recipeIdentifier,
            recipeSha256,
            sourceFrameSha256s: report.sourceFrameSha256s,
            material: report.conservativeMaterialBoxesFeet,
          }),
        ),
      ),
    );
  const facts: IssuedPanelEnvelopeFacts = {
    sourceModelSha256: report.sourceModelSha256,
    sourceSchemaSha256: report.sourceSchemaSha256,
    sourceCensusSha256: census.sourceCensusSha256,
    nativeInstanceId: report.nativeInstanceId,
    nativeDefinitionId: report.nativeDefinitionId,
    nativeHostId: report.nativeHostId,
    originalOccurrenceGElementFrameSha256:
      report.sourceFrameSha256s.instanceGElement!,
    sourceFrameSha256s: report.sourceFrameSha256s,
    recipeIdentifier,
    recipeSha256,
    geometrySha256,
    conservativeMaterialBoxesFeet: copyRecipe(
      report.conservativeMaterialBoxesFeet,
    ),
    originalSystemPanelMode: 0,
    sourceIssuedMaterialEnclosureApproved: true,
    sourceBodyAbsenceApproved: false,
    fullHumanClearanceApproved: false,
    routeApproved: false,
  };
  const certificate = Object.freeze({
    [issuedPanelEnvelopeBrand]: true as const,
    sourceModelSha256: facts.sourceModelSha256,
    sourceSchemaSha256: facts.sourceSchemaSha256,
    sourceCensusSha256: facts.sourceCensusSha256,
    nativeInstanceId,
    geometrySha256,
  });
  issuedPanelEnvelopes.set(certificate, { census, facts });
  return { ok: true as const, certificate };
}
/** Same private actual-RVT census AND issued handle are mandatory. */
export function originalSimpleSystemPanelSourceEnvelopeFact(
  census: OriginalNativeForeignEnvelopeCensus,
  certificate: OriginalSimpleSystemPanelSourceEnvelope,
) {
  const issued = issuedPanelEnvelopes.get(certificate);
  if (!issued || issued.census !== census)
    throw Error(
      "Panel material enclosure requires its original census-bound source certificate",
    );
  return copyRecipe(issued.facts);
}
