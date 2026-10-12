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

type P2 = [number, number];
type P3 = [number, number, number];
/** Elements that never carry a physical body in a walking band: sketch/boundary,
 * centre-line and rail-path helper lines. Everything else is physical. */
const HELPER_CATEGORIES = new Set([-2000067, -2000530, -2000954]);
const values = (a: unknown): number[] =>
  Array.isArray(a) ? a : ArrayBuffer.isView(a) ? Array.from(a as unknown as ArrayLike<number>) : a && typeof a === "object" ? Object.values(a as Record<string, number>) : [];
const hash = (v: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(v))));
const ringArea = (r: P2[]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

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
  receipt: { nativeStairId: number; nativeRunIds: number[]; nativeFloorElementIds: [number, number]; pointsFeet: P3[] },
  own: readonly number[],
): NativeSourceStairMaterial {
  const points = receipt.pointsFeet;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]), zs = points.map((p) => p[2]);
  const box = [Math.min(...xs) - 1.5, Math.min(...ys) - 1.5, Math.max(...xs) + 1.5, Math.max(...ys) + 1.5];
  const low = Math.min(...zs), high = Math.max(...zs) + 0.1;
  const exclude = new Set([receipt.nativeStairId, ...receipt.nativeRunIds, ...receipt.nativeFloorElementIds, ...own]);
  const census = model.elementBounds.filter((r) =>
    !exclude.has(r.elementId) && r.elementId > 0 && !HELPER_CATEGORIES.has(r.categoryId ?? 0) &&
    r.boundsFeet.max.x >= box[0]! && r.boundsFeet.min.x <= box[2]! && r.boundsFeet.max.y >= box[1]! && r.boundsFeet.min.y <= box[3]! &&
    r.boundsFeet.max.z > low + 0.01 && r.boundsFeet.min.z < high);
  const triangles = elementTriangles(model, new Set(census.map((r) => r.elementId)));
  const footprint = new Map<number, P2[][][]>();
  for (const r of census) {
    const tris = triangles.get(r.elementId);
    let parts: P2[][][] = [];
    if (tris?.length) {
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
    const sections = census
      .filter((r) => r.boundsFeet.max.z > lo + 0.01 && r.boundsFeet.min.z < hi && footprint.has(r.elementId))
      .map((r) => ({ nativeElementId: r.elementId, partsFeet: footprint.get(r.elementId)! }))
      .sort((x, y) => x.nativeElementId - y.nativeElementId);
    return { segmentIndex: i, minimumElevationFeet: lo, maximumElevationFeet: hi, unclassifiedSourceElementIds: [] as number[], sections };
  });
  const value: Omit<NativeSourceStairMaterial, "geometrySha256"> = {
    version: 1, sourceModelSha256: data.source.modelSha256,
    evidenceSha256: hash(["native-local-stair-material-census-v1", sourceElementIds, [...exclude].sort((a, b) => a - b), box, low, high]),
    sourceWallPositionRepairsSha256: nativeSourceStairPlacementHash(data.nativeWallPositionRepairs, data.nativeDerivedFrameReturns, data.nativeProvisionalCornerSeals),
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
    const own = assembly ? [...assembly.runAndLandingIds] : [];
    // A run's Treads/Risers finish element is part of its walking body: hosted on
    // the run, or occupying exactly the run's own bounds.
    const runs = own.map((id) => elements.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    const within = (r: (typeof runs)[number], b: (typeof runs)[number]) => (["x", "y", "z"] as const).every((k) => r.boundsFeet.min[k] >= b.boundsFeet.min[k] - 0.05 && r.boundsFeet.max[k] <= b.boundsFeet.max[k] + 0.05);
    for (const r of model.elementBounds)
      if (r.categoryId === -2000921 && ((model.nativeHostRelations ?? []).some((h) => h.elementId === r.elementId && own.includes(h.hostId)) || runs.some((run) => within(r, run)))) own.push(r.elementId);
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
