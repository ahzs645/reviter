import type { IndoorDataset } from "./indoor-contract.ts";
import type { ConvertResult } from "./types.ts";
import type { ReportedBuildingTransition } from "./building-transitions.ts";
import { nativeFloorPolygons } from "./routing-floor-support.ts";
import { createNativeExactRoutingAuthority } from "./native-exact-routing-authority.ts";
import { nativeRationalFootprintSupported } from "./native-exact-planar-topology.ts";
import {
  rational,
  nativeRationalOverlay,
  type NativeRationalParts,
  type NativeRationalOverlayInput,
} from "./native-rational-overlay.ts";
import {
  nativeSourceNonPhysicalElementIds,
  nativeSourceInstantiatedElementIds,
  nativeSourcePlanarComponentEnvelopes,
} from "./native-material-source.ts";
import { reviewedDrawingReferenceElementIds } from "./reviewed-drawing-reference-source.ts";
import {
  originalPlanarObstacleFacts,
  type OriginalPlanarObstacleCertificate,
} from "./native-source-placed-planar-obstacles.ts";
import { exactClosedSourcePlanarContact } from "./native-source-planar-slab-envelope.ts";
import { NON_MODEL_CATEGORY_IDS } from "./model-elements.ts";

type P3 = [number, number, number];
type Input = {
  transition: ReportedBuildingTransition;
  ramp: {
    id: string;
    nativeRampId: number;
    floorElementIds: [number, number];
    pointsFeet: P3[];
  };
  review: {
    accessible?: string;
    enabled?: boolean;
    notes?: string;
    geometryKey?: string;
  };
};

/** Read-only candidate proof for an original reviewed flat approach whose
 * source local-stair landing identity was omitted. No node, room, edge, source
 * ownership or accessibility is changed here. The stair flight remains subject
 * to its independent body/terminal/material qualification.
 *
 * Original source bounding boxes are conservative headroom material. This may
 * reject a clear-looking passage until its original physical representation is
 * recovered. A rendered outline or old cached region cannot waive that veto. */
export function proveReviewedFlatLanding(
  model: ConvertResult,
  data: IndoorDataset,
  input: Input,
  originalObstacleCertificates: readonly OriginalPlanarObstacleCertificate[] = [],
) {
  const reject = (reason: string, blockers: number[] = []) => ({
    ok: false as const,
    reason,
    blockers,
  });
  const { transition, ramp, review } = input;
  if (review.accessible !== "yes" || !review.notes?.trim())
    return reject("No original explicit positive approach review.");
  let saved: unknown;
  try {
    saved = JSON.parse(review.geometryKey ?? "");
  } catch {
    return reject("Malformed original review key.");
  }
  if (
    !Array.isArray(saved) ||
    saved.length !== 5 ||
    saved[0] !== data.source.modelSha256
  )
    return reject("Original review model binding is stale.");
  const [_, from, to, roomKeys, path] = saved as [
    string,
    string,
    string,
    string[],
    P3[],
  ];
  if (
    !Array.isArray(path) ||
    path.length < 2 ||
    path.length > 1000 ||
    path.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 3 ||
        p.some((v) => !Number.isFinite(v)),
    ) ||
    !Array.isArray(roomKeys)
  )
    return reject("Malformed original reviewed path.");
  const side = [0, 1].find(
    (i) =>
      to === `local:${transition.id}:${i}` &&
      roomKeys.length === 1 &&
      roomKeys[0] === `landing:${transition.id}:${i}`,
  );
  const rampSide = [0, 1].find(
    (i) => from === `${ramp.id}:${i ? "upper" : "lower"}`,
  );
  if (
    side === undefined ||
    rampSide === undefined ||
    transition.kind !== "local-steps" ||
    transition.evidence !== "user-reported" ||
    transition.endpoints[side]!.roomKey ||
    !model.nativeStairAssemblies?.some(
      (a) => a.stairElementId === transition.nativeStairId,
    )
  )
    return reject(
      "Missing original transition-owned unnamed landing identity.",
    );
  const endpoint = transition.endpoints[side]!,
    point = path.at(-1)!,
    z = point[2];
  const existingNode = data.nodes.find((node) => node.id === to);
  if (
    existingNode &&
    (existingNode.roomKey !== roomKeys[0] ||
      existingNode.levelId !== endpoint.levelId ||
      JSON.stringify(existingNode.pointFeet) !== JSON.stringify(point))
  )
    return reject(
      "The original node ID now belongs to a different current source identity or terminal.",
    );
  const nativeFloorId = transition.floorElementIds[side]!;
  const floor = model.elementBounds.find((e) => e.elementId === nativeFloorId);
  const rampBody = model.elementBounds.find(
    (e) => e.elementId === ramp.nativeRampId,
  );
  const rampEndpoint = rampSide ? ramp.pointsFeet.at(-1) : ramp.pointsFeet[0];
  if (
    !floor ||
    floor.categoryId !== -2000032 ||
    rampBody?.categoryId !== -2000180 ||
    nativeFloorId !== ramp.floorElementIds[rampSide] ||
    !rampEndpoint ||
    JSON.stringify(path[0]) !== JSON.stringify(rampEndpoint) ||
    path.some((p) => p[2] !== z) ||
    Math.abs(z - floor.boundsFeet.max.z) > 0.002 ||
    !data.nativeLevels.some(
      (level) =>
        level.id === endpoint.levelId &&
        Math.abs(level.elevationFeet - z) < 0.002,
    ) ||
    Math.hypot(point[0] - endpoint.point[0], point[1] - endpoint.point[1]) > 0.6
  )
    return reject(
      "Original ramp/landing floor, height or bounded source endpoint no longer matches.",
    );
  const strips: NativeRationalOverlayInput[] = [];
  path.slice(1).forEach((b, i) => {
    const a = path[i]!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy);
    if (!length) return;
    const nx = -dy / length,
      ny = dx / length;
    strips.push([
      [
        [
          [a[0] + nx, a[1] + ny],
          [b[0] + nx, b[1] + ny],
          [b[0] - nx, b[1] - ny],
          [a[0] - nx, a[1] - ny],
        ],
      ],
    ]);
  });
  const cap: NativeRationalOverlayInput = [
    [
      [
        [point[0] - 1, point[1] - 1],
        [point[0] + 1, point[1] - 1],
        [point[0] + 1, point[1] + 1],
        [point[0] - 1, point[1] + 1],
      ],
    ],
  ];
  const scope = nativeRationalOverlay("union", cap, ...strips);
  const floorParts = nativeRationalOverlay(
    "union",
    nativeFloorPolygons(floor, true),
  );
  if (!nativeRationalFootprintSupported(scope, floorParts))
    return reject(
      "Original named slab/holes do not support the complete two-foot approach and standing cap.",
    );
  for (const record of data.records) {
    if (
      Math.abs(record.elevationFeet - z) > 0.002 ||
      record.key === roomKeys[0] ||
      (record.walkable && record.access !== "staff" && record.circulation) ||
      !record.ringsFeet?.length
    )
      continue;
    if (nativeRationalOverlay("intersection", scope, [record.ringsFeet]).length)
      return reject(
        `A protected or independently owned source record intersects the original flat approach: ${record.key}`,
      );
  }
  // The original named slab must also survive in the portable physical facts.
  // Keep the complete original dataset for material/repair validation: globally
  // source-bound patches may depend on other slabs even for this local query.
  const support = data.walkingSupport;
  const namedFloors = support?.floors.filter(
    (candidate) => candidate.nativeElementId === nativeFloorId,
  );
  if (
    !support ||
    support.sourceModelSha256 !== data.source.modelSha256 ||
    !namedFloors?.length
  )
    return reject(
      "The original named walking-support slab is absent or stale.",
    );
  const nonPhysical = nativeSourceNonPhysicalElementIds(
    model,
    data.source.modelSha256,
  );
  for (const id of reviewedDrawingReferenceElementIds(
    model,
    data.reviewedDrawingReferences,
    data.source.modelSha256,
  ))
    nonPhysical.add(id);
  const instantiated = nativeSourceInstantiatedElementIds(
    model,
    data.source.modelSha256,
  );
  const components = nativeSourcePlanarComponentEnvelopes(
    model,
    data.source.modelSha256,
  );
  const xs = path.map((p) => p[0]),
    ys = path.map((p) => p[1]),
    box = [
      Math.min(...xs) - 1,
      Math.min(...ys) - 1,
      Math.max(...xs) + 1,
      Math.max(...ys) + 1,
    ];
  const originalObstacles = new Map<
    number,
    ReturnType<typeof originalPlanarObstacleFacts>
  >();
  try {
    for (const certificate of originalObstacleCertificates) {
      const fact = originalPlanarObstacleFacts(certificate),
        matches = model.elementBounds.filter(
          (r) => r.elementId === fact.nativeElementId,
        ),
        r = matches[0],
        bounds = fact.sourceFacts.originalWorldBoundsFeet;
      if (
        fact.sourceModelSha256 !== data.source.modelSha256 ||
        originalObstacles.has(fact.nativeElementId) ||
        matches.length !== 1 ||
        r?.categoryId !== fact.sourceFacts.nativeCategoryId ||
        !bounds.valid ||
        JSON.stringify([
          r.boundsFeet.min.x,
          r.boundsFeet.min.y,
          r.boundsFeet.min.z,
        ]) !== JSON.stringify(bounds.minimum) ||
        JSON.stringify([
          r.boundsFeet.max.x,
          r.boundsFeet.max.y,
          r.boundsFeet.max.z,
        ]) !== JSON.stringify(bounds.maximum)
      )
        return reject(
          "Original material certificate is stale, duplicated or belongs to a changed owner.",
          [fact.nativeElementId],
        );
      originalObstacles.set(fact.nativeElementId, fact);
    }
  } catch {
    return reject("Unregistered original source material certificate.");
  }
  const blockers: number[] = [],
    checkedSourceIds: number[] = [];
  for (const record of model.elementBounds) {
    if (
      nonPhysical.has(record.elementId) ||
      (NON_MODEL_CATEGORY_IDS.has(record.categoryId ?? 0) &&
        !instantiated.has(record.elementId))
    )
      continue;
    const original = originalObstacles.get(record.elementId);
    if (original) {
      checkedSourceIds.push(record.elementId);
      const bottom = rational(z),
        top = rational(z + 6);
      if (
        original.components.some(
          (c) =>
            c.maximumElevationFeet.n * bottom.d >
              bottom.n * c.maximumElevationFeet.d &&
            c.minimumElevationFeet.n * top.d <=
              top.n * c.minimumElevationFeet.d &&
            exactClosedSourcePlanarContact(scope, c.outerPlanEnvelope),
        )
      )
        blockers.push(record.elementId);
      continue;
    }
    const boxes = components.get(record.elementId) ?? [record.boundsFeet];
    let checked = false,
      blocked = false;
    for (const bounds of boxes) {
      if (
        !bounds ||
        [...Object.values(bounds.min), ...Object.values(bounds.max)].some(
          (v) => !Number.isFinite(v),
        ) ||
        ["x", "y", "z"].some((axis) => {
          const k = axis as "x" | "y" | "z";
          return bounds.min[k] > bounds.max[k];
        })
      )
        return reject(
          "Unclassified original source body bounds remain unresolved.",
          [record.elementId],
        );
      if (
        bounds.max.z <= z ||
        bounds.min.z > z + 6 ||
        bounds.max.x < box[0]! ||
        bounds.min.x > box[2]! ||
        bounds.max.y < box[1]! ||
        bounds.min.y > box[3]!
      )
        continue;
      checked = true;
      if (bounds.max.x <= bounds.min.x || bounds.max.y <= bounds.min.y) {
        blocked = true;
        continue;
      }
      const material = nativeRationalOverlay("union", [
        [
          [
            [bounds.min.x, bounds.min.y],
            [bounds.max.x, bounds.min.y],
            [bounds.max.x, bounds.max.y],
            [bounds.min.x, bounds.max.y],
          ],
        ],
      ]);
      if (exactClosedSourcePlanarContact(scope, material)) blocked = true;
    }
    if (checked) checkedSourceIds.push(record.elementId);
    if (blocked) blockers.push(record.elementId);
  }
  if (blockers.length)
    return reject(
      "Original foreign body bounds intersect the full two-foot/six-foot-height walking body; no coarse material is waived.",
      blockers.sort((a, b) => a - b),
    );
  const allowed = createNativeExactRoutingAuthority(data)(z, scope);
  if (!nativeRationalFootprintSupported(scope, allowed))
    return reject(
      "Current exact floor, material, doors, stairs, envelope or protected-area veto intersects the approach.",
    );
  return {
    ok: true as const,
    sourceModelSha256: data.source.modelSha256,
    originalGeometryKey: review.geometryKey!,
    nodeId: to,
    roomKey: roomKeys[0]!,
    pointFeet: structuredClone(point),
    levelId: endpoint.levelId,
    building: endpoint.building,
    nativeFloorId,
    nativeStairId: transition.nativeStairId,
    originalApproachPath: structuredClone(path),
    originalSourceObstacleElementIds: [...originalObstacles.keys()].sort(
      (a, b) => a - b,
    ),
    checkedSourceElementIds: checkedSourceIds.sort((a, b) => a - b),
    scope: scope as NativeRationalParts,
    limitations:
      "Flat original-identity proposal only; does not enable stairs or approve any adjoining door, corridor, lift or new wheelchair passage.",
  };
}

/** Unwired late compiler operation: reconstruct only an explicitly source-owned
 * original flat terminal after local-flight qualification. The old review is
 * kept as provenance; different current approach owners cannot inherit its yes.
 * Complete physical replay happens immediately before any graph mutation. */
export function preserveSourceReviewedFlatLanding(
  model: ConvertResult,
  data: IndoorDataset,
  input: Input,
  originalObstacleCertificates: readonly OriginalPlanarObstacleCertificate[],
  geographic: (point: [number, number]) => [number, number],
) {
  const proof = proveReviewedFlatLanding(
    model,
    data,
    input,
    originalObstacleCertificates,
  );
  const refuse = (reason: string) => ({
    applied: false as const,
    reason,
    proof,
  });
  if (!proof.ok) return refuse(proof.reason);
  const saved = JSON.parse(proof.originalGeometryKey) as [
      string,
      string,
      string,
      string[],
      P3[],
    ],
    from = data.nodes.filter((n) => n.id === saved[1]);
  if (
    from.length !== 1 ||
    from[0]!.levelId !== proof.levelId ||
    JSON.stringify(from[0]!.pointFeet) !==
      JSON.stringify(proof.originalApproachPath[0])
  )
    return refuse(
      "The actual current ramp endpoint does not retain the original reviewed XYZ/native level.",
    );
  const owner = data.records.find((r) => r.key === from[0]!.roomKey);
  if (
    !owner?.walkable ||
    owner.access === "staff" ||
    owner.levelId !== proof.levelId
  )
    return refuse(
      "The actual ramp owner is missing, nonwalkable or restricted.",
    );
  if (
    data.nodes.some((n) => n.id === proof.nodeId) ||
    data.records.some((r) => r.key === proof.roomKey)
  )
    return refuse(
      "An existing local terminal/owner must not be overwritten or suppress a qualified vertical flight.",
    );
  const side = saved[1].endsWith(":upper") ? "upper" : "lower",
    edgeId = `walk:${input.ramp.id}:${side}`;
  if (data.edges.some((e) => e.id === edgeId))
    return refuse("An existing approach must not be replaced.");
  const point = proof.pointFeet,
    [x, y, z] = point,
    geo = geographic([x, y]);
  if (geo.length !== 2 || !geo.every(Number.isFinite))
    return refuse("Invalid geographic terminal projection.");
  const surfaceId = `${proof.building}:${proof.levelId}:${z.toFixed(3)}`;
  const record: IndoorDataset["records"][number] = {
    key: proof.roomKey,
    number: "",
    name: "Native flat landing",
    building: proof.building,
    levelId: proof.levelId,
    elevationFeet: z,
    elevationEvidence: `Original source slab #${proof.nativeFloorId}; exact original local-stair flat terminal`,
    surfaceId,
    circulation: true,
    stair: false,
    access: "unknown",
    walkable: true,
    confidence: 1,
    ringsFeet: [
      [
        [x - 1, y - 1],
        [x + 1, y - 1],
        [x + 1, y + 1],
        [x - 1, y + 1],
      ],
    ],
    properties: {
      nativeFloorId: proof.nativeFloorId,
      nativeStairId: proof.nativeStairId,
      generatedLanding: true,
      flatOnly: true,
      originalReviewGeometryKey: proof.originalGeometryKey,
    },
  };
  const node: IndoorDataset["nodes"][number] = {
    id: proof.nodeId,
    roomKey: record.key,
    kind: "stair",
    levelId: proof.levelId,
    building: proof.building,
    surfaceId,
    pointFeet: [...point],
    geographic: [...geo],
  };
  const edge: IndoorDataset["edges"][number] = {
    id: edgeId,
    from: from[0]!.id,
    to: node.id,
    kind: from[0]!.surfaceId === node.surfaceId ? "walk" : "opening",
    pointsFeet: structuredClone(proof.originalApproachPath),
    lengthMetres: proof.originalApproachPath
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum +
          Math.hypot(
            ...p.map((v, k) => v - proof.originalApproachPath[i]![k]!),
          ) *
            0.3048,
        0,
      ),
    roomKeys: [from[0]!.roomKey, node.roomKey],
    nativeElementId: input.ramp.nativeRampId,
    enabled: input.review.enabled !== false,
    accessible: "unknown",
    evidence:
      "Original source-owned flat local-stair landing and exact original ramp approach; complete2ft support and6ft foreign-material replay; vertical flight remains independently held; original access review is not transferred to changed current owners",
    notes: input.review.notes,
  };
  data.records.push(record);
  data.nodes.push(node);
  data.edges.push(edge);
  return {
    applied: true as const,
    proof,
    record,
    node,
    edge,
    restoredAccessibilityReview: false as const,
  };
}
