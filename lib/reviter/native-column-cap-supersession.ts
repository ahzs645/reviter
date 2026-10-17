/** Source-review proposal builder. It preserves the complete old recipe and
 * source cap, and follows a consecutive first-contact chain of the current
 * native column. Floor, doorway, exclusions and all foreign first-surface
 * checks are mandatory in the independent atomic source-review consumer. */
import { createHash } from "node:crypto";
import * as DMath from "./deterministic-math.ts";
import { rational, Rational } from "./native-rational-overlay.ts";
import {
  validNativeContinuation,
  validateNativeBoundaryPatches,
  type NativeBoundaryPatch,
  type BoundaryWall,
} from "./native-boundary-patches.ts";
type Point = [number, number];
type NativeColumn = BoundaryWall & { geometrySource?: string };
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
function simpleColumn(column: Point[]) {
  const sub = (a: Rational, b: Rational) =>
      new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
    mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
  const turn = (a: Point, b: Point, c: Point) =>
    sub(
      mul(
        sub(rational(b[0]), rational(a[0])),
        sub(rational(c[1]), rational(a[1])),
      ),
      mul(
        sub(rational(b[1]), rational(a[1])),
        sub(rational(c[0]), rational(a[0])),
      ),
    ).n;
  const on = (p: Point, a: Point, b: Point) =>
    turn(a, b, p) === 0n &&
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1]);
  let twiceArea = rational(0);
  for (let i = 0; i < column.length; i++) {
    const a = column[i]!,
      b = column[(i + 1) % column.length]!;
    const term = sub(
      mul(rational(a[0]), rational(b[1])),
      mul(rational(a[1]), rational(b[0])),
    );
    twiceArea = new Rational(
      twiceArea.n * term.d + term.n * twiceArea.d,
      twiceArea.d * term.d,
    );
  }
  if (twiceArea.n === 0n) return false;
  for (let i = 0; i < column.length; i++) {
    const a = column[i]!,
      b = column[(i + 1) % column.length]!;
    if (same(a, b)) return false;
    for (let j = i + 1; j < column.length; j++) {
      const c = column[j]!,
        d = column[(j + 1) % column.length]!;
      if (j === i + 1 || (i === 0 && j === column.length - 1)) continue;
      const ac = turn(a, b, c),
        ad = turn(a, b, d),
        ca = turn(c, d, a),
        cb = turn(c, d, b);
      if (
        (ac * ad < 0n && ca * cb < 0n) ||
        on(c, a, b) ||
        on(d, a, b) ||
        on(a, c, d) ||
        on(b, c, d)
      )
        return false;
    }
  }
  return true;
}

type SourceCapConstruction = {
  sourceCapFeet: [Point, Point];
  originalSourceEvidence: NativeBoundaryPatch["wallEvidence"][number];
};
/** Internal shape construction still requires independent source binding and all
 * physical guards. A current source-cap rebind is an explicit new recipe. */
function buildNativeColumnCapSupersessionShape(
  original: NativeBoundaryPatch,
  currentColumn: NativeColumn,
  sourceRebind?: SourceCapConstruction,
) {
  try {
    const before = digest(original),
      originalProof = original.continuationProof,
      proof =
        originalProof && sourceRebind
          ? { ...originalProof, sourceCapFeet: sourceRebind.sourceCapFeet }
          : originalProof;
    if (
      !proof ||
      original.status !== "applied" ||
      original.drawingReconstructionProof ||
      original.assumedEnclosureProof ||
      original.manualPointsFeet ||
      original.nativeDoorIds.length
    )
      throw Error("An original applied native cap continuation is required");
    validateNativeBoundaryPatches(
      { version: 1, patches: [original] },
      original.sourceModelSha256,
    );
    const source =
        sourceRebind?.originalSourceEvidence ??
        original.wallEvidence.find(
          (w) => w.nativeElementId === proof.sourceWallId,
        ),
      target = original.wallEvidence.filter(
        (w) => w.nativeElementId !== proof.sourceWallId,
      );
    if (
      !source ||
      source.kind === "column" ||
      target.length !== 1 ||
      (target[0]!.kind ?? "wall") !== "column" ||
      currentColumn.kind !== "column" ||
      currentColumn.nativeElementId !== target[0]!.nativeElementId ||
      currentColumn.levelId !== original.levelId ||
      currentColumn.approximate ||
      currentColumn.reviewPatchId ||
      currentColumn.geometrySource !== "original-native-material-section" ||
      currentColumn.ringsFeet.length !== 1
    )
      throw Error(
        "The complete same-owner current native column section is required",
      );
    const raw = currentColumn.ringsFeet[0]!,
      column =
        raw.length > 3 && same(raw[0]!, raw.at(-1)!) ? raw.slice(0, -1) : raw;
    if (
      column.length < 3 ||
      column.length > 128 ||
      column.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))
    )
      throw Error("Unsupported original native column outline");
    if (!simpleColumn(column))
      throw Error("Original native column outline is not simple");
    const [a, b] = proof.sourceCapFeet,
      width = DMath.hypot(b[0] - a[0], b[1] - a[1]),
      origin: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (width < 0.05 || width > 6)
      throw Error("Unsupported original full wall-cap width");
    const v: Point = [(b[0] - a[0]) / width, (b[1] - a[1]) / width],
      u: Point = [-v[1], v[0]],
      oldEnd: Point = [
        (proof.targetContactFeet[0][0] + proof.targetContactFeet[1][0]) / 2,
        (proof.targetContactFeet[0][1] + proof.targetContactFeet[1][1]) / 2,
      ];
    if ((oldEnd[0] - origin[0]) * u[0] + (oldEnd[1] - origin[1]) * u[1] < 0) {
      u[0] = -u[0];
      u[1] = -u[1];
    }
    const project = (p: Point): Point => [
      (p[0] - origin[0]) * u[0] + (p[1] - origin[1]) * u[1],
      (p[0] - origin[0]) * v[0] + (p[1] - origin[1]) * v[1],
    ];
    const projected = column.map(project);
    type Hit = { edge: number; t: number; point: Point; depth: number };
    const hits = (lateral: number): Hit[] =>
      column.flatMap((point, edge) => {
        const next = column[(edge + 1) % column.length]!,
          p = projected[edge]!,
          q = projected[(edge + 1) % column.length]!;
        if (Math.abs(q[1] - p[1]) < 1e-14) return [];
        const t = (lateral - p[1]) / (q[1] - p[1]);
        if (t < 0 || t > 1) return [];
        const depth = p[0] + t * (q[0] - p[0]);
        if (depth <= 0 || depth > 20) return [];
        return [
          {
            edge,
            t,
            depth,
            point: [
              point[0] + t * (next[0] - point[0]),
              point[1] + t * (next[1] - point[1]),
            ] as Point,
          },
        ];
      });
    const starts = hits(-width / 2),
      ends = hits(width / 2),
      accepted: NativeBoundaryPatch[] = [];
    const overlap = 0.0002;
    for (const start of starts)
      for (const end of ends)
        for (const step of [1, -1]) {
          const path: Point[] = [start.point];
          let index =
            step === 1 ? (start.edge + 1) % column.length : start.edge;
          const stop = step === 1 ? end.edge : (end.edge + 1) % column.length;
          if (start.edge !== end.edge) {
            let bounded = 0;
            while (true) {
              path.push(column[index]!);
              if (index === stop) break;
              index = (index + step + column.length) % column.length;
              if (++bounded > column.length) break;
            }
            if (bounded > column.length) continue;
          } else if (step === -1) continue;
          path.push(end.point);
          const chain = path.filter(
            (p, i) => i === 0 || !same(p, path[i - 1]!),
          );
          if (chain.length < 2) continue;
          const middle = Math.max(
            0,
            ...chain.slice(1, -1).map((p) => -project(p)[0]),
          );
          if (middle > 0.00025) continue;
          const far = chain.map(
              (p): Point => [p[0] + u[0] * overlap, p[1] + u[1] * overlap],
            ),
            startA: Point = [a[0] - u[0] * overlap, a[1] - u[1] * overlap],
            startB: Point = [b[0] - u[0] * overlap, b[1] - u[1] * overlap];
          const next: NativeBoundaryPatch = {
            ...structuredClone(original),
            id: `${original.id}:${sourceRebind ? "native-column-current-cap-chain-v1" : "native-column-chain-v1"}`,
            status: "proposed",
            widthFeet: Math.max(start.depth, end.depth),
            ringsFeet: [[startA, startB, ...far.slice().reverse()]],
            wallEvidence: [
              structuredClone(source),
              {
                nativeElementId: currentColumn.nativeElementId,
                kind: "column",
                ringsFeet: structuredClone(currentColumn.ringsFeet),
              },
            ],
            continuationProof: {
              sourceWallId: proof.sourceWallId,
              sourceCapFeet: structuredClone(proof.sourceCapFeet),
              targetContactFeet: [chain[0]!, chain.at(-1)!],
              ...(chain.length > 2 ? { targetContactPathFeet: chain } : {}),
              ...(middle > 0
                ? { originalCapMiddlePenetrationFeet: middle }
                : {}),
              evidenceSha256: digest({
                format: "native-column-cap-chain-proposal-v1",
                originalPatchSha256: before,
                currentColumn,
                chain,
                overlap,
              }),
            },
            notes: `Supersession proposal for ${original.id}. Preserve the complete old record in source history. ${sourceRebind ? "Bind the new full cap/axis to a complete exact current original native wall section; preserve the complete original wall body evidence and bind the selected current section separately." : "Preserve the original full cap/axis and wall evidence."} Follow consecutive current original native column faces across the full wall width; retain every intervening original vertex and all notches. Contact overlap ${overlap} ft. Actual source floor/holes, physical doors/apertures, exclusions and every nearer foreign first surface must pass before source application. Original review: ${original.notes}`,
          };
          if (!validNativeContinuation(next)) continue;
          try {
            validateNativeBoundaryPatches(
              { version: 1, patches: [next] },
              original.sourceModelSha256,
            );
          } catch {
            continue;
          }
          if (
            !accepted.some(
              (p) => digest(p.ringsFeet) === digest(next.ringsFeet),
            )
          )
            accepted.push(next);
        }
    if (!accepted.length)
      throw Error(
        "No consecutive simple locally convex first-contact native column chain passes the unchanged full-width validator",
      );
    accepted.sort(
      (a, b) =>
        a.widthFeet - b.widthFeet ||
        (JSON.stringify(a.ringsFeet) < JSON.stringify(b.ringsFeet)
          ? -1
          : JSON.stringify(a.ringsFeet) > JSON.stringify(b.ringsFeet)
            ? 1
            : 0),
    );
    const replacement = accepted[0]!;
    if (digest(original) !== before)
      throw Error("Original source recipe mutated");
    return {
      ok: true as const,
      kind: sourceRebind
        ? ("native-column-cap-current-source" as const)
        : ("native-column-cap" as const),
      oldPatchId: original.id,
      oldPatchSha256: before,
      sourceWallId: proof.sourceWallId,
      targetNativeElementId: currentColumn.nativeElementId,
      replacementPatches: [replacement],
      completeOldRecipe: structuredClone(original),
      checks: {
        unchangedFullSourceCapAndAxis: !sourceRebind,
        unchangedFullSourceWallEvidence: true as const,
        explicitCurrentSourceCapRecipe: !!sourceRebind,
        completeCurrentColumnEvidence: true as const,
        existingNativeContinuationValidator: true as const,
        fullWidthFirstContact: true as const,
        consecutiveOriginalColumnVertices: true as const,
        originalColumnUnchanged: true as const,
        originalRecipeUnchanged: true as const,
      },
      physicalApproval: false as const,
      remainingRequiredGuards: [
        "actual-original-native-floor-and-holes",
        "all-original-doors-and-apertures",
        "all-exclusions",
        "every-native-owner-first-surface-shadow",
        "combined-current-contacts-and-historical-binding",
      ],
    };
  } catch (e) {
    return {
      ok: false as const,
      oldPatchId: original.id,
      blockers: [e instanceof Error ? e.message : String(e)],
      physicalApproval: false as const,
    };
  }
}

export function proposeNativeColumnCapSupersession(
  original: NativeBoundaryPatch,
  currentColumn: NativeColumn,
) {
  return buildNativeColumnCapSupersessionShape(original, currentColumn);
}

/** Explicit source-cap supersession proposal. The old cap is only a locator;
 * it is never declared equivalent by a tolerance. The new cap must be a full
 * consecutive exposed edge of the complete current original source material.
 * The atomic consumer must independently rederive these operands from the
 * source/model/cache binding and rerun every physical guard. */
export function proposeNativeColumnSourceCapSupersession(
  original: NativeBoundaryPatch,
  currentColumn: NativeColumn,
  currentSourceSections: readonly NativeColumn[],
) {
  try {
    const proof = original.continuationProof;
    if (!proof || !currentSourceSections.length)
      throw Error("Complete current original native source sections required");
    const oldSource = original.wallEvidence.find(
      (w) => w.nativeElementId === proof.sourceWallId,
    );
    if (!oldSource || oldSource.ringsFeet.length !== 1)
      throw Error("The complete original source-cap recipe is required");
    const [oldA, oldB] = proof.sourceCapFeet;
    const oldRing = oldSource.ringsFeet[0]!;
    if (
      !oldRing.some((a, i) => {
        const b = oldRing[(i + 1) % oldRing.length]!;
        return (
          (same(a, oldA) && same(b, oldB)) || (same(a, oldB) && same(b, oldA))
        );
      })
    )
      throw Error("Original cap is not a complete original source edge");
    for (const w of currentSourceSections) {
      if (
        w.nativeElementId !== proof.sourceWallId ||
        w.levelId !== original.levelId ||
        w.kind === "column" ||
        w.approximate ||
        w.reviewPatchId ||
        w.geometrySource !== "original-native-material-section" ||
        w.ringsFeet.length !== 1 ||
        w.ringsFeet[0]!.some(
          (p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)),
        ) ||
        !simpleColumn(w.ringsFeet[0]!)
      )
        throw Error(
          "Complete same-owner original physical source sections required",
        );
    }
    const minus = (a: Rational, b: Rational) =>
        new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
      plus = (a: Rational, b: Rational) =>
        new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
      times = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d),
      compare = (a: Rational, b: Rational) => {
        const d = a.n * b.d - b.n * a.d;
        return d < 0n ? -1 : d > 0n ? 1 : 0;
      },
      turn = (a: Point, b: Point, c: Point) =>
        minus(
          times(
            minus(rational(b[0]), rational(a[0])),
            minus(rational(c[1]), rational(a[1])),
          ),
          times(
            minus(rational(b[1]), rational(a[1])),
            minus(rational(c[0]), rational(a[0])),
          ),
        ).n,
      squared = (a: Point, b: Point) => {
        const x = minus(rational(a[0]), rational(b[0])),
          y = minus(rational(a[1]), rational(b[1]));
        return plus(times(x, x), times(y, y));
      },
      distance = (a: Point, b: Point) =>
        plus(squared(a, oldA), squared(b, oldB));
    const target = proof.targetContactFeet[0],
      vertices = currentSourceSections.flatMap((w) => w.ringsFeet[0]!);
    const candidates: {
      a: Point;
      b: Point;
      section: NativeColumn;
      distance: Rational;
    }[] = [];
    for (const section of currentSourceSections) {
      const ring = section.ringsFeet[0]!;
      for (let i = 0; i < ring.length; i++) {
        let a = ring[i]!,
          b = ring[(i + 1) % ring.length]!;
        if (compare(distance(b, a), distance(a, b)) < 0) [a, b] = [b, a];
        const outward = turn(a, b, target);
        if (
          outward === 0n ||
          vertices.some((p) => turn(a, b, p) * outward > 0n)
        )
          continue;
        candidates.push({ a, b, section, distance: distance(a, b) });
      }
    }
    candidates.sort((a, b) => compare(a.distance, b.distance));
    const chosen = candidates[0];
    if (
      !chosen ||
      (candidates[1] && compare(chosen.distance, candidates[1].distance) === 0)
    )
      throw Error(
        "No unique complete exposed current source cap can be derived",
      );
    const sourceCapFeet: [Point, Point] = [
        structuredClone(chosen.a),
        structuredClone(chosen.b),
      ],
      currentSourceEvidence = {
        nativeElementId: proof.sourceWallId,
        ringsFeet: structuredClone(chosen.section.ringsFeet),
      },
      result = buildNativeColumnCapSupersessionShape(original, currentColumn, {
        sourceCapFeet,
        originalSourceEvidence: oldSource,
      });
    if (!result.ok) return result;
    return {
      ...result,
      kind: "native-column-cap-current-source" as const,
      originalSourceCapFeet: structuredClone(proof.sourceCapFeet),
      currentSourceCapFeet: sourceCapFeet,
      completeCurrentSourceSections: structuredClone(currentSourceSections),
      sourceCapReview: {
        originalSourceCapFeet: structuredClone(proof.sourceCapFeet),
        originalSourceEvidenceSha256: digest(oldSource),
        currentSourceSectionsSha256: digest(
          currentSourceSections.map((w) => w.ringsFeet),
        ),
        currentSourcePartSha256: digest(currentSourceEvidence.ringsFeet),
        currentSourceCapFeet: sourceCapFeet,
      },
      sourceCapDerivation: {
        originalCapIsCompleteOriginalEdge: true as const,
        currentCapIsCompleteConsecutiveOriginalSourceEdge: true as const,
        exactWholeSourceInwardHalfplane: true as const,
        sourceCapChosenByUniqueExactEndpointLocator: true as const,
        endpointLocatorGrantsNoEquivalenceOrPhysicalAuthority: true as const,
        noToleranceEquivalenceClaimed: true as const,
        endpointLocatorSquaredDistance: {
          n: chosen.distance.n.toString(),
          d: chosen.distance.d.toString(),
        },
        sourceCapMaximumEndpointDisplacementFeet: Math.max(
          DMath.hypot(chosen.a[0] - oldA[0], chosen.a[1] - oldA[1]),
          DMath.hypot(chosen.b[0] - oldB[0], chosen.b[1] - oldB[1]),
        ),
      },
    };
  } catch (e) {
    return {
      ok: false as const,
      oldPatchId: original.id,
      blockers: [e instanceof Error ? e.message : String(e)],
      physicalApproval: false as const,
    };
  }
}
