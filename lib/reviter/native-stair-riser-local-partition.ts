/** Browser-safe mathematics on complete retained source operands. No opaque
 * source authority, nominal-height, physical-plane or route approval. */
import type {
  NativeStairTypedFifo,
  NativeStairTypedDescriptor,
} from "./native-stair-typed-fifo.ts";
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const positiveId = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 0x7f_ff_ff_ff;
const sourceId = (v: unknown) =>
  (v as { m_id?: { m_id64?: unknown } } | undefined)?.m_id?.m_id64;
const planControls = (v: Record<string, unknown>) =>
  JSON.stringify([
    (v.m_origin as number[]).slice(0, 2),
    v.m_dirVec,
    v.m_endParams,
  ]);
/** Pure exact descriptor/index mathematics, deliberately no source authority.
 * Every declared local position must resolve exactly once, with all original
 * finite curves retained. Root nominal top/base never supplies list cardinality. */
export function inspectOriginalStairRiserLocalPartition(
  run: NativeStairTypedFifo,
) {
  if (
    !run.completeOriginalTypedRootAndFifoByteReplay ||
    run.rootClassName !== "StairsRun"
  )
    throw new Error("Incomplete original typed run partition");
  const root = run.root,
    treads = root.m_stairsTreadInfoArr,
    ordered = root.m_orderedRisers;
  if (
    !Array.isArray(treads) ||
    treads.length === 0 ||
    treads.length > 100_000 ||
    !Array.isArray(ordered) ||
    ordered.length !== treads.length + 1 ||
    root.m_beginWithRiser !== 1 ||
    root.m_endWithRiser !== 1
  )
    throw new Error(
      "Unsupported original local partition begin/end/cardinality",
    );
  if (
    !Number.isSafeInteger(root.m_baseRiserIndex) ||
    Number(root.m_baseRiserIndex) < 0 ||
    !Number.isSafeInteger(root.m_topRiserIndex) ||
    Number(root.m_topRiserIndex) <= Number(root.m_baseRiserIndex)
  )
    throw new Error("Invalid original nominal root riser indices");
  const resolve = (d: NativeStairTypedDescriptor) => {
    if (!d || !d.token)
      throw new Error("Missing original partition descriptor");
    const found = run.entries.filter((e) =>
      d.token > 0
        ? e.descriptor.token === d.token
        : e.descriptor.start === d.start &&
          e.descriptor.end === d.end &&
          e.descriptor.path === d.path,
    );
    if (
      found.length !== 1 ||
      found[0]!.descriptor.sourceClassSlot !== d.sourceClassSlot
    )
      throw new Error("Ambiguous original partition descriptor");
    return found[0]!;
  };
  const line = (d: NativeStairTypedDescriptor) => {
    const e = resolve(d),
      v = e.value;
    for (const [key, n] of [
      ["m_origin", 3],
      ["m_dirVec", 3],
      ["m_endParams", 2],
    ] as const)
      if (
        !Array.isArray(v[key]) ||
        (v[key] as unknown[]).length !== n ||
        !(v[key] as unknown[]).every(finite)
      )
        throw new Error("Nonfinite original partition line controls");
    const direction = v.m_dirVec as number[],
      params = v.m_endParams as number[];
    if (
      e.sourceClassName !== "GLine" ||
      direction[2] !== 0 ||
      !direction.slice(0, 2).some((n) => n !== 0) ||
      params[0] === params[1]
    )
      throw new Error("Unsupported curved/degenerate original partition line");
    return e;
  };
  const orderedRisers = (ordered as NativeStairTypedDescriptor[]).map(
    (d, index) => {
      const loop = resolve(d),
        curves = loop.value.m_curves;
      if (
        loop.sourceClassName !== "CurveLoop" ||
        loop.value.m_open !== 1 ||
        !Array.isArray(curves) ||
        curves.length !== 1
      )
        throw new Error("Unsupported original ordered partition curve loop");
      const curve = line(curves[0] as NativeStairTypedDescriptor);
      return {
        originalLocalIndex: index,
        originalLoopDescriptor: d,
        originalLoopSpan: [loop.start, loop.end],
        originalCurveDescriptor: curve.descriptor,
        originalCurveSpan: [curve.start, curve.end],
        originalFiniteCurve: structuredClone(curve.value),
      };
    },
  );
  if (
    orderedRisers.some(
      (r, i) =>
        i &&
        Number((r.originalFiniteCurve.m_origin as number[])[2]) <=
          Number(
            (orderedRisers[i - 1]!.originalFiniteCurve.m_origin as number[])[2],
          ),
    )
  )
    throw new Error(
      "Original ordered partition heights are not strictly increasing",
    );
  const treadRelations = (treads as NativeStairTypedDescriptor[]).map(
    (d, index) => {
      const entry = resolve(d),
        v = entry.value,
        start = v.m_startRiser as Record<string, unknown>,
        end = v.m_endRiser as Record<string, unknown>;
      if (
        entry.sourceClassName !== "StairsTreadInfo" ||
        !start ||
        !end ||
        start.m_specifiedIdx !== index ||
        end.m_specifiedIdx !== index + 1
      )
        throw new Error(
          "Original local specified indices omit/reorder a declared riser",
        );
      for (const value of [start, end]) {
        const multi = value.m_pMultiSegRiser as NativeStairTypedDescriptor;
        if (!multi || multi.token !== 0 || multi.sourceClassSlot !== null)
          throw new Error("Unsupported original multisegment partition riser");
      }
      const a = line(start.m_pRiserCurve as NativeStairTypedDescriptor),
        b = line(end.m_pRiserCurve as NativeStairTypedDescriptor),
        startLine = line(v.m_startLine as NativeStairTypedDescriptor),
        endLine = line(v.m_endLine as NativeStairTypedDescriptor);
      if (
        planControls(a.value) !==
          planControls(orderedRisers[index]!.originalFiniteCurve) ||
        planControls(b.value) !==
          planControls(orderedRisers[index + 1]!.originalFiniteCurve)
      )
        throw new Error(
          "Original partition finite plan controls break ordered correspondence",
        );
      return {
        originalTypedLocalIndex: index,
        originalTypedDescriptor: entry.descriptor,
        originalTypedInfoSpan: [entry.start, entry.end],
        originalStartSpecifiedIndex: start.m_specifiedIdx,
        originalEndSpecifiedIndex: end.m_specifiedIdx,
        originalStartCurveSpan: [a.start, a.end],
        originalEndCurveSpan: [b.start, b.end],
        originalFiniteStartCurve: structuredClone(a.value),
        originalFiniteEndCurve: structuredClone(b.value),
        originalFiniteStartLine: structuredClone(startLine.value),
        originalFiniteEndLine: structuredClone(endLine.value),
        originalTreadOrigin: v.m_origin,
        originalTreadType: v.m_treadType,
        originalRunType: v.m_runType,
        originalRiserDirection: v.m_riserDir,
        originalRunDirection: v.m_runDirProj,
      };
    },
  );
  const namedTerminalCurves = ["m_oStartRiser", "m_oEndRiser"].map((field) => {
    const e = line(root[field] as NativeStairTypedDescriptor);
    return {
      originalNamedField: field,
      originalDescriptor: e.descriptor,
      originalSourceSpan: [e.start, e.end],
      originalFiniteCurve: structuredClone(e.value),
    };
  });
  return {
    nativeRunId: run.nativeRunId,
    originalRootBaseRiserIndex: Number(root.m_baseRiserIndex),
    originalRootTopRiserIndex: Number(root.m_topRiserIndex),
    originalRootBottomElevationFeet: root.m_bottomElevation,
    originalRootTopElevationFeet: root.m_topElevation,
    originalOrderedRiserCount: orderedRisers.length,
    originalTypedTreadCount: treadRelations.length,
    originalRootIndexSpanMatchesLocalCount:
      Number(root.m_topRiserIndex) - Number(root.m_baseRiserIndex) ===
      orderedRisers.length,
    orderedRisers,
    treadRelations,
    namedTerminalCurves,
    completeLocalSourceListCorrespondence: true as const,
    sourceAuthorityGranted: false as const,
    nominalRootExtentApproved: false as const,
    treadFootprintOrOrientationApproved: false as const,
    physicalTerminalApproved: false as const,
    routeApproved: false as const,
  };
}
export type PortableOriginalRiserPartition = {
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  nativeStairId: number;
  originalParentFrameSha256: string;
  originalParentRoot: Record<string, unknown>;
  ownedRuns: { originalRunFrameSha256: string; run: NativeStairTypedFifo }[];
};
/** A portable packet cannot establish actual original ownership. A source
 * consumer must bind these exact operands to its real opaque membership, and
 * a runtime consumer must retain the producer's verified source provenance.
 * This function proves local descriptor correspondence and complete declared
 * cardinality from all supplied original run operands, never a guard skip. */
export function inspectPortableOriginalRiserPartition(
  partition: PortableOriginalRiserPartition,
  currentRun: NativeStairTypedFifo,
) {
  const sha = (v: unknown): v is string =>
    typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (
    !partition ||
    !sha(partition.sourceModelSha256) ||
    !sha(partition.sourceSchemaSha256) ||
    !sha(partition.originalParentFrameSha256) ||
    !positiveId(partition.nativeStairId) ||
    !Array.isArray(partition.ownedRuns) ||
    partition.ownedRuns.length === 0 ||
    partition.ownedRuns.length > 128
  )
    throw new Error("Incomplete portable original riser partition identity");
  const parent = partition.originalParentRoot;
  if (
    !parent ||
    sourceId(parent.m_id) !== partition.nativeStairId ||
    parent.m_moribund !== 0 ||
    parent.m_dummy !== 0 ||
    !positiveId(parent.m_actualNumberOfRisers) ||
    !positiveId(sourceId(parent.m_baseLevelId)) ||
    !positiveId(sourceId(parent.m_topLevelId)) ||
    !finite(parent.m_baseLevelOffset) ||
    !finite(parent.m_topLevelOffset) ||
    !finite(parent.m_actualRiserHeight) ||
    parent.m_actualRiserHeight <= 0 ||
    !finite(parent.m_stairsHeight) ||
    parent.m_stairsHeight <= 0
  )
    throw new Error(
      "Portable original parent count/height/served metadata differs",
    );
  const ids = new Set<number>(),
    frames = new Set<string>();
  const runs = partition.ownedRuns.map(({ originalRunFrameSha256, run }) => {
    if (
      !sha(originalRunFrameSha256) ||
      frames.has(originalRunFrameSha256) ||
      !run ||
      !positiveId(run.nativeRunId) ||
      run.nativeElementId !== run.nativeRunId ||
      ids.has(run.nativeRunId) ||
      sourceId(run.root.m_id) !== run.nativeRunId ||
      sourceId(run.root.m_stairsId) !== partition.nativeStairId ||
      run.root.m_moribund !== 0 ||
      run.root.m_dummy !== 0 ||
      run.rootClassSlot !== 4102 ||
      !Number.isSafeInteger(run.rootStaticEnd) ||
      !Number.isSafeInteger(run.endOffset) ||
      run.rootStaticEnd < 18 ||
      run.endOffset <= run.rootStaticEnd
    )
      throw new Error("Foreign/reused/incomplete portable original child run");
    ids.add(run.nativeRunId);
    frames.add(originalRunFrameSha256);
    return {
      originalChildSourceFrameSha256: originalRunFrameSha256,
      ...inspectOriginalStairRiserLocalPartition(run),
    };
  });
  const originalCompleteChildOrderedRiserTotal = runs.reduce(
    (n, run) => n + run.originalOrderedRiserCount,
    0,
  );
  if (originalCompleteChildOrderedRiserTotal !== parent.m_actualNumberOfRisers)
    throw new Error(
      "Portable complete original child count differs from parent declaration",
    );
  const selected = partition.ownedRuns.filter(
    ({ run }) => run.nativeRunId === currentRun.nativeRunId,
  );
  if (
    selected.length !== 1 ||
    JSON.stringify(selected[0]!.run) !== JSON.stringify(currentRun)
  )
    throw new Error(
      "Current run differs from complete original partition snapshot",
    );
  return {
    sourceModelSha256: partition.sourceModelSha256,
    sourceSchemaSha256: partition.sourceSchemaSha256,
    nativeStairId: partition.nativeStairId,
    originalParentFrameSha256: partition.originalParentFrameSha256,
    originalParentRoot: structuredClone(parent),
    originalCompleteChildOrderedRiserTotal,
    originalOwnedRunIds: [...ids],
    runs,
    currentRun: runs.find((r) => r.nativeRunId === currentRun.nativeRunId)!,
    completePortableLocalDescriptorAndCardinalityMathematics: true as const,
    sourceAuthorityGranted: false as const,
    nominalRootExtentApproved: false as const,
    nativeLevelElevationsInspected: false as const,
    servedPhysicalPlanesApproved: false as const,
    treadFootprintOrOrientationApproved: false as const,
    physicalBodyOrTerminalApproved: false as const,
    routeApproved: false as const,
  };
}
