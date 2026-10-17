/** Unwired diagnostic construction bound. The native host-containment rule
 * still requires independent source review; this never grants material
 * absence, an authoritative enclosure, walking support or route admission. */
import type { SchemaStream } from "./schema-reader.ts";
import { readOriginalMullionSymbolTypedFifo } from "./native-source-mullion-symbol.ts";
import { readOriginalCurtainHostTypedFifo } from "./native-source-curtain-host.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import { Rational, rational } from "./native-rational-overlay.ts";
import { outwardNativeRationalBound } from "./native-planar-component-envelopes.ts";

type ObjectValue = Record<string, unknown>;
const add = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
  sub = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
  mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d),
  abs = (a: Rational) => new Rational(a.n < 0n ? -a.n : a.n, a.d),
  cmp = (a: Rational, b: Rational) =>
    a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const obj = (v: unknown): ObjectValue => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Missing original typed object");
  return v as ObjectValue;
};
const id = (v: unknown): number => {
  const value = obj(obj(v).m_id).m_id64;
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw Error("Invalid original source identity");
  return value;
};
const array = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw Error("Missing original source array");
  return v;
};
const numeric = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw Error("Nonfinite original constructor operand");
  return v;
};
const p3 = (v: unknown): number[] => {
  const a = array(v).map(numeric);
  if (a.length !== 3) throw Error("Invalid original3D point");
  return a;
};
const empty = (o: ObjectValue, names: readonly string[]) => {
  for (const name of names)
    if (array(o[name]).length)
      throw Error(`Additional original source operands: ${name}`);
};
const nulls = (o: ObjectValue, names: readonly string[]) => {
  for (const name of names)
    if (obj(o[name]).token !== 0)
      throw Error(`Additional original source generator: ${name}`);
};
function checkedFrame(bytes: Uint8Array, owner: number, marker: number) {
  if (bytes.length < 40) throw Error("Truncated original source frame");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    n = v.getUint32(12, true);
  if (
    v.getBigInt64(0, true) !== BigInt(owner) ||
    v.getUint16(16, true) !== marker ||
    n + 20 !== bytes.length ||
    v.getUint32(n + 16, true) !== n
  )
    throw Error("Original frame identity/echo mismatch");
  let a = 1,
    b = 0;
  for (let i = 16; i < n + 16; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  if ((b * 65536 + a) >>> 0 !== v.getUint32(8, true))
    throw Error("Original frame checksum mismatch");
  return {
    offset: 0,
    elementId: owner,
    marker,
    objectLength: n,
    typeCode: v.getUint32(18, true),
  };
}
function graphics(bytes: Uint8Array, owner: number) {
  const frame = checkedFrame(bytes, owner, 2246),
    r = decodeRevit2027FramedGRepRoot(bytes, frame, 2027);
  if (!r.ok) throw Error(r.error);
  if (
    r.value.ownerElementId !== BigInt(owner) ||
    r.value.objectType !== 3 ||
    ![0, 2].includes(r.value.flags)
  )
    throw Error("Unsupported original graphics root role");
  const replay = replayRevit2027GRepFifo(bytes, r.value);
  if (!replay.ok) throw Error(replay.error);
  return { root: r.value, replay: replay.value };
}

/** Checks all persisted source operands before constructing a deliberately
 * broad candidate: complete original host box, all explicitly referenced axis
 * representations and the entire rectangular-profile overhang. Empty saved
 * graphics, a zero prototype axis and dormant flags are NEVER absence proof.
 *
 * The remaining review gate is semantic: source hostID/edgeTag membership must
 * confine this native generator to that bounded host. A caller cannot promote
 * this returned diagnostic into a registered original-source fact. */
export function diagnoseOriginalHostedMullionEnclosure(input: {
  schema: SchemaStream;
  nativeInstance: Uint8Array;
  nativeSymbol: Uint8Array;
  occurrenceGraphics: Uint8Array;
  definitionGraphics: Uint8Array;
  nativeHost: Uint8Array;
  hostGraphics: Uint8Array;
  /** Empirical comparison only: keep this path separate from the empty-body
   * candidate. The original nonempty body must be checked independently. */
  independentBodyControl?: true;
}) {
  try {
    const instance = readOriginalMullionSymbolTypedFifo(
        input.nativeInstance,
        input.schema,
        "FamilyInstance",
      ),
      symbol = readOriginalMullionSymbolTypedFifo(
        input.nativeSymbol,
        input.schema,
      );
    if (!instance.ok || !symbol.ok)
      throw Error(
        !instance.ok
          ? instance.error
          : !symbol.ok
            ? symbol.error
            : "Unsupported source symbol",
      );
    const i = instance.value,
      s = symbol.value,
      ir = i.root,
      sr = s.root;
    checkedFrame(input.nativeInstance, i.nativeElementId, i.rootClassSlot);
    checkedFrame(input.nativeSymbol, s.nativeElementId, s.rootClassSlot);
    const one = (entries: typeof i.entries, name: string) => {
      const xs = entries.filter((e) => e.sourceClassName === name);
      if (xs.length !== 1)
        throw Error(`Original source requires exactly one ${name}`);
      return xs[0]!;
    };
    const instanceClasses = [
      "GeomTable",
      "CellList",
      "InstanceInfo",
      "MullionFamRef",
      "FamilyParams",
      "AnalyticalSpaceBoundingCell",
      "FamilyInstancePatternHelper",
    ];
    if (
      i.entries.map((e) => e.sourceClassName).join("|") !==
      instanceClasses.join("|")
    )
      throw Error("Additional or reordered original instance generators");
    const symbolClasses = [
      "ParamValueSetDouble",
      "GeomStepList",
      "GeomTable",
      "CellList",
      "SymbolInfo",
      "FamilyParams",
      "MullionSymFamRef",
      "Matrix",
      "SysRectMullionProfile",
      "BaseFamilySymbolGStep",
      "SysMullionFamSymPatternHelper",
      "GLine",
    ];
    if (
      s.entries.map((e) => e.sourceClassName).join("|") !==
      symbolClasses.join("|")
    )
      throw Error(
        "Additional or unsupported original profile/constructor branches",
      );
    nulls(ir, [
      "m_pParamValueSetDouble",
      "m_pParamValueSetInt",
      "m_pParamValueSetAString",
      "m_pParamValueSetElementId",
      "m_geomSteps",
      "m_oFamInstSpec",
      "m_pDesignPropManager",
      "m_pCurveDriver",
      "m_pInplaceInsertionHelper",
      "m_pConnectorManager",
      "m_posRelToGrid",
      "m_oFamInstUserData",
      "m_oPOFDriver",
    ]);
    empty(ir, [
      "m_constrInfo",
      "m_extraHostIds",
      "m_explicitHostIds",
      "m_offsetPosArr",
      "m_subInstTable",
      "m_leaders",
    ]);
    if (
      ir.m_useOffsetPos !== 0 ||
      !(input.independentBodyControl ? [0, 1] : [1]).includes(
        ir.m_instDormant as number,
      ) ||
      JSON.stringify(ir.m_instOrigin) !== "[0,0,0]" ||
      JSON.stringify(ir.m_RefDir) !== "[1,0,0]" ||
      JSON.stringify(ir.m_zAxis) !== "[0,0,1]"
    )
      throw Error(
        "Additional or changed original instance placement/generation state",
      );
    for (const entries of [i.entries, s.entries]) {
      const p = one(entries, "FamilyParams").value;
      empty(p, ["m_params"]);
      empty(obj(p.m_geomRefHandles), ["m_offsetGeomMap"]);
    }
    const member = one(i.entries, "MullionFamRef").value,
      hostId = id(member.m_hostId);
    if (
      hostId <= 0 ||
      hostId !== id(ir.m_hostId) ||
      member.m_driverId !== -1 ||
      member.m_wasSuspendedOnFail !== 0 ||
      member.m_version !== 1
    )
      throw Error("Unresolved original host/driver/suspended generator");
    const neighbors = obj(member.m_buttGlazedRef);
    if (
      array(neighbors.m_nbrMullionId).some((v) => id(v) !== -1) ||
      array(neighbors.m_flipped).some((v) => v !== 0)
    )
      throw Error("Original join/neighbor operands require separate bounds");
    const edgeTag = numeric(member.m_edgeTag);
    if (!Number.isSafeInteger(edgeTag) || edgeTag <= 0)
      throw Error("Invalid original host-edge tag");
    nulls(sr, [
      "m_pParamValueSetInt",
      "m_pParamValueSetAString",
      "m_pParamValueSetElementId",
      "m_oArrMembHistTable",
      "m_oFamMoveRestrictions",
    ]);
    empty(sr, [
      "m_constrInfo",
      "m_pCutLoops",
      "m_cutDirs",
      "m_cutIndices",
      "m_controlIcons",
      "m_controlIconTags",
      "m_textNoteData",
      "m_tagNoteData",
      "m_closurePlanes",
      "m_gTagDirFlagsPairs",
      "m_nonBRepGeomPtrs",
      "m_labelParamTagInfo",
      "m_complexCutRefIds",
      "m_complexCutGeoms",
      "m_dummyHostGeoms",
      "m_dummyHostCutFaceTags",
      "m_dummyHostInsertionFaceTags",
      "m_strongRefs",
      "m_setOfInPlaceTotalParentIds",
      "m_notRotatedNodes",
      "m_lightSrcParamIds",
      "m_lightSrcGReps",
      "m_lightSrcValues",
      "m_arrProfileLoops",
      "m_pretaggingGNodes",
      "m_pretaggingTranslations",
      "m_arrConnectorData",
      "m_arrFamSymRegenData",
      "m_flippedGeomRefHandlesSet",
      "m_subInstData",
      "m_subElemData",
      "m_imposterLightTrfs",
      "m_geomTag2MaterialId",
    ]);
    if (
      sr.m_stretchCount !== 0 ||
      sr.m_bMayBeStretchable !== 0 ||
      sr.m_bConfirmedStretchable !== 0 ||
      sr.m_angle !== 0 ||
      sr.m_position !== 0 ||
      !(input.independentBodyControl ? [-1, -3] : [-3]).includes(
        id(sr.m_profileId),
      ) ||
      JSON.stringify(sr.m_origin) !== "[0,0,0]" ||
      JSON.stringify(sr.m_rotCenter) !== "[0,0,0]"
    )
      throw Error(
        "Original profile, stretch or angular construction is unsupported",
      );
    const step = one(s.entries, "GeomStepList").value;
    empty(step, [
      "m_nonBRepGList",
      "m_bRepAdjustGList",
      "m_bRepCutOutGList",
      "m_bRepPostCutOutGList",
      "m_bRepTweakGList",
    ]);
    if (array(step.m_bRepFormGList).length !== 1)
      throw Error("Additional original physical form generators");
    nulls(step, [
      "m_bRepFormSnapshot",
      "m_bRepAdjustSnapshot",
      "m_bRepCutOutSnapshot",
      "m_bRepPostCutOutSnapshot",
    ]);
    const restrictions = one(s.entries, "Matrix");
    if (
      restrictions.descriptor.path !== "SysMullionFamSym.m_pMoveRestrictions" ||
      restrictions.value.m_nRows !== 0 ||
      restrictions.value.m_ncols !== 0
    )
      throw Error("Additional original movement-restriction operands");
    empty(restrictions.value, ["m_arr", "m_rows"]);
    empty(one(s.entries, "SysMullionFamSymPatternHelper").value, [
      "m_PatternPositionMap",
      "m_substituteFaceMap",
    ]);
    empty(one(i.entries, "FamilyInstancePatternHelper").value, [
      "m_PatternPositionMap",
      "m_substituteFaceMap",
    ]);
    const profile = one(s.entries, "SysRectMullionProfile");
    if (
      profile.descriptor.path !== "SysMullionFamSym.m_sysProfile" ||
      profile.descriptor.token !== obj(sr.m_sysProfile).token ||
      Object.keys(profile.value).length !== 0
    )
      throw Error("Original rectangular profile constructor is not exact");
    const form = one(s.entries, "BaseFamilySymbolGStep").value;
    if (!input.independentBodyControl)
      empty(form, [
        "m_faceHistTable",
        "m_curveHistTableSet",
        "m_edgeHistTable",
        "m_edgeHistTableReverse",
      ]);
    nulls(form, ["m_oExtraDatas"]);
    const reference = one(s.entries, "MullionSymFamRef").value;
    nulls(reference, ["m_trimEnd0", "m_trimEnd1"]);
    if (
      !(input.independentBodyControl ? [0, 1] : [1]).includes(
        reference.m_refDormant as number,
      ) ||
      reference.m_rotationAngle !== 0 ||
      ![0, 1].includes(reference.m_flip as number) ||
      ![0, 1].includes(reference.m_direction as number) ||
      JSON.stringify(reference.m_cornerAngles) !== "[-1,-1]"
    )
      throw Error(
        "Original endpoint/join/miter/rotation operands remain unresolved",
      );
    p3(reference.m_pathNorm);
    const prototype = one(s.entries, "GLine");
    if (
      obj(reference.m_pCurve).token !== prototype.descriptor.token ||
      prototype.descriptor.path !== "MullionSymFamRef.m_pCurve"
    )
      throw Error("Original prototype axis reference is not exact");
    const prototypeCurve = prototype.value,
      prototypeEnds = array(prototypeCurve.m_endParams).map(numeric);
    if (
      prototypeEnds.length !== 2 ||
      (!input.independentBodyControl && prototypeEnds[0] !== prototypeEnds[1])
    )
      throw Error(
        "Only the actual zero-length original prototype case is reviewed",
      );
    const parameters = array(
        one(s.entries, "ParamValueSetDouble").value.m_paramSet,
      ).map((v) => {
        const o = obj(v);
        return [id(o.m_paramId), numeric(o.m_value)] as const;
      }),
      param = new Map(parameters);
    if (
      param.size !== 4 ||
      parameters.length !== 4 ||
      ![-1007351, -1007304, -1007301, -1007300].every((n) => param.has(n))
    )
      throw Error("Additional or duplicate original dimensional operands");
    const w1 = param.get(-1007300)!,
      w2 = param.get(-1007301)!,
      thickness = param.get(-1007304)!,
      offset = param.get(-1007351)!;
    if (
      w1 <= 0 ||
      w2 <= 0 ||
      thickness <= 0 ||
      JSON.stringify(sr.m_outerWidths) !== JSON.stringify([w1, w2])
    )
      throw Error(
        "Original rectangular dimensions are missing or contradictory",
      );
    const rho = add(
      add(add(rational(w1), rational(w2)), rational(thickness)),
      abs(rational(offset)),
    );
    const occ = graphics(input.occurrenceGraphics, i.nativeElementId),
      def = graphics(input.definitionGraphics, s.nativeElementId),
      host = graphics(input.hostGraphics, hostId);
    const hostClass = input.schema.classes.find((c) => c.name === "SWall");
    if (!hostClass) throw Error("Missing original SWall class");
    checkedFrame(input.nativeHost, hostId, hostClass.index);
    const nativeHost = readOriginalCurtainHostTypedFifo(
      input.nativeHost,
      input.schema,
      "SWall",
    );
    if (!nativeHost.ok) throw Error(nativeHost.error);
    if (nativeHost.value.nativeElementId !== hostId)
      throw Error("Original complete native host identity disagrees");
    if (obj(nativeHost.value.root.m_curtainAuxData).m_mullionTdFlags !== 247)
      throw Error("Unsupported original native curtain construction flags");
    const hostEntries = nativeHost.value.entries;
    const driver = one(hostEntries, "WallCGDriver").value,
      members = one(hostEntries, "CGDriverMullionData").value,
      dividerEntry = one(hostEntries, "CGridDivideFaceGStep"),
      divider = dividerEntry.value;
    const hostSteps = one(hostEntries, "GeomStepList"),
      hostStepList = hostSteps.value;
    const operations = array(hostStepList.m_bRepTweakGList).map(obj),
      lastOperation = operations.at(-1);
    const sameReference = (
      a: Record<string, unknown>,
      b: Record<string, unknown>,
    ) =>
      ["token", "sourceClassSlot", "start", "end", "path"].every(
        (k) => a[k] === b[k],
      );
    if (
      hostSteps.descriptor.path !== "SWall.m_geomSteps" ||
      !sameReference(
        obj(nativeHost.value.root.m_geomSteps),
        hostSteps.descriptor,
      ) ||
      !lastOperation ||
      !sameReference(lastOperation, dividerEntry.descriptor) ||
      !dividerEntry.descriptor.path.startsWith(
        "GeomStepList.m_bRepTweakGList[",
      ) ||
      obj(divider.m_pElem).staticReference !== 2 ||
      obj(hostStepList.m_pElem).staticReference !== 2 ||
      obj(divider.m_oExtraDatas).token !== 0
    )
      throw Error(
        "Original finite edge division is not the final native host material operation",
      );
    if (
      array(driver.m_mullionJoins).length ||
      driver.m_mullionJoinId !== 0 ||
      obj(driver.m_nbrCornerMullionData).token !== 0 ||
      obj(driver.m_oOrigGridSurf).token !== 0 ||
      obj(driver.m_oCGDriverCSys).token !== 0
    )
      throw Error(
        "Original host joins/corners or alternate coordinate systems need separate range bounds",
      );
    for (const key of ["m_mullionsById", "m_mullionsByEdge"]) {
      const current = array(members[key])
        .map(obj)
        .filter((v) => id(v.m_mullionId) === i.nativeElementId);
      if (current.length !== 1 || current[0]!.m_edgeTag !== edgeTag)
        throw Error("Original current host membership/edge disagrees");
    }
    if (divider.m_flags !== 761725)
      throw Error("Unsupported original native curtain division flags");
    if (
      divider.m_driverId !== -1 ||
      divider.m_version !== 16 ||
      reference.m_hostVersion !== 16
    )
      throw Error("Original host-edge generation version/driver disagrees");
    const originalEdges = array(divider.m_edgeToOriginalEdgeMap)
      .map(obj)
      .filter((v) => v.first === edgeTag)
      .map((v) => numeric(v.second));
    const segmentRanges = array(divider.m_originalToEdgeSegs)
      .map(obj)
      .filter((v) => originalEdges.includes(numeric(v.first)))
      .flatMap((v) =>
        array(obj(v.second).m_edgeSegs)
          .map(obj)
          .filter((v) => v.m_edgeTag === edgeTag),
      );
    const sharedCells = array(divider.m_cellMap)
      .map(obj)
      .filter((v) => array(obj(v.second).m_edgeTags).includes(edgeTag));
    if (
      originalEdges.length > 1 ||
      (originalEdges.length === 1 &&
        (segmentRanges.length !== 1 ||
          numeric(segmentRanges[0]!.m_start) < 0 ||
          numeric(segmentRanges[0]!.m_start) >=
            numeric(segmentRanges[0]!.m_end) ||
          numeric(segmentRanges[0]!.m_end) > 1)) ||
      (originalEdges.length === 0 && sharedCells.length === 0)
    )
      throw Error("Unresolved original generated edge segment/cell range");
    if (
      !input.independentBodyControl &&
      (def.replay.spans.length !== 1 ||
        def.replay.spans[0]!.readerId !== "Revit2027Geometry")
    )
      throw Error("Additional original persisted symbol material");
    const definitionRoot = def.replay.spans.filter(
      (s) => s.parentReplayIndex === null,
    );
    if (
      definitionRoot.length !== 1 ||
      definitionRoot[0]!.readerId !== "Revit2027Geometry"
    )
      throw Error("Unknown original definition branch root");
    const g = definitionRoot[0]!.value as {
      faces: { count: number };
      edges: { count: number };
      sharedSurfaceInfo: { count: number };
      queuedProperties: unknown[];
    };
    if (
      !input.independentBodyControl &&
      (g.faces.count ||
        g.edges.count ||
        g.sharedSurfaceInfo.count ||
        g.queuedProperties.length)
    )
      throw Error(
        "Nonempty or unknown original definition graphics require complete body bounds",
      );
    if (occ.replay.spans.length !== 2)
      throw Error("Additional original occurrence graphics");
    const binding = collectRevit2027GInstanceBindings(occ.replay);
    if (
      !binding.ok ||
      binding.value.length !== 1 ||
      binding.value[0]!.kind !== "external"
    )
      throw Error("Missing exact original external instance");
    const gi = binding.value[0]!.instance,
      t = gi.transform;
    if (
      gi.symbolElementId !== BigInt(s.nativeElementId) ||
      gi.gRepId !== 0 ||
      gi.cda !== 1 ||
      gi.hasScale ||
      gi.resolveSymbolInView ||
      gi.forbiddenTarget !== 0
    )
      throw Error("Additional original occurrence selector/scale");
    const info = one(i.entries, "InstanceInfo").value,
      trf = obj(info.m_Trf),
      matrix = array(trf.m_3x3).map(p3),
      origin = p3(trf.m_or);
    if (
      id(info.m_symbolId) !== s.nativeElementId ||
      info.m_GRepId !== 0 ||
      JSON.stringify(origin) !== JSON.stringify(t.origin) ||
      JSON.stringify(matrix) !==
        JSON.stringify([
          [t.xAxis[0], t.yAxis[0], t.zAxis[0]],
          [t.xAxis[1], t.yAxis[1], t.zAxis[1]],
          [t.xAxis[2], t.yAxis[2], t.zAxis[2]],
        ])
    )
      throw Error(
        "Original native and graphical placement/definition disagree",
      );
    const m = matrix.map((row) => row.map(rational));
    const determinant = add(
      sub(
        mul(
          m[0]![0]!,
          sub(mul(m[1]![1]!, m[2]![2]!), mul(m[1]![2]!, m[2]![1]!)),
        ),
        mul(
          m[0]![1]!,
          sub(mul(m[1]![0]!, m[2]![2]!), mul(m[1]![2]!, m[2]![0]!)),
        ),
      ),
      mul(m[0]![2]!, sub(mul(m[1]![0]!, m[2]![1]!), mul(m[1]![1]!, m[2]![0]!))),
    );
    if (determinant.n === 0n)
      throw Error("Singular original native occurrence transform");
    const lines = host.replay.spans.filter(
        (x) =>
          x.readerId === "Revit2027GLine" &&
          (x.value as { gInfo: { tag: number } }).gInfo.tag === edgeTag,
      ),
      edges = host.replay.spans.filter(
        (x) =>
          x.readerId === "Revit2027GEdge" &&
          (x.value as { gInfo: { tag: number } }).gInfo.tag === edgeTag,
      );
    if (lines.length !== 1 || edges.length !== 1)
      throw Error("Original host edge/curve tag is absent or ambiguous");
    const line = lines[0]!.value as {
        endParameters: number[];
        origin: number[];
        direction: number[];
      },
      dir = p3(line.direction),
      ends = array(line.endParameters).map(numeric),
      lo = p3(line.origin);
    if (ends.length !== 2 || ends[0]! >= ends[1]!)
      throw Error("Original host axis interval is not finite and positive");
    const axis = t.zAxis.map(rational),
      d = dir.map(rational);
    if (
      axis.every((v) => v.n === 0n) ||
      [0, 1, 2].some(
        (k) =>
          sub(
            mul(axis[(k + 1) % 3]!, d[(k + 2) % 3]!),
            mul(axis[(k + 2) % 3]!, d[(k + 1) % 3]!),
          ).n !== 0n,
      )
    )
      throw Error(
        "Original host curve is not exactly the native longitudinal direction",
      );
    const b = host.root.worldExtents;
    if (
      !b.valid ||
      [...b.minimum, ...b.maximum].some((n) => !Number.isFinite(n)) ||
      [0, 1, 2].some((k) => b.minimum[k]! > b.maximum[k]!)
    )
      throw Error("Original whole-host bounds are unresolved");
    const base = [b.minimum.map(rational), b.maximum.map(rational)],
      points = ends.map((u) =>
        lo.map((v, k) => add(rational(v), mul(rational(dir[k]!), rational(u)))),
      );
    // Retain every original endpoint/twin embedding and its complete finite
    // plane parameter domain. These are source range diagnostics, not a claim
    // that the host's generated mullion body is the host display geometry.
    const edgePlaneRanges: {
      edgeTag: number;
      faceTag: number;
      planeToken: number;
    }[] = [];
    for (const targetTag of [edgeTag, ...originalEdges]) {
      const candidates = host.replay.spans.filter(
        (s) =>
          s.readerId === "Revit2027GEdge" &&
          obj(obj(s.value).gInfo).tag === targetTag,
      );
      if (candidates.length !== 1)
        throw Error("Original generated/base edge is absent or ambiguous");
      const edge = candidates[0]!,
        value = obj(edge.value),
        references = array(value.faceReferences);
      const sourcePoints = [
        ...array(value.firstAndLastEdgePoints),
        ...array(value.interiorEdgePoints),
      ].map(obj);
      if (sourcePoints.length < 2)
        throw Error("Original generated edge has no complete endpoint range");
      let sides = 0;
      for (let side = 0; side < 2; side++) {
        const token = numeric(references[side]);
        if (token === 0) continue;
        const faces = host.replay.spans.filter(
          (s) =>
            s.propertyToken === token &&
            s.parentReplayIndex === edge.parentReplayIndex &&
            s.readerId === "Revit2027Face",
        );
        if (faces.length !== 1)
          throw Error("Original generated edge face identity is unresolved");
        const face = faces[0]!,
          fv = obj(face.value),
          surfaceToken = numeric(obj(fv.surface).token);
        const surfaces = host.replay.spans.filter(
          (s) =>
            s.propertyToken === surfaceToken &&
            s.parentReplayIndex === face.replayIndex,
        );
        if (surfaces.length !== 1)
          throw Error("Original generated edge surface identity is unresolved");
        const surface = obj(surfaces[0]!.value);
        if (surface.kind !== "plane" || array(surface.queuedProperties).length)
          throw Error(
            "Original generated edge has an unsupported source surface",
          );
        const o = p3(surface.origin),
          x = p3(surface.xVector),
          y = p3(surface.yVector);
        const embed = (uv: unknown) => {
          const a = array(uv).map(numeric);
          if (a.length !== 2) throw Error("Invalid source edge UV range");
          return [0, 1, 2].map((k) =>
            add(
              rational(o[k]!),
              add(
                mul(rational(x[k]!), rational(a[0]!)),
                mul(rational(y[k]!), rational(a[1]!)),
              ),
            ),
          );
        };
        for (const p of sourcePoints)
          points.push(embed(p[side === 0 ? "firstFaceUv" : "secondFaceUv"]));
        const envelope = obj(obj(surface.surface).envelope),
          first = array(envelope.firstCorner).map(numeric),
          last = array(envelope.secondCorner).map(numeric);
        if (first.length !== 2 || last.length !== 2)
          throw Error("Unsupported source plane parameter bounds");
        for (const u of [first[0], last[0]])
          for (const v of [first[1], last[1]]) points.push(embed([u, v]));
        edgePlaneRanges.push({
          edgeTag: targetTag,
          faceTag: numeric(obj(fv.gInfo).tag),
          planeToken: surfaceToken,
        });
        sides++;
      }
      if (sides === 0)
        throw Error("Original generated edge has no source face range");
    }
    const prototypeOrigin = p3(prototypeCurve.m_origin),
      prototypeDir = p3(prototypeCurve.m_dirVec),
      local = prototypeOrigin.map((v, k) =>
        add(
          rational(v),
          mul(rational(prototypeDir[k]!), rational(prototypeEnds[0]!)),
        ),
      );
    const prototypeWorldPoint = (local: Rational[]) =>
      [0, 1, 2].map((k) =>
        add(
          rational(t.origin[k]!),
          add(
            add(
              mul(rational(t.xAxis[k]!), local[0]!),
              mul(rational(t.yAxis[k]!), local[1]!),
            ),
            mul(rational(t.zAxis[k]!), local[2]!),
          ),
        ),
      );
    points.push(prototypeWorldPoint(local));
    if (input.independentBodyControl)
      points.push(
        prototypeWorldPoint(
          prototypeOrigin.map((v, k) =>
            add(
              rational(v),
              mul(rational(prototypeDir[k]!), rational(prototypeEnds[1]!)),
            ),
          ),
        ),
      );
    for (const p of points)
      for (let k = 0; k < 3; k++) {
        if (cmp(p[k]!, base[0]![k]!) < 0) base[0]![k] = p[k]!;
        if (cmp(p[k]!, base[1]![k]!) > 0) base[1]![k] = p[k]!;
      }
    const lower: number[] = [],
      upper: number[] = [];
    for (let k = 0; k < 3; k++) {
      const pad = mul(
        rho,
        add(
          add(abs(rational(t.xAxis[k]!)), abs(rational(t.yAxis[k]!))),
          abs(rational(t.zAxis[k]!)),
        ),
      );
      lower.push(outwardNativeRationalBound(sub(base[0]![k]!, pad), -1));
      upper.push(outwardNativeRationalBound(add(base[1]![k]!, pad), 1));
    }
    return {
      status: "candidate" as const,
      nativeElementId: i.nativeElementId,
      nativeDefinitionId: s.nativeElementId,
      nativeHostId: hostId,
      sourceEdgeTag: edgeTag,
      completeOriginalInstanceAndSymbolFifo: true as const,
      independentBodyControl: input.independentBodyControl === true,
      exactOriginalHostCurveAndEdgeCorrespondence: true as const,
      exactLongitudinalDirection: true as const,
      completeOriginalHostFifo: true as const,
      currentOriginalHostMembership: true as const,
      originalGeneratedEdgeRange: {
        version: reference.m_hostVersion,
        originalEdges,
        segmentRanges: segmentRanges.map((v) => ({
          start: v.m_start,
          end: v.m_end,
        })),
        sharedCellCount: sharedCells.length,
        edgePlaneRanges,
      },
      originalWholeHostBounds: b,
      profileDimensionsFeet: { w1, w2, thickness, offset },
      // The symmetric whole-host padding encloses both source Boolean flip
      // choices. It does not supply the deferred longitudinal generator range.
      originalProfileFlip: reference.m_flip as number,
      bothProfileSignsEnclosed: true as const,
      candidateBoundsFeet: {
        min: { x: lower[0]!, y: lower[1]!, z: lower[2]! },
        max: { x: upper[0]!, y: upper[1]!, z: upper[2]! },
      },
      sourceGeneratorContainmentApproved: false as const,
      physicalAbsenceApproved: false as const,
      originalSourceAuthorityGranted: false as const,
      walkingSupportApproved: false as const,
      routeApproved: false as const,
      remainingReview:
        "Independently establish that this complete native host-edge constructor has no physical material outside the host/axis plus complete profile overhang before any original foreign-material veto is narrowed.",
    };
  } catch (e) {
    return {
      status: "refused" as const,
      blockers: [e instanceof Error ? e.message : String(e)],
      sourceGeneratorContainmentApproved: false as const,
      physicalAbsenceApproved: false as const,
      originalSourceAuthorityGranted: false as const,
      walkingSupportApproved: false as const,
      routeApproved: false as const,
    };
  }
}
