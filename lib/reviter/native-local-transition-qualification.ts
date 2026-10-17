import { reviewedDrawingReferenceElementIds } from "./reviewed-drawing-reference-source.ts";
import * as DMath from "./deterministic-math.ts";
import pc from "polygon-clipping";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { prepareNativeSourceStairReceipts, nativeStairInventoryReconciliation } from "./native-source-stair-receipts.ts";
import { nativeSourceStairMaterialHash, nativeSourceStairPlacementHash, type NativeSourceStairMaterial } from "./native-source-stair-material.ts";
import { nativeSourceStairBodyHash, type NativeSourceStairBody } from "./native-source-stair-body.ts";
import { validNativeSourceStairBinding } from "./native-source-stair.ts";
import type { ReportedBuildingTransition } from "./building-transitions.ts";
import type { IndoorDataset, IndoorEdge, IndoorNode } from "./indoor-contract.ts";
import type { ConvertResult } from "./types.ts";
import { NON_MODEL_CATEGORY_IDS } from "./model-elements.ts";
import { nativeStairLandings } from "./indoor-stair-landings.ts";
import { nativeSourceInstantiatedElementIds, nativeSourceNonPhysicalElementIds, nativeSourcePlanarComponentEnvelopes, nativeStairMaterialContainerCoverage } from "./native-material-source.ts";

type P2 = [number, number];
type P3 = [number, number, number];
const values = (a: unknown): number[] =>
  Array.isArray(a) ? a : ArrayBuffer.isView(a) ? Array.from(a as unknown as ArrayLike<number>) : a && typeof a === "object" ? Object.values(a as Record<string, number>) : [];
const hash = (v: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(v))));
const ringArea = (r: P2[]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

/** A native finish can belong to the walking body only through its original
 * ownership declaration and a compatible original run/landing extent. A nearby
 * finish or matching bounds alone cannot establish ownership. */
export function nativeStairOwnedBodyElementIds(
  model: ConvertResult,
  receipt: { nativeStairId: number; nativeRunIds: number[]; landings?: NativeSourceStairBody["landings"] },
  own: readonly number[],
): number[] {
  const elements = new Map(model.elementBounds.map((r) => [r.elementId, r]));
  const declarations = new Map<number, Set<number | null>>();
  for (const r of model.elementOwnership?.records ?? []) {
    const previous = declarations.get(r.elementId) ?? new Set<number | null>();
    previous.add(r.owningElementId);
    declarations.set(r.elementId, previous);
  }
  const original = own.filter((id) => elements.get(id)?.categoryId !== -2000921);
  if (receipt.landings?.length) {
    const native = nativeStairLandings(model).get(receipt.nativeStairId) ?? [];
    const sameRing = (a: P2[], b: P2[]) => {
      const open = (r: P2[]) => r.length > 1 && r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1] ? r.slice(0, -1) : r;
      a = open(a); b = open(b);
      return a.length === b.length && a.length > 0 && b.some((_, start) => [1, -1].some((direction) =>
        a.every((point, i) => { const q = b[(start + direction * i + b.length) % b.length]!; return point[0] === q[0] && point[1] === q[1]; }),
      ));
    };
    for (const landing of receipt.landings) {
      const declared = declarations.get(landing.nativeElementId);
      if (!declared || declared.size !== 1 || !declared.has(receipt.nativeStairId)) continue;
      if (native.some((n) => n.nativeElementId === landing.nativeElementId && n.elevationFeet === landing.elevationFeet &&
        (landing.thicknessFeet === undefined || n.thicknessFeet === landing.thicknessFeet) &&
        n.ringsFeet.length === landing.ringsFeet.length && n.ringsFeet.every((ring, i) => sameRing(ring, landing.ringsFeet[i]!)))) original.push(landing.nativeElementId);
    }
  }
  const owners = new Set([receipt.nativeStairId, ...receipt.nativeRunIds, ...original]);
  const physicalBodies = [...new Set([...receipt.nativeRunIds, ...original])]
    .map((id) => elements.get(id))
    .filter((r) => r?.categoryId === -2000919 || r?.categoryId === -2000920);
  const finishes = model.elementBounds.filter((r) => {
    if (r.categoryId !== -2000921) return false;
    const declared = declarations.get(r.elementId);
    if (!declared || declared.size !== 1 || !owners.has([...declared][0]!)) return false;
    return physicalBodies.some((body) => (["x", "y", "z"] as const).every((axis) =>
      r.boundsFeet.min[axis] >= body!.boundsFeet.min[axis] &&
      r.boundsFeet.max[axis] <= body!.boundsFeet.max[axis],
    ));
  });
  return [...new Set([...original, ...finishes.map((r) => r.elementId)])];
}

/** Original native mesh triangles of the given elements, in model feet. */
function elementTriangles(model: ConvertResult, ids: ReadonlySet<number>): Map<number, P3[][]> {
  const out = new Map<number, P3[][]>();
  if (!model.origin) return out;
  for (const mesh of model.meshes ?? []) {
    if (!mesh.elementIds) continue;
    const owners = values(mesh.elementIds);
    if (!owners.some((id) => ids.has(id))) continue;
    const p = values(mesh.positions), ix = values(mesh.indices);
    for (let i = 0; i < owners.length; i++) {
      const id = owners[i]!;
      if (!ids.has(id)) continue;
      const t = [0, 1, 2].map((k) => { const j = ix[i * 3 + k]!; return [p[j * 3]! + model.origin.x, p[j * 3 + 1]! + model.origin.y, p[j * 3 + 2]! + model.origin.z] as P3; });
      if (t.some((q) => !q.every(Number.isFinite))) continue;
      const list = out.get(id);
      if (list) list.push(t);
      else out.set(id, [t]);
    }
  }
  return out;
}

/** Complete foreign-material census of a flight's 2-ft walking path. Every
 * original element whose body reaches into a segment's height band (above its
 * own walking surface) is listed. A meshed element contributes the plan
 * projection of all its triangles (conservative: its whole footprint); a
 * physical element without a mesh contributes its full plan bounds; helper
 * lines contribute nothing. The flight's own runs, the stair element and the
 * two terminal slabs it lands on are the walking body, not foreign material. */
export function prepareNativeLocalStairMaterial(
  model: ConvertResult,
  data: IndoorDataset,
  receipt: { nativeStairId: number; nativeRunIds: number[]; nativeFloorElementIds: [number, number]; pointsFeet: P3[]; landings?: NativeSourceStairBody["landings"] },
  own: readonly number[],
): NativeSourceStairMaterial {
  const points = receipt.pointsFeet;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]), zs = points.map((p) => p[2]);
  const box = [Math.min(...xs) - 1.5, Math.min(...ys) - 1.5, Math.max(...xs) + 1.5, Math.max(...ys) + 1.5];
  const low = Math.min(...zs), high = Math.max(...zs) + 0.1;
  const exclude = new Set([receipt.nativeStairId, ...receipt.nativeRunIds, ...receipt.nativeFloorElementIds, ...nativeStairOwnedBodyElementIds(model, receipt, own)]);
  const sourceNonPhysical = nativeSourceNonPhysicalElementIds(model, data.source.modelSha256);
  const reviewedReferences = reviewedDrawingReferenceElementIds(model, data.reviewedDrawingReferences, data.source.modelSha256);
  for (const id of reviewedReferences) sourceNonPhysical.add(id);
  const sourceInstantiated = nativeSourceInstantiatedElementIds(model, data.source.modelSha256);
  const componentEnvelopes = nativeSourcePlanarComponentEnvelopes(model, data.source.modelSha256);
  const broadBounds = (r: ConvertResult["elementBounds"][number]) => {
    const components = componentEnvelopes.get(r.elementId);
    if (!components) return r.boundsFeet;
    const boxes = [r.boundsFeet, ...components];
    return { min: { x: Math.min(...boxes.map((b) => b.min.x)), y: Math.min(...boxes.map((b) => b.min.y)), z: Math.min(...boxes.map((b) => b.min.z)) },
      max: { x: Math.max(...boxes.map((b) => b.max.x)), y: Math.max(...boxes.map((b) => b.max.y)), z: Math.max(...boxes.map((b) => b.max.z)) } };
  };
  const spatialCensus = model.elementBounds.filter((r) =>
    !exclude.has(r.elementId) && r.elementId > 0 && (!NON_MODEL_CATEGORY_IDS.has(r.categoryId ?? 0) || sourceInstantiated.has(r.elementId)) &&
    broadBounds(r).max.x >= box[0]! && broadBounds(r).min.x <= box[2]! && broadBounds(r).max.y >= box[1]! && broadBounds(r).min.y <= box[3]! &&
    broadBounds(r).max.z > low + 0.01 && broadBounds(r).min.z < high);
  const decomposedContainers = new Map<number, number[]>();
  const requiredCarrierBounds = new Map<number, { definitionElementId: number; boundsFeet: ConvertResult["elementBounds"][number]["boundsFeet"]; sourceFrameSha256: string }>();
  for (const record of spatialCensus) {
    if (record.categoryId !== -2000120 || sourceNonPhysical.has(record.elementId)) continue;
    const coverage = nativeStairMaterialContainerCoverage(model, record.elementId, data.source.modelSha256);
    // The helper proves a complete original identity-instance container and
    // usable bounds for every physical child. Each child remains independently
    // subject to this global spatial census; none inherits the parent's omit.
    if (!coverage) continue;
    // A missing definition is represented by its actual complete original
    // instance box. An excluded/filtered carrier reaching this path cannot
    // disappear through the parent's delegation.
    const disjoint = (b: ConvertResult["elementBounds"][number]["boundsFeet"]) =>
      b.max.x < box[0]! || b.min.x > box[2]! || b.max.y < box[1]! || b.min.y > box[3]! || b.max.z <= low + 0.01 || b.min.z >= high;
    if (coverage.requiredCarrierBounds.some((p) => !disjoint(p.boundsFeet) && !spatialCensus.some((r) => r.elementId === p.carrierElementId))) continue;
    decomposedContainers.set(record.elementId, coverage.childElementIds);
    for (const p of coverage.requiredCarrierBounds) requiredCarrierBounds.set(p.carrierElementId, p);
  }
  // A retained envelope carrier can never itself be delegated away by a
  // different wrapper decision in the same census.
  for (const carrier of requiredCarrierBounds.keys()) decomposedContainers.delete(carrier);
  const census = spatialCensus.filter((r) => !sourceNonPhysical.has(r.elementId) && !decomposedContainers.has(r.elementId));
  const triangles = elementTriangles(model, new Set(census.map((r) => r.elementId)));
  const footprint = new Map<number, P2[][][]>();
  for (const r of census) {
    const tris = triangles.get(r.elementId);
    let parts: P2[][][] = [];
    if (tris?.length && !requiredCarrierBounds.has(r.elementId)) {
      const polys = tris.map((t) => t.map((q) => [q[0], q[1]] as P2)).filter((t) => ringArea(t) > 1e-9).map((t) => [[...t, t[0]!]] as pc.Polygon);
      parts = polys.length ? (pc.union(polys[0]!, ...polys.slice(1)) as P2[][][]) : [];
    }
    if (!parts.length && r.categoryId !== undefined && (r.boundsFeet.max.x - r.boundsFeet.min.x) * (r.boundsFeet.max.y - r.boundsFeet.min.y) < 1e7) {
      const b = r.boundsFeet;
      parts = [[[[b.min.x, b.min.y], [b.max.x, b.min.y], [b.max.x, b.max.y], [b.min.x, b.max.y]]]];
    }
    if (parts.length) footprint.set(r.elementId, parts.map((part) => part.map((ring) => (ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring))));
  }
  const sourceElementIds = census.map((r) => r.elementId).sort((a, b) => a - b);
  const bands = points.slice(1).map((b, i) => {
    const a = points[i]!, lo = Math.min(a[2], b[2]), hi = Math.max(a[2], b[2]) + 0.1;
    const active = census.filter((r) => broadBounds(r).max.z > lo + 0.01 && broadBounds(r).min.z < hi);
    const partsAtBand = (id: number): P2[][][] | undefined => {
      // Keep whole source boxes on the original required carrier path. A
      // definition component never certifies its placed wrapper's branches.
      const components = !requiredCarrierBounds.has(id) && componentEnvelopes.get(id);
      if (!components) return footprint.get(id);
      // Closed-band contact is retained. These are enclosing solid component
      // boxes, not face-only clipping that would omit a column's interior.
      return components.filter((b) => b.max.z >= lo && b.min.z <= hi).map((b) =>
        [[[b.min.x, b.min.y], [b.max.x, b.min.y], [b.max.x, b.max.y], [b.min.x, b.max.y]]] as P2[][]);
    };
    const sections = active
      .map((r) => ({ nativeElementId: r.elementId, partsFeet: partsAtBand(r.elementId) }))
      .filter((section): section is { nativeElementId: number; partsFeet: P2[][][] } => !!section.partsFeet?.length)
      .sort((x, y) => x.nativeElementId - y.nativeElementId);
    return { segmentIndex: i, minimumElevationFeet: lo, maximumElevationFeet: hi, unclassifiedSourceElementIds: active.filter((r) => partsAtBand(r.elementId) === undefined).map((r) => r.elementId), sections };
  });
  const value: Omit<NativeSourceStairMaterial, "geometrySha256"> = {
    version: 1, sourceModelSha256: data.source.modelSha256,
    evidenceSha256: hash(["native-local-stair-material-census-v1", ...(data.reviewedDrawingReferences ? [["reviewed-drawing-references-v1", data.reviewedDrawingReferences.geometrySha256]] : []), sourceElementIds, [...exclude].sort((a, b) => a - b), box, low, high,
      ...(spatialCensus.some((r) => sourceNonPhysical.has(r.elementId)) || decomposedContainers.size
        ? [model.nativeMaterialSource?.geometrySha256 ?? null, [...decomposedContainers].sort(([a], [b]) => a - b)] : []),
      ...(requiredCarrierBounds.size ? [["original-foreign-instance-envelopes-v1", [...requiredCarrierBounds].sort(([a], [b]) => a - b)]] : []),
      ...(census.some((r) => componentEnvelopes.has(r.elementId)) ? [["original-planar-component-envelopes-v1", model.nativeMaterialSource?.geometrySha256]] : []),
    ]),
    sourceWallPositionRepairsSha256: nativeSourceStairPlacementHash(data.nativeWallPositionRepairs, data.nativeDerivedFrameReturns, data.nativeProvisionalCornerSeals, data.reviewedDrawingReferences),
    nativeStairId: receipt.nativeStairId, widthFeet: 2, pointsFeet: structuredClone(points), sourceElementIds, bands,
  };
  return { ...value, geometrySha256: nativeSourceStairMaterialHash(value) };
}

/** The flight's complete walking body: its own native tread inventory and
 * landings, bound to the run triangles they were read from. */
export function prepareNativeLocalStairBody(
  model: ConvertResult,
  receipt: { sourceModelSha256: string; nativeStairId: number; nativeRunIds: number[]; treads: NativeSourceStairBody["treads"]; landings: NativeSourceStairBody["landings"] },
): NativeSourceStairBody {
  const tris = elementTriangles(model, new Set(receipt.nativeRunIds));
  const value: Omit<NativeSourceStairBody, "geometrySha256"> = {
    version: 1, sourceModelSha256: receipt.sourceModelSha256,
    evidenceSha256: hash(["native-local-stair-body-v1", receipt.nativeRunIds.map((id) => [id, tris.get(id) ?? []])]),
    nativeStairId: receipt.nativeStairId, nativeRunIds: [...receipt.nativeRunIds], completeOriginalBody: true, unclassifiedSourceElementIds: [],
    treads: structuredClone(receipt.treads), landings: structuredClone(receipt.landings),
  };
  return { ...value, geometrySha256: nativeSourceStairBodyHash(value) };
}

/** Qualify reviewed local-steps recipes (navigation buildingTransitions) as
 * original native stair connectors: one native-source-stair receipt per
 * recipe, its complete foreign-material census and walking body, terminal
 * stair nodes exactly on the receipt's terminal caps, and one local-steps edge
 * that is never step-free. The recipe's two native slabs must be the receipt's
 * terminal slabs. A recipe endpoint room names a node only when that room is
 * on the cap's own native level; otherwise the source-only cap stays unnamed
 * and the native cell that physically contains it attaches it. */
export function qualifyNativeLocalTransitions(
  model: ConvertResult,
  dataset: IndoorDataset,
  transitions: readonly ReportedBuildingTransition[],
  geo: (p: P2) => [number, number],
) {
  const qualified: { transition: ReportedBuildingTransition; edge: IndoorEdge; nodes: IndoorNode[]; reconciliation: ReturnType<typeof nativeStairInventoryReconciliation> }[] = [];
  const refused: { transition: ReportedBuildingTransition; reason: string }[] = [];
  const elements = new Map(model.elementBounds.map((r) => [r.elementId, r]));
  for (const transition of transitions) {
    const fail = (reason: string) => refused.push({ transition, reason });
    if (transition.kind !== "local-steps") { fail("not a local-steps recipe"); continue; }
    const flight = dataset.stairDisplay?.sourceFlights?.find((f) => f.stairElementId === transition.nativeStairId);
    if (!flight) { fail("no prepared native flight inventory for the stair"); continue; }
    const view = { ...dataset, stairDisplay: { ...dataset.stairDisplay!, sourceFlights: [flight] } } as IndoorDataset;
    const prepared = prepareNativeSourceStairReceipts(model, view);
    const receipt = prepared.receipts[0];
    if (!receipt) { fail(prepared.diagnostics.map((d) => d.reason).join("; ") || "no receipt"); continue; }
    if ([...receipt.nativeFloorElementIds].sort((a, b) => a - b).join() !== [...transition.floorElementIds].sort((a, b) => a - b).join()) { fail(`receipt lands on slabs ${receipt.nativeFloorElementIds.join("/")} but the recipe names ${transition.floorElementIds.join("/")}`); continue; }
    const assembly = model.nativeStairAssemblies?.find((a) => a.stairElementId === transition.nativeStairId);
    const own = nativeStairOwnedBodyElementIds(model, receipt, assembly?.runAndLandingIds ?? []);
    const foreignMaterial = prepareNativeLocalStairMaterial(model, dataset, receipt, own);
    const collisions = foreignMaterial.bands.flatMap((band) => band.sections.filter((section) => {
      const a = receipt.pointsFeet[band.segmentIndex]!, b = receipt.pointsFeet[band.segmentIndex + 1]!, d = DMath.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d;
      const strip: pc.Polygon = [[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny], [a[0] + nx, a[1] + ny]]];
      return pc.intersection(strip, section.partsFeet as pc.MultiPolygon).length > 0;
    }).map((s) => s.nativeElementId));
    const walkingBody = prepareNativeLocalStairBody(model, receipt);
    const ends = receipt.terminalCaps.map((cap, i) => {
      const endpoint = transition.endpoints.find((e) => e.roomKey && dataset.records.some((r) => r.key === e.roomKey && r.levelId === cap.levelId) && Math.abs((dataset.records.find((r) => r.key === e.roomKey)!.elevationFeet) - cap.pointFeet[2]) < 0.05);
      const record = endpoint ? dataset.records.find((r) => r.key === endpoint.roomKey)! : undefined;
      const building = record?.building ?? transition.endpoints[i]?.building ?? "";
      const node: IndoorNode = { id: `local:${transition.id}:${i}`, roomKey: record?.key ?? "", kind: "stair", levelId: cap.levelId, building, surfaceId: record?.surfaceId ?? `${building}:${cap.levelId}:${cap.pointFeet[2].toFixed(3)}`, pointFeet: structuredClone(cap.pointFeet), geographic: geo([cap.pointFeet[0], cap.pointFeet[1]]) };
      return node;
    });
    const lengthFeet = receipt.pointsFeet.slice(1).reduce((s, p, i) => s + DMath.hypot(...p.map((v, k) => v - receipt.pointsFeet[i]![k]!)), 0);
    const edge: IndoorEdge = {
      id: `local:${transition.id}`, from: ends[0]!.id, to: ends[1]!.id, kind: "local-steps",
      lengthMetres: lengthFeet * dataset.alignment.horizontalMetresPerFoot, pointsFeet: structuredClone(receipt.pointsFeet),
      roomKeys: [...new Set(ends.flatMap((n) => (n.roomKey ? [n.roomKey] : [])))],
      evidence: `Reviewed local steps ${transition.id} qualified from native stair #${transition.nativeStairId}: original tread inventory, terminal caps on slabs ${receipt.nativeFloorElementIds.join("/")}, complete foreign-material census and walking body; not step-free.`,
      nativeElementId: transition.nativeStairId, accessible: "no", enabled: true,
      nativeSourceStair: { ...receipt, foreignMaterial, walkingBody },
    };
    if (collisions.length) { fail(`foreign material crosses the 2 ft walking path: elements ${[...new Set(collisions)].join(", ")}`); continue; }
    if (dataset.nodes.some((n) => ends.some((e) => e.id === n.id)) || dataset.edges.some((e) => e.id === edge.id)) { fail("its node or edge identity already exists"); continue; }
    const check = { ...dataset, nodes: [...dataset.nodes, ...ends], edges: [...dataset.edges, edge] } as IndoorDataset;
    if (!validNativeSourceStairBinding(check, edge)) { fail("the complete receipt does not replay (flight/body/material/terminal binding)"); continue; }
    const cached = (assembly?.runAndLandingIds ?? []).flatMap((id) => (elements.get(id)?.stairTreads ?? []).map((t) => ({ runElementId: id, elevationFeet: t.reduce((z, q) => z + q[2] / t.length, 0), ringFeet: t.map((q) => [q[0], q[1]] as P2) })));
    qualified.push({ transition, edge, nodes: ends, reconciliation: nativeStairInventoryReconciliation(receipt.treads, cached) });
  }
  return { qualified, refused };
}
