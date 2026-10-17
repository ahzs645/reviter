/** Browser-safe exact replay of retained typed riser operands. No source issuance. */
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalParts,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import { nativeRationalPointInParts } from "./native-exact-planar-topology.ts";
import type {
  NativeStairTypedDescriptor,
  NativeStairTypedFifo,
} from "./native-stepped-stair-v2-source-types.ts";
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
      throw new Error("Unsupported original begin/end/ordered-riser layout");
    const resolve = (d: NativeStairTypedDescriptor) => {
      if (!d || !d.token) throw new Error("Missing original riser descriptor");
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
        throw new Error("Ambiguous original riser object occurrence");
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
          throw new Error("Unsupported original riser line controls");
      }
      if (
        entry.sourceClassName !== "GLine" ||
        (v.m_dirVec as number[])[2] !== 0 ||
        (v.m_endParams as number[])[0] === (v.m_endParams as number[])[1]
      )
        throw new Error("Original riser is not a finite horizontal GLine");
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
        throw new Error("Unsupported original ordered-riser loop");
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
        throw new Error(
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
        throw new Error(
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
          throw new Error("Unsupported original tread riser direction");
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
            throw new Error(
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
          throw new Error(
            "Original finite straight-tread intent is not a strict source-oriented quadrilateral",
          );
        intent = nativeRationalOverlay("union", [
          [[a[0]!, a[1]!, b[1]!, b[0]!]],
        ]);
        if (intent.length === 0)
          throw new Error(
            "Original finite straight-tread intent is degenerate",
          );
      }
      if (
        index &&
        planControls(treadRelations.at(-1)!.originalFiniteEndLine) !==
          planControls(startLine.value)
      )
        throw new Error(
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
