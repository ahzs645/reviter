/** Original physical tread stations for an explicitly stepped movement proposal.
 * This deliberately supplies neither flat floor across risers nor a route/body
 * certificate. Every height comes from the actual original physical plane;
 * between-station uncertainty remains recorded and must be checked by a
 * separate riser/terminal/full-body clearance consumer. */
import {
  Rational,
  rational,
  type NativeRationalParts,
  type NativeRationalPoint,
  nativeRationalOverlay,
} from "./native-rational-overlay.ts";
import { nativeRationalPointInParts } from "./native-exact-planar-topology.ts";
import {
  inspectOriginalNativeStairPhysicalInventory,
  readOriginalNativeStairPhysicalSource,
  type OriginalNativeStairPhysicalContext,
} from "./native-source-stair-physical-inventory.ts";
import { inspectOriginalNativeStairSupportEnvelopes } from "./native-source-stair-support-envelopes.ts";
import type {
  NativeStairTypedDescriptor,
  NativeStairTypedFifo,
} from "./native-stair-typed-fifo.ts";

/** A named begin/end boundary supplies finite transverse coverage for a
 * requested internal floor approach station. It does not identify an original
 * graph node or assert that a point offset from this line lies on the riser.
 * Exact projection and outward-side tests retain every source coordinate. */
export function inspectOriginalNativeRunTerminalTransverseDemand(
  context: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
  terminal: "lower" | "upper",
  pointFeet: readonly [number, number],
  lateralAxis: "x" | "y",
) {
  const source = readOriginalNativeStairPhysicalSource(context, nativeRunId),
    run = source.run;
  if (pointFeet.length !== 2 || pointFeet.some((v) => !Number.isFinite(v)))
    throw Error("Invalid original terminal transverse demand");
  const resolve = (descriptor: NativeStairTypedDescriptor) => {
    const entries = run.entries.filter((e) =>
      descriptor.token > 0
        ? e.descriptor.token === descriptor.token
        : e.descriptor.start === descriptor.start &&
          e.descriptor.end === descriptor.end &&
          e.descriptor.path === descriptor.path,
    );
    if (
      entries.length !== 1 ||
      entries[0]!.descriptor.sourceClassSlot !== descriptor.sourceClassSlot
    )
      throw Error("Missing or ambiguous original terminal source occurrence");
    return entries[0]!;
  };
  const field = terminal === "lower" ? "m_oStartRiser" : "m_oEndRiser",
    descriptor = run.root[field] as NativeStairTypedDescriptor,
    entry = resolve(descriptor),
    line = entry.value;
  const vector = (v: unknown, n: number) => {
    if (
      !Array.isArray(v) ||
      v.length !== n ||
      v.some((x) => typeof x !== "number" || !Number.isFinite(x))
    )
      throw Error("Invalid original finite terminal controls");
    return v as number[];
  };
  const origin = vector(line.m_origin, 3),
    direction = vector(line.m_dirVec, 3),
    params = vector(line.m_endParams, 2);
  if (
    entry.sourceClassName !== "GLine" ||
    direction[2] !== 0 ||
    params[0] === params[1] ||
    !direction.slice(0, 2).some((v) => v !== 0)
  )
    throw Error("Unsupported original terminal boundary");
  const add = (a: Rational, b: Rational) =>
      new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
    sub = (a: Rational, b: Rational) =>
      new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
    mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d),
    div = (a: Rational, b: Rational) => new Rational(a.n * b.d, a.d * b.n),
    cmp = (a: Rational, b: Rational) =>
      a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
  const a: [Rational, Rational] = [
      rational(pointFeet[0]),
      rational(pointFeet[1]),
    ],
    b: [Rational, Rational] = [a[0], a[1]],
    axis = lateralAxis === "x" ? 0 : 1;
  a[axis] = sub(a[axis], rational(1));
  b[axis] = add(b[axis], rational(1));
  const d = direction.slice(0, 2).map(rational),
    o = origin.slice(0, 2).map(rational),
    den = add(mul(d[0]!, d[0]!), mul(d[1]!, d[1]!)),
    projected = [a, b].map((p) =>
      div(add(mul(sub(p[0], o[0]!), d[0]!), mul(sub(p[1], o[1]!), d[1]!)), den),
    );
  const lo = rational(Math.min(...params)),
    hi = rational(Math.max(...params));
  const treads = run.root.m_stairsTreadInfoArr as NativeStairTypedDescriptor[];
  if (!Array.isArray(treads) || !treads.length)
    throw Error("Missing original typed terminal tread");
  const tread = resolve(treads[terminal === "lower" ? 0 : treads.length - 1]!),
    intent = vector(tread.value.m_runDirProj, 3);
  if (tread.sourceClassName !== "StairsTreadInfo" || intent[2] !== 0)
    throw Error("Unsupported original terminal tread intent");
  const outwardOperands = [a, b].map((p) =>
    add(
      mul(sub(p[0], o[0]!), rational(intent[0]!)),
      mul(sub(p[1], o[1]!), rational(intent[1]!)),
    ),
  );
  return {
    sourceModelSha256: source.sourceModelSha256,
    sourceSchemaSha256: source.sourceSchemaSha256,
    sourceFrameSha256s: source.sourceFrameSha256s,
    nativeStairId: source.nativeStairId,
    nativeRunId,
    terminal,
    originalNamedSourceField: field,
    originalSourceDescriptor: descriptor,
    originalSourceLine: line,
    originalSourceLineFieldSpans: entry.fields,
    requestedTwoFootStationEndpointsFeet: [a, b],
    exactProjectedSourceParameters: projected,
    originalFiniteSourceParameterBounds: [lo, hi],
    requestedFullTwoFootProjectionWithinNamedSourceBoundary: projected.every(
      (t) => cmp(t, lo) >= 0 && cmp(t, hi) <= 0,
    ),
    originalOutwardSideOperands: outwardOperands,
    requestedStationOnOriginalOutwardApproachSide: outwardOperands.every((t) =>
      terminal === "lower" ? t.n <= 0n : t.n >= 0n,
    ),
    originalLogicalGraphNodeIdentityVerified: false as const,
    originalSourceRunTerminalXYVerified: false as const,
    coordinatesChanged: false as const,
    physicalRiserBodyApproved: false as const,
    routeApproved: false as const,
  };
}
/** Named native riser indices, not opaque generator-opcode interpretation.
 * Every curve keeps its original coordinates; the match is explicitly plan
 * controls only, since these metadata curves use their own source heights. */
export function inspectOriginalStairTypedRiserSequence(
  run: NativeStairTypedFifo,
  typedCount: number,
) {
  const blockers: string[] = [],
    treadRelations: {
      typedIndex: number;
      startRiserIndex: number;
      endRiserIndex: number;
      sourceTypedInfoSpan: number[];
      sourceStartCurveSpan: number[];
      sourceEndCurveSpan: number[];
      sourceStartLineSpan: number[];
      sourceEndLineSpan: number[];
      originalFiniteStartLine: Record<string, unknown>;
      originalFiniteEndLine: Record<string, unknown>;
      originalTreadType: number;
      originalActualDepthFeet: number;
      originalIntentPlanPartsFeet: NativeRationalParts;
    }[] = [],
    orderedRisers: {
      index: number;
      sourceLoopSpan: number[];
      sourceCurveSpan: number[];
      sourceCurveDescriptor: NativeStairTypedDescriptor;
      originalCurve: Record<string, unknown>;
    }[] = [];
  try {
    const root = run.root,
      descriptors = root.m_orderedRisers as NativeStairTypedDescriptor[],
      treads = root.m_stairsTreadInfoArr as NativeStairTypedDescriptor[];
    if (
      !run.completeOriginalTypedRootAndFifoByteReplay ||
      run.rootClassName !== "StairsRun" ||
      !Number.isSafeInteger(typedCount) ||
      typedCount < 1 ||
      !Array.isArray(descriptors) ||
      descriptors.length !== typedCount + 1 ||
      !Array.isArray(treads) ||
      treads.length !== typedCount ||
      root.m_beginWithRiser !== 1 ||
      root.m_endWithRiser !== 1 ||
      !Number.isSafeInteger(root.m_baseRiserIndex) ||
      Number(root.m_baseRiserIndex) < 0 ||
      root.m_topRiserIndex !==
        Number(root.m_baseRiserIndex) + descriptors.length
    )
      throw Error("Unsupported original begin/end/ordered-riser layout");
    const resolve = (d: NativeStairTypedDescriptor) => {
      if (!d || !d.token) throw Error("Missing original riser descriptor");
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
        throw Error("Ambiguous original riser object occurrence");
      return found[0]!;
    };
    const line = (d: NativeStairTypedDescriptor) => {
      const entry = resolve(d),
        v = entry.value;
      for (const [k, n] of [
        ["m_origin", 3],
        ["m_dirVec", 3],
        ["m_endParams", 2],
      ] as const) {
        const a = v[k];
        if (
          !Array.isArray(a) ||
          a.length !== n ||
          a.some((x) => typeof x !== "number" || !Number.isFinite(x))
        )
          throw Error("Unsupported original riser line controls");
      }
      if (
        entry.sourceClassName !== "GLine" ||
        (v.m_dirVec as number[])[2] !== 0 ||
        (v.m_endParams as number[])[0] === (v.m_endParams as number[])[1]
      )
        throw Error("Original riser is not a finite horizontal GLine");
      return entry;
    };
    for (const [index, descriptor] of descriptors.entries()) {
      const loop = resolve(descriptor),
        curves = loop.value.m_curves as NativeStairTypedDescriptor[];
      if (
        loop.sourceClassName !== "CurveLoop" ||
        loop.value.m_open !== 1 ||
        !Array.isArray(curves) ||
        curves.length !== 1
      )
        throw Error("Unsupported original ordered-riser loop");
      const c = line(curves[0]!);
      orderedRisers.push({
        index: Number(root.m_baseRiserIndex) + index,
        sourceLoopSpan: [loop.start, loop.end],
        sourceCurveSpan: [c.start, c.end],
        sourceCurveDescriptor: c.descriptor,
        originalCurve: structuredClone(c.value),
      });
    }
    const planControls = (v: Record<string, unknown>) =>
      JSON.stringify([
        (v.m_origin as number[]).slice(0, 2),
        v.m_dirVec,
        v.m_endParams,
      ]);
    for (const [index, descriptor] of treads.entries()) {
      const entry = resolve(descriptor),
        start = entry.value.m_startRiser as Record<string, unknown>,
        end = entry.value.m_endRiser as Record<string, unknown>;
      if (
        entry.sourceClassName !== "StairsTreadInfo" ||
        !start ||
        !end ||
        start.m_specifiedIdx !== Number(root.m_baseRiserIndex) + index ||
        end.m_specifiedIdx !== Number(root.m_baseRiserIndex) + index + 1
      )
        throw Error(
          "Original tread does not bind consecutive named riser indices",
        );
      const a = line(start.m_pRiserCurve as NativeStairTypedDescriptor),
        b = line(end.m_pRiserCurve as NativeStairTypedDescriptor);
      if (
        planControls(a.value) !==
          planControls(orderedRisers[index]!.originalCurve) ||
        planControls(b.value) !==
          planControls(orderedRisers[index + 1]!.originalCurve)
      )
        throw Error(
          "Named original riser plan controls do not match their original ordered curves",
        );
      const startLine = line(
          entry.value.m_startLine as NativeStairTypedDescriptor,
        ),
        endLine = line(entry.value.m_endLine as NativeStairTypedDescriptor);
      let intent: NativeRationalParts = [];
      if (
        entry.value.m_treadType === 3 &&
        typeof entry.value.m_actDepth === "number" &&
        entry.value.m_actDepth > 0
      ) {
        const riserDirection = entry.value.m_riserDir as number[];
        if (
          !Array.isArray(riserDirection) ||
          riserDirection.length !== 3 ||
          riserDirection.some(
            (v) => typeof v !== "number" || !Number.isFinite(v),
          ) ||
          riserDirection[2] !== 0
        )
          throw Error("Unsupported original tread riser direction");
        const endpoints = (v: Record<string, unknown>) => {
          const points = (v.m_endParams as number[]).map(
            (t) =>
              [0, 1].map((k) =>
                add(
                  rational((v.m_origin as number[])[k]!),
                  mul(rational((v.m_dirVec as number[])[k]!), rational(t)),
                ),
              ) as NativeRationalPoint,
          );
          const direction = add(
            mul(
              sub(points[1]![0], points[0]![0]),
              rational(riserDirection[0]!),
            ),
            mul(
              sub(points[1]![1], points[0]![1]),
              rational(riserDirection[1]!),
            ),
          );
          if (!direction.n)
            throw Error(
              "Original finite boundary cannot be oriented by the declared riser direction",
            );
          return direction.n > 0n ? points : [points[1]!, points[0]!];
        };
        const a = endpoints(startLine.value),
          b = endpoints(endLine.value),
          ring = [a[0]!, a[1]!, b[1]!, b[0]!];
        const signs = ring.map((p, i) => {
          const q = ring[(i + 1) % 4]!,
            r = ring[(i + 2) % 4]!;
          return sub(
            mul(sub(q[0], p[0]), sub(r[1], p[1])),
            mul(sub(q[1], p[1]), sub(r[0], p[0])),
          ).n;
        });
        if (
          signs.some((n) => !n) ||
          (!signs.every((n) => n > 0n) && !signs.every((n) => n < 0n))
        )
          throw Error(
            "Original finite straight-tread intent is not a strict source-oriented quadrilateral",
          );
        intent = nativeRationalOverlay("union", [
          [[a[0]!, a[1]!, b[1]!, b[0]!]],
        ]);
        if (!intent.length)
          throw Error("Original finite straight-tread intent is degenerate");
      }
      if (
        index &&
        planControls(treadRelations.at(-1)!.originalFiniteEndLine) !==
          planControls(startLine.value)
      )
        throw Error(
          "Consecutive original finite tread boundary lines do not match",
        );
      treadRelations.push({
        typedIndex: index,
        startRiserIndex: Number(root.m_baseRiserIndex) + index,
        endRiserIndex: Number(root.m_baseRiserIndex) + index + 1,
        sourceTypedInfoSpan: [entry.start, entry.end],
        sourceStartCurveSpan: [a.start, a.end],
        sourceEndCurveSpan: [b.start, b.end],
        sourceStartLineSpan: [startLine.start, startLine.end],
        sourceEndLineSpan: [endLine.start, endLine.end],
        originalFiniteStartLine: structuredClone(startLine.value),
        originalFiniteEndLine: structuredClone(endLine.value),
        originalTreadType: Number(entry.value.m_treadType),
        originalActualDepthFeet: Number(entry.value.m_actDepth),
        originalIntentPlanPartsFeet: intent,
      });
    }
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  return {
    completeNamedSourceRiserSequence: blockers.length === 0,
    treadRelations,
    orderedRisers,
    blockers,
    originalSourceAuthorityGranted: false as const,
    exactPhysicalRiserBodyCorrespondenceApproved: false as const,
    routeApproved: false as const,
  };
}
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => new Rational(a.n * b.d, a.d * b.n);
const cmp = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
type P3 = [Rational, Rational, Rational];
/** Exact closed segment containment, including every intervening boundary/hole
 * crossing. Endpoint tests alone cannot establish the full lateral width. */
export function nativeAxisAlignedSegmentInExactParts(
  a: NativeRationalPoint,
  b: NativeRationalPoint,
  parts: NativeRationalParts,
): boolean {
  const fixed = cmp(a[0], b[0]) === 0 ? 0 : cmp(a[1], b[1]) === 0 ? 1 : -1;
  if (fixed === -1) return false;
  const moving = 1 - fixed,
    lo = cmp(a[moving]!, b[moving]!) < 0 ? a[moving]! : b[moving]!,
    hi = cmp(a[moving]!, b[moving]!) > 0 ? a[moving]! : b[moving]!;
  if (cmp(lo, hi) === 0) return nativeRationalPointInParts(a, parts);
  const cuts = [lo, hi];
  for (const part of parts)
    for (const ring of part)
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!,
          q = ring[(i + 1) % ring.length]!,
          den = sub(q[fixed]!, p[fixed]!);
        if (!den.n) {
          if (cmp(p[fixed]!, a[fixed]!) === 0)
            cuts.push(p[moving]!, q[moving]!);
          continue;
        }
        const t = div(sub(a[fixed]!, p[fixed]!), den);
        if (cmp(t, rational(0)) < 0 || cmp(t, rational(1)) > 0) continue;
        cuts.push(add(p[moving]!, mul(t, sub(q[moving]!, p[moving]!))));
      }
  const ordered = [
      ...new Map(
        cuts
          .filter((c) => cmp(c, lo) >= 0 && cmp(c, hi) <= 0)
          .map((c) => [`${c.n}/${c.d}`, c]),
      ).values(),
    ].sort(cmp),
    point = (c: Rational): NativeRationalPoint =>
      fixed === 0 ? [a[0], c] : [c, a[1]];
  for (let i = 0; i < ordered.length; i++) {
    if (!nativeRationalPointInParts(point(ordered[i]!), parts)) return false;
    if (
      i &&
      !nativeRationalPointInParts(
        point(div(add(ordered[i - 1]!, ordered[i]!), rational(2))),
        parts,
      )
    )
      return false;
  }
  return true;
}
/** A rational normal whose Euclidean half-width is at least one foot.
 * It may conservatively widen a diagonal; it never rounds the width inward. */
export function nativeConservativeTwoFootStrip(
  a: NativeRationalPoint,
  b: NativeRationalPoint,
): NativeRationalParts {
  const dx = sub(b[0], a[0]),
    dy = sub(b[1], a[1]),
    abs = (q: Rational) => new Rational(q.n < 0n ? -q.n : q.n, q.d),
    scale = cmp(abs(dx), abs(dy)) > 0 ? abs(dx) : abs(dy);
  if (!scale.n) return [];
  const nx = div(new Rational(-dy.n, dy.d), scale),
    ny = div(dx, scale);
  return [
    [
      [
        [add(a[0], nx), add(a[1], ny)],
        [add(b[0], nx), add(b[1], ny)],
        [sub(b[0], nx), sub(b[1], ny)],
        [sub(a[0], nx), sub(a[1], ny)],
      ],
    ],
  ];
}
export type OriginalStairStationProposal = {
  typedIndex: number;
  pointFeet: [number, number];
  lateralAxis: "x" | "y";
};
export function inspectOriginalNativeStairSteppedStations(
  context: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
  proposal: readonly OriginalStairStationProposal[],
) {
  const source = readOriginalNativeStairPhysicalSource(context, nativeRunId),
    roles = inspectOriginalNativeStairPhysicalInventory(context, nativeRunId),
    envelopes = inspectOriginalNativeStairSupportEnvelopes(
      context,
      nativeRunId,
    ),
    blockers: string[] = [];
  if (
    !roles.completeOriginalSourceFaceCensus ||
    !roles.treadHistoryBindingComplete ||
    roles.unsupportedPhysicalFaceTokens.length ||
    roles.unsupportedPhysicalTreadEdgeTokens.length ||
    !envelopes.completeOriginalStraightPlanarSourceCensus
  )
    blockers.push("Incomplete original physical source/history/support census");
  if (
    !proposal.length ||
    proposal.length > 10000 ||
    proposal.some(
      (p, i) =>
        !Number.isSafeInteger(p.typedIndex) ||
        p.pointFeet.length !== 2 ||
        p.pointFeet.some((v) => !Number.isFinite(v)) ||
        !["x", "y"].includes(p.lateralAxis) ||
        (i === 0
          ? p.typedIndex !== 0
          : p.typedIndex < proposal[i - 1]!.typedIndex ||
            p.typedIndex > proposal[i - 1]!.typedIndex + 1),
    ) ||
    proposal.at(-1)?.typedIndex !== roles.sourceTypedTreadCount - 1
  )
    throw Error(
      "A stepped proposal must visit every original typed tread in order",
    );
  const riserSequence = inspectOriginalStairTypedRiserSequence(
    source.run,
    roles.sourceTypedTreadCount,
  );
  if (!riserSequence.completeNamedSourceRiserSequence)
    blockers.push(...riserSequence.blockers);
  const points: P3[] = [],
    stations = [],
    verticalTransfers = [],
    sameTreadTransfers = [],
    steppedPlanTransfers = [];
  for (const [i, p] of proposal.entries()) {
    const role = roles.treads.find((t) => t.typedIndex === p.typedIndex),
      cap =
        role &&
        envelopes.caps.find(
          (c) => c.physicalFaceToken === role.physicalFaceToken,
        );
    if (!role || !cap) {
      blockers.push(`Original walking cap missing for station${i}`);
      continue;
    }
    const center: NativeRationalPoint = [
        rational(p.pointFeet[0]),
        rational(p.pointFeet[1]),
      ],
      axis = p.lateralAxis === "x" ? 0 : 1,
      a = [...center] as NativeRationalPoint,
      b = [...center] as NativeRationalPoint;
    a[axis] = sub(a[axis], rational(1));
    b[axis] = add(b[axis], rational(1));
    const intent =
      riserSequence.treadRelations[p.typedIndex]?.originalIntentPlanPartsFeet ??
      [];
    const intendedStation =
      !intent.length || nativeAxisAlignedSegmentInExactParts(a, b, intent);
    if (!intendedStation)
      blockers.push(
        "A physical tread station lies outside its original finite native intent boundaries",
      );
    const supported =
        nativeAxisAlignedSegmentInExactParts(
          a,
          b,
          cap.guaranteedInnerPlanSupport,
        ) && intendedStation,
      point: P3 = [center[0], center[1], cap.originalPhysicalPlaneHeightFeet];
    if (!supported)
      blockers.push(
        `Original cap does not support full two-foot lateral station${i}`,
      );
    if (points.length) {
      const previous = points.at(-1)!;
      if (cmp(point[2], previous[2]) < 0)
        blockers.push("Physical source walking planes reverse elevation");
      const prior = stations.at(-1)!;
      if (cmp(point[2], previous[2]) === 0) {
        const demand = nativeConservativeTwoFootStrip(
          [previous[0], previous[1]],
          [point[0], point[1]],
        );
        const supportedSameTread =
          prior.typedIndex === p.typedIndex &&
          nativeRationalOverlay(
            "difference",
            demand,
            cap.guaranteedInnerPlanSupport,
          ).length === 0;
        if (!supportedSameTread)
          blockers.push(
            "A same-height transfer is not wholly supported by its original physical tread",
          );
        sameTreadTransfers.push({
          fromStationIndex: i - 1,
          toStationIndex: i,
          typedIndex: p.typedIndex,
          physicalFaceToken: cap.physicalFaceToken,
          fullTwoFootInnerPlanSupport: supportedSameTread,
          exactDemandPartsFeet: demand,
        });
      }
      if (cmp(point[2], previous[2]) !== 0) {
        const originalWalkingTokens = new Set(
          roles.treads.map((t) => t.physicalFaceToken),
        );
        const possibleCaps = envelopes.caps.filter(
          (c) =>
            c.physicalFaceToken === prior.physicalFaceToken ||
            c.physicalFaceToken === cap.physicalFaceToken ||
            (!originalWalkingTokens.has(c.physicalFaceToken) &&
              cmp(c.originalPhysicalPlaneHeightFeet, previous[2]) > 0 &&
              cmp(c.originalPhysicalPlaneHeightFeet, point[2]) < 0),
        );
        const nativeIntentParts = [
          riserSequence.treadRelations[prior.typedIndex]
            ?.originalIntentPlanPartsFeet ?? [],
          riserSequence.treadRelations[p.typedIndex]
            ?.originalIntentPlanPartsFeet ?? [],
        ];
        const sourcePossibleParts = [
          ...possibleCaps.flatMap((c) => [
            c.referenceEmbedding,
            c.boundaryUncertainty,
          ]),
          ...nativeIntentParts,
        ];
        const possible = sourcePossibleParts.length
          ? nativeRationalOverlay(
              "union",
              sourcePossibleParts[0]!,
              ...sourcePossibleParts.slice(1),
            )
          : [];
        const demand = nativeConservativeTwoFootStrip(
            [previous[0], previous[1]],
            [point[0], point[1]],
          ),
          uncovered = nativeRationalOverlay("difference", demand, possible);
        if (uncovered.length)
          blockers.push(
            "A stepped transfer leaves its original native intent, physical cap and retained uncertainty corridor",
          );
        const uncertainty = possibleCaps.length
          ? nativeRationalOverlay(
              "union",
              possibleCaps[0]!.boundaryUncertainty,
              ...possibleCaps.slice(1).map((c) => c.boundaryUncertainty),
            )
          : [];
        steppedPlanTransfers.push({
          fromStationIndex: i - 1,
          toStationIndex: i,
          originalPhysicalFaceTokens: possibleCaps.map(
            (c) => c.physicalFaceToken,
          ),
          originalSharedRiserIndex:
            riserSequence.treadRelations[prior.typedIndex]?.endRiserIndex,
          withinOriginalSourceSteppedPlanCorridor: uncovered.length === 0,
          originalNativeIntentPlanPartsFeet: nativeIntentParts,
          unsupportedPlanPartsFeet: uncovered,
          retainedUncertaintyCrossingPartsFeet: nativeRationalOverlay(
            "intersection",
            demand,
            uncertainty,
          ),
          positiveFlatFloorSupportAcrossRiserClaimed: false as const,
        });
        verticalTransfers.push({
          fromStationIndex: i - 1,
          toStationIndex: i,
          fromTypedIndex: prior.typedIndex,
          toTypedIndex: p.typedIndex,
          originalSharedRiserIndex:
            riserSequence.treadRelations[prior.typedIndex]?.endRiserIndex,
          originalOrderedRiserCurveSpan:
            riserSequence.orderedRisers[prior.typedIndex + 1]?.sourceCurveSpan,
          originalLowerPhysicalFaceToken: prior.physicalFaceToken,
          originalUpperPhysicalFaceToken: cap.physicalFaceToken,
          pointXYFeetExact: [previous[0], previous[1]],
          lateralEndpointsFeetExact: prior.lateralEndpointsFeetExact,
          lowOriginalPhysicalPlaneHeightFeet: previous[2],
          highOriginalPhysicalPlaneHeightFeet: point[2],
        });
        points.push([previous[0], previous[1], point[2]]);
      }
    }
    points.push(point);
    stations.push({
      stationIndex: i,
      typedIndex: p.typedIndex,
      physicalFaceToken: cap.physicalFaceToken,
      physicalFaceTag: cap.physicalFaceTag,
      physicalSourceComponentIndex: cap.sourceComponentIndex,
      pointFeetExact: point,
      lateralEndpointsFeetExact: [a, b],
      fullTwoFootLateralInnerSupport: supported,
      originalPhysicalPlaneHeightFeet: cap.originalPhysicalPlaneHeightFeet,
      physicalHeightMatchesTypedOrigin: role.exactHeightMatchesTyped,
    });
  }
  return {
    sourceModelSha256: source.sourceModelSha256,
    sourceSchemaSha256: source.sourceSchemaSha256,
    sourceFrameSha256s: source.sourceFrameSha256s,
    nativeStairId: source.nativeStairId,
    nativeRunId,
    originalPhysicalTreadCount: roles.treads.length,
    originalRunBottomElevationFeet: source.run.root.m_bottomElevation,
    originalRunTopElevationFeet: source.run.root.m_topElevation,
    originalOrderedRisers: source.run.root.m_orderedRisers,
    originalOrderedNosings: source.run.root.m_orderedNosingFront,
    originalNamedRiserSequence: riserSequence,
    stations,
    verticalTransfers,
    sameTreadTransfers,
    steppedPlanTransfers,
    proposedRiseThenGoPointsFeetExact: points,
    allOriginalPhysicalTreadStationsSupported:
      stations.length === proposal.length &&
      stations.every((s) => s.fullTwoFootLateralInnerSupport),
    completeOriginalSteppedSupportProposal: blockers.length === 0,
    blockers,
    betweenTreadUncertaintyRetained: true as const,
    flatFloorAcrossRisersInvented: false as const,
    physicalRiserCorrespondenceApproved: false as const,
    completePhysicalBodyApproved: false as const,
    terminalContactsApproved: false as const,
    ownBodyAndHeadroomClearanceApproved: false as const,
    routeApproved: false as const,
  };
}
