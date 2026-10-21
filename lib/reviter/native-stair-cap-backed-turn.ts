/** Explicit source cap-backed turning-tread mathematics. Source authority and
 * every physical width/body/terminal/clearance guard remain the consumer's job. */
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalParts,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import { inspectOriginalStairRiserLocalPartition } from "./native-stair-riser-local-partition.ts";
import type {
  NativeStairTypedFifo,
  NativeStairTypedDescriptor,
} from "./native-stair-typed-fifo.ts";
export type OriginalCapBackedTurnOperands = {
  mode: "original-cap-backed-turn-v1";
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  nativeStairId: number;
  nativeRunId: number;
  nativeDefinitionId: number;
  sourceGeometryOwnerElementId: number;
  originalRunFrameSha256: string;
  originalDefinitionFrameSha256: string;
  typedIndex: number;
  originalTreadHistoryBinding: {
    typedIndex: number;
    physicalFaceToken: number;
    physicalFaceTag: number;
    history: { id: number; keys: number[] }[];
    coedges: { sourceEdgeToken: number }[];
  };
  cap: {
    physicalFaceToken: number;
    physicalFaceTag: number;
    sourceComponentIndex: number;
    originalPhysicalPlaneHeightFeet: Rational;
    allEndpointEmbeddingHeightBand: [Rational, Rational];
    originalEdgeTokens: number[];
    referenceEmbedding: NativeRationalParts;
    boundaryUncertainty: NativeRationalParts;
    guaranteedInnerPlanSupport: NativeRationalParts;
  };
};
const sourceId = (v: unknown) =>
  (v as { m_id?: { m_id64?: unknown } } | undefined)?.m_id?.m_id64;
const positiveId = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 0x7f_ff_ff_ff;
const sha = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const zeroVector = (v: unknown) =>
  Array.isArray(v) && v.length === 3 && v.every((n) => n === 0);
const add = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
  sub = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
  mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d),
  cross = (a: NativeRationalPoint, b: NativeRationalPoint) =>
    sub(mul(a[0], b[1]), mul(a[1], b[0])),
  delta = (
    a: NativeRationalPoint,
    b: NativeRationalPoint,
  ): NativeRationalPoint => [sub(a[0], b[0]), sub(a[1], b[1])],
  key = (p: NativeRationalPoint) => p.map((q) => `${q.n}/${q.d}`).join(":"),
  cmp = (a: Rational, b: Rational) => {
    const n = sub(a, b).n;
    return n < 0n ? -1 : n > 0n ? 1 : 0;
  };
const on = (
  p: NativeRationalPoint,
  a: NativeRationalPoint,
  b: NativeRationalPoint,
) =>
  cross(delta(p, a), delta(b, a)).n === 0n &&
  [0, 1].every(
    (i) =>
      (cmp(p[i]!, a[i]!) >= 0 && cmp(p[i]!, b[i]!) <= 0) ||
      (cmp(p[i]!, b[i]!) >= 0 && cmp(p[i]!, a[i]!) <= 0),
  );
function touch(
  a: NativeRationalPoint,
  b: NativeRationalPoint,
  c: NativeRationalPoint,
  d: NativeRationalPoint,
) {
  const u = cross(delta(b, a), delta(c, a)).n,
    v = cross(delta(b, a), delta(d, a)).n,
    w = cross(delta(d, c), delta(a, c)).n,
    x = cross(delta(d, c), delta(b, c)).n;
  return (
    (u < 0n !== v < 0n &&
      w < 0n !== x < 0n &&
      u !== 0n &&
      v !== 0n &&
      w !== 0n &&
      x !== 0n) ||
    on(a, c, d) ||
    on(b, c, d) ||
    on(c, a, b) ||
    on(d, a, b)
  );
}
function validateParts(parts: NativeRationalParts, allowEmpty: boolean) {
  if (
    !Array.isArray(parts) ||
    (!allowEmpty && parts.length === 0) ||
    parts.length > 10_000
  )
    throw new Error("Missing/oversized original cap domain");
  let budget = 0;
  for (const part of parts) {
    if (!Array.isArray(part) || part.length === 0)
      throw new Error("Missing original cap shell/hole structure");
    for (const originalRing of part) {
      if (
        !Array.isArray(originalRing) ||
        originalRing.length < 3 ||
        originalRing.length > 2048 ||
        !originalRing.every(
          (p) =>
            Array.isArray(p) &&
            p.length === 2 &&
            p.every((q) => q instanceof Rational && q.d > 0n),
        )
      )
        throw new Error("Invalid original exact cap coordinates");
      const ring =
        key(originalRing[0]!) === key(originalRing.at(-1)!)
          ? originalRing.slice(0, -1)
          : originalRing;
      if (ring.length < 3) throw new Error("Degenerate original cap ring");
      budget += ring.length;
      if (budget > 100_000 || new Set(ring.map(key)).size !== ring.length)
        throw new Error("Repeated/oversized original cap ring");
      let area = rational(0);
      for (let i = 0; i < ring.length; i++) {
        area = add(area, cross(ring[i]!, ring[(i + 1) % ring.length]!));
        for (let j = i + 1; j < ring.length; j++) {
          if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
          if (
            touch(
              ring[i]!,
              ring[(i + 1) % ring.length]!,
              ring[j]!,
              ring[(j + 1) % ring.length]!,
            )
          )
            throw new Error("Self-intersecting original cap ring");
        }
      }
      if (!area.n) throw new Error("Degenerate original cap ring");
    }
  }
}
const copyParts = (parts: NativeRationalParts): NativeRationalParts =>
  parts.map((part) =>
    part.map((ring) =>
      ring.map(
        (p) => p.map((q) => new Rational(q.n, q.d)) as NativeRationalPoint,
      ),
    ),
  );
/** The explicit packet must be source-qualified by actual native inventory,
 * full history and complete cap envelopes before this mathematical function
 * is called. A caller packet or saved result never issues that authority. */
export function inspectOriginalCapBackedTurn(
  run: NativeStairTypedFifo,
  typedIndex: number,
  operands: OriginalCapBackedTurnOperands,
) {
  if (
    !operands ||
    operands.mode !== "original-cap-backed-turn-v1" ||
    ![
      operands.sourceModelSha256,
      operands.sourceSchemaSha256,
      operands.originalRunFrameSha256,
      operands.originalDefinitionFrameSha256,
    ].every(sha) ||
    ![
      operands.nativeStairId,
      operands.nativeRunId,
      operands.nativeDefinitionId,
    ].every(positiveId) ||
    operands.sourceGeometryOwnerElementId !== operands.nativeDefinitionId ||
    operands.nativeRunId !== run.nativeRunId ||
    run.nativeElementId !== run.nativeRunId ||
    sourceId(run.root.m_id) !== run.nativeRunId ||
    sourceId(run.root.m_stairsId) !== operands.nativeStairId ||
    sourceId(run.root.m_triserSymId) !== operands.nativeDefinitionId ||
    typedIndex !== operands.typedIndex ||
    !Number.isSafeInteger(typedIndex)
  )
    throw new Error(
      "Missing/foreign explicit original cap-backed turn operands",
    );
  const local = inspectOriginalStairRiserLocalPartition(run),
    relation = local.treadRelations[typedIndex];
  if (!relation)
    throw new Error(
      "Original cap-backed typed index is outside complete local list",
    );
  const resolve = (d: NativeStairTypedDescriptor) => {
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
      throw new Error("Missing/ambiguous original turning source descriptor");
    return found[0]!;
  };
  const tread = resolve(
      (run.root.m_stairsTreadInfoArr as NativeStairTypedDescriptor[])[
        typedIndex
      ]!,
    ),
    v = tread.value;
  if (
    v.m_treadType !== 3 ||
    (v.m_runType !== 1 && v.m_runType !== 2) ||
    !zeroVector(v.m_runDirProj) ||
    !zeroVector(v.m_riserDir) ||
    !zeroVector(v.m_norm) ||
    (v.m_flipped !== 0 && v.m_flipped !== 1) ||
    typeof v.m_actDepth !== "number" ||
    !Number.isFinite(v.m_actDepth) ||
    v.m_actDepth <= 0
  )
    throw new Error("Unsupported original zero-direction turning mode");
  const planControls = (line: Record<string, unknown>) =>
    JSON.stringify([
      (line.m_origin as number[]).slice(0, 2),
      line.m_dirVec,
      line.m_endParams,
    ]);
  const previous = local.treadRelations[typedIndex - 1],
    next = local.treadRelations[typedIndex + 1];
  if (
    (previous &&
      planControls(previous.originalFiniteEndLine) !==
        planControls(relation.originalFiniteStartLine)) ||
    (next &&
      planControls(next.originalFiniteStartLine) !==
        planControls(relation.originalFiniteEndLine))
  )
    throw new Error("Original turning profile boundary chain is disconnected");
  const infos = (run.root.m_stairsRunInfoArr as NativeStairTypedDescriptor[])
    .map(resolve)
    .filter(
      (e) =>
        e.sourceClassName === "StairsRunInfo" &&
        Number.isSafeInteger(e.value.m_firstRiser) &&
        Number.isSafeInteger(e.value.m_lastRiser) &&
        Number(e.value.m_firstRiser) <= typedIndex &&
        Number(e.value.m_lastRiser) > typedIndex,
    );
  if (
    infos.length !== 1 ||
    infos[0]!.value.m_runType !== v.m_runType ||
    !zeroVector(infos[0]!.value.m_runDirProj) ||
    !zeroVector(infos[0]!.value.m_riserDir) ||
    !zeroVector(infos[0]!.value.m_norm) ||
    Number(infos[0]!.value.m_firstRiser) < 0 ||
    Number(infos[0]!.value.m_lastRiser) > local.originalTypedTreadCount
  )
    throw new Error("Original turning run-info correspondence is unavailable");
  const endpoints = (line: Record<string, unknown>) =>
      (line.m_endParams as number[]).map(
        (t) =>
          [0, 1].map((i) =>
            add(
              rational((line.m_origin as number[])[i]!),
              mul(rational((line.m_dirVec as number[])[i]!), rational(t)),
            ),
          ) as NativeRationalPoint,
      ),
    a = endpoints(relation.originalFiniteStartLine),
    b = endpoints(relation.originalFiniteEndLine),
    points = [...a, ...b];
  if (
    new Set(points.map(key)).size !== 4 ||
    cross(delta(a[1]!, a[0]!), delta(b[1]!, b[0]!)).n === 0n
  )
    throw new Error("Original turning boundaries are repeated/parallel");
  const pairings = [
      [a[0]!, a[1]!, b[1]!, b[0]!],
      [a[0]!, a[1]!, b[0]!, b[1]!],
    ],
    strict = pairings.map((ring) => {
      const signs = ring.map(
        (p, i) =>
          cross(
            delta(ring[(i + 1) % 4]!, p),
            delta(ring[(i + 2) % 4]!, ring[(i + 1) % 4]!),
          ).n,
      );
      return signs.every((n) => n > 0n) || signs.every((n) => n < 0n);
    });
  if (strict.filter(Boolean).length !== 1)
    throw new Error(
      "Original finite turning endpoint pairing is not unique and strictly convex",
    );
  const role = operands.originalTreadHistoryBinding,
    cap = operands.cap;
  if (
    !role ||
    !cap ||
    role.typedIndex !== typedIndex ||
    !positiveId(role.physicalFaceToken) ||
    !positiveId(role.physicalFaceTag) ||
    role.physicalFaceToken !== cap.physicalFaceToken ||
    role.physicalFaceTag !== cap.physicalFaceTag ||
    !Number.isSafeInteger(cap.sourceComponentIndex) ||
    cap.sourceComponentIndex < 0 ||
    !(cap.originalPhysicalPlaneHeightFeet instanceof Rational) ||
    !Array.isArray(cap.allEndpointEmbeddingHeightBand) ||
    cap.allEndpointEmbeddingHeightBand.length !== 2 ||
    !cap.allEndpointEmbeddingHeightBand.every((q) => q instanceof Rational) ||
    cmp(
      cap.allEndpointEmbeddingHeightBand[0],
      cap.originalPhysicalPlaneHeightFeet,
    ) > 0 ||
    cmp(
      cap.allEndpointEmbeddingHeightBand[1],
      cap.originalPhysicalPlaneHeightFeet,
    ) < 0
  )
    throw new Error("Original turning cap identity/height operands differ");
  if (
    !Array.isArray(role.history) ||
    role.history.length === 0 ||
    role.history.length > 2 ||
    role.history.some(
      (h) =>
        !positiveId(h.id) ||
        !Array.isArray(h.keys) ||
        h.keys.length !== 3 ||
        !h.keys.every(Number.isSafeInteger),
    ) ||
    new Set(role.history.map((h) => h.id)).size !== role.history.length ||
    role.history[0]!.id !== cap.physicalFaceTag
  )
    throw new Error("Incomplete original turning tread history");
  const first = role.history[0]!.keys;
  const direct =
      role.history.length === 1 &&
      first[0] === 53 &&
      first[1] === typedIndex &&
      first[2] === -1,
    pattern =
      role.history.length === 2 &&
      first[0] === 5 &&
      first[2] === typedIndex &&
      first[1] === role.history[1]!.id &&
      role.history[1]!.keys[0] === 53 &&
      role.history[1]!.keys[2] === -1 &&
      role.history[1]!.keys[1]! >= 0 &&
      role.history[1]!.keys[1]! < local.originalTypedTreadCount;
  if (!direct && !pattern)
    throw new Error("Foreign/unknown original turning tread history");
  if (
    !Array.isArray(cap.originalEdgeTokens) ||
    cap.originalEdgeTokens.length < 3 ||
    cap.originalEdgeTokens.length > 10_000 ||
    !cap.originalEdgeTokens.every(positiveId) ||
    new Set(cap.originalEdgeTokens).size !== cap.originalEdgeTokens.length ||
    !Array.isArray(role.coedges) ||
    role.coedges.some((e) => !positiveId(e.sourceEdgeToken)) ||
    JSON.stringify([...cap.originalEdgeTokens].sort((a, b) => a - b)) !==
      JSON.stringify(
        role.coedges.map((e) => e.sourceEdgeToken).sort((a, b) => a - b),
      )
  )
    throw new Error("Original turning cap coedge census differs");
  validateParts(cap.referenceEmbedding, false);
  validateParts(cap.boundaryUncertainty, true);
  validateParts(cap.guaranteedInnerPlanSupport, false);
  const inner =
    cap.boundaryUncertainty.length > 0
      ? nativeRationalOverlay(
          "difference",
          cap.referenceEmbedding,
          cap.boundaryUncertainty,
        )
      : cap.referenceEmbedding;
  if (
    nativeRationalOverlay("xor", inner, cap.guaranteedInnerPlanSupport).length >
    0
  )
    throw new Error(
      "Original turning guaranteed support omits uncertainty/holes",
    );
  return {
    mode: operands.mode,
    nativeStairId: operands.nativeStairId,
    nativeRunId: operands.nativeRunId,
    nativeDefinitionId: operands.nativeDefinitionId,
    sourceGeometryOwnerElementId: operands.sourceGeometryOwnerElementId,
    typedIndex,
    originalPhysicalFaceToken: cap.physicalFaceToken,
    originalPhysicalFaceTag: cap.physicalFaceTag,
    originalTreadSourceSpan: [tread.start, tread.end],
    originalRunInfoSourceSpan: [infos[0]!.start, infos[0]!.end],
    originalTreadType: v.m_treadType,
    originalRunType: v.m_runType,
    originalRiserDir: structuredClone(v.m_riserDir),
    originalRunDirProj: structuredClone(v.m_runDirProj),
    originalNormal: structuredClone(v.m_norm),
    originalRunInfo: structuredClone(infos[0]!.value),
    originalFiniteStartLine: relation.originalFiniteStartLine,
    originalFiniteEndLine: relation.originalFiniteEndLine,
    uniqueOriginalEndpointPairing: strict[0] ? 0 : 1,
    originalTreadHistory: structuredClone(role.history),
    originalEdgeTokens: [...cap.originalEdgeTokens],
    originalPhysicalPlaneHeightFeet: new Rational(
      cap.originalPhysicalPlaneHeightFeet.n,
      cap.originalPhysicalPlaneHeightFeet.d,
    ),
    originalEndpointEmbeddingHeightBand: cap.allEndpointEmbeddingHeightBand.map(
      (q) => new Rational(q.n, q.d),
    ),
    originalCapReferenceIntentPartsFeet: copyParts(cap.referenceEmbedding),
    originalCapUncertaintyPartsFeet: copyParts(cap.boundaryUncertainty),
    originalGuaranteedInnerSupportPartsFeet: copyParts(
      cap.guaranteedInnerPlanSupport,
    ),
    hullUsedAsPositiveSupport: false as const,
    sourceAuthorityGranted: false as const,
    fullTwoFootStationOrTransferApproved: false as const,
    physicalBodyHeadroomOrTerminalApproved: false as const,
    routeApproved: false as const,
  };
}
