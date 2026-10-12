import * as DMath from "./deterministic-math.ts";
import { nativeRationalOverlay, type NativeRationalParts } from "./native-rational-overlay.ts";
import { nativeRationalPathSupported } from "./native-exact-planar-topology.ts";
import { createNativeRoutingMaterialQuery } from "./native-routing-material.ts";
import { createNativeExactBoundaryMaterialQuery } from "./native-boundary-material.ts";
import { indoorExclusionParts } from "./indoor-exclusions.ts";
import { nativeSlabJoinClosures } from "./native-slab-join-closures.ts";
import { nativeAccessZonesAt } from "./native-access-zones.ts";
import { nativeRoomIdentityRings } from "./native-floor-opening-ownership.ts";
import type { IndoorDataset, IndoorEdge } from "./indoor-contract.ts";

/** Mirror of openindoormaps app/indoor-project/reviewed-circulation-links.ts (keep identical). */
export const REVIEWED_CIRCULATION_LINKS_VERSION = "reviewed-circulation-links-v1";
export const REVIEWED_CIRCULATION_LINK_MAX_FEET = 200;

type P2 = [number, number];
type P3 = [number, number, number];
type Rings = P2[][];
/** An owner-reviewed walking link between two EXISTING graph nodes on one
 * floor plane, drawn as a polyline. It is the explicit fallback where the
 * automatic native cells cannot join two supported places (an envelope
 * omission at a vestibule, a ramp head on a floor edge). It never moves a node,
 * enables a door or grants access: its path must stay on original walking
 * slabs, clear of every native material veto, door leaf, exclusion, reviewed
 * access zone and restricted identity, and both ends must be walkable,
 * non-staff places. Access and accessibility stay unverified. */
export type ReviewedCirculationLink = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  pointsFeet: P3[];
  decision: { source: string; id: string; summary: string };
  notes?: string;
};
export type ReviewedCirculationLinks = { version: 1; sourceModelSha256: string; links: ReviewedCirculationLink[] };
type MaterialQuery = ReturnType<typeof createNativeRoutingMaterialQuery>;

const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
export function validateReviewedCirculationLinks(value: unknown, sourceModelSha256?: string): asserts value is ReviewedCirculationLinks | undefined {
  if (value === undefined) return;
  const v = value as ReviewedCirculationLinks, ids = new Set<string>();
  if (
    !v || typeof v !== "object" || v.version !== 1 || !/^[a-f0-9]{64}$/.test(String(v.sourceModelSha256)) ||
    (sourceModelSha256 !== undefined && v.sourceModelSha256 !== sourceModelSha256) ||
    !Array.isArray(v.links) || v.links.length > 5000 ||
    v.links.some((l) => {
      if (
        !l || !text(l.id, 200) || ids.has(l.id) || !text(l.fromNodeId, 2000) || !text(l.toNodeId, 2000) || l.fromNodeId === l.toNodeId ||
        !Array.isArray(l.pointsFeet) || l.pointsFeet.length < 2 || l.pointsFeet.length > 1000 ||
        l.pointsFeet.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e7)) ||
        !l.decision || !text(l.decision.source, 500) || !text(l.decision.id, 200) || !text(l.decision.summary, 10000) ||
        (l.notes !== undefined && !text(l.notes, 10000))
      )
        return true;
      ids.add(l.id);
      return false;
    })
  )
    throw new Error("Invalid reviewed circulation links.");
}
export const reviewedCirculationLinkEdgeId = (link: Pick<ReviewedCirculationLink, "id">) => `reviewed-link:${link.id}`;

/** Exact physical and access replay of one reviewed link against the CURRENT
 * dataset. Local: only original geometry near the drawn path is clipped. */
export function reviewedCirculationLinkSupport(
  data: IndoorDataset,
  link: ReviewedCirculationLink,
  materialQuery?: MaterialQuery,
): { ok: true; roomKeys: string[]; lengthFeet: number } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  try {
    if (data.reviewedCirculationLinks?.sourceModelSha256 !== data.source.modelSha256) return fail("the link set belongs to another source model");
    if (!data.nativeIndoorEnvelopes || data.walkingSupport?.sourceModelSha256 !== data.source.modelSha256) return fail("strict native walking support is missing");
    const from = data.nodes.find((n) => n.id === link.fromNodeId), to = data.nodes.find((n) => n.id === link.toNodeId);
    if (!from || !to) return fail("a linked node does not exist");
    const points = link.pointsFeet, z = from.pointFeet[2];
    const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    if (!same(points[0]!, from.pointFeet) || !same(points.at(-1)!, to.pointFeet)) return fail("the drawn path does not start and end exactly at the linked nodes");
    if (points.some((p) => Math.abs(p[2] - z) > 0.05) || Math.abs(to.pointFeet[2] - z) > 0.05) return fail("a reviewed link stays on one floor plane");
    let lengthFeet = 0;
    for (let i = 1; i < points.length; i++) {
      const d = DMath.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
      if (d < 1e-8) return fail("the drawn path has a repeated point");
      lengthFeet += d;
    }
    if (lengthFeet > REVIEWED_CIRCULATION_LINK_MAX_FEET) return fail("the drawn path is too long for a local link");
    const owners = [from, to].map((n) => data.records.find((r) => r.key === n.roomKey));
    if (owners.some((r) => !r || !r.walkable || r.access === "staff" || Math.abs(r.elevationFeet - z) > 0.05)) return fail("both ends must be walkable, non-staff places on this plane");
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const box = [Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4];
    const window: Rings = [[[box[0]!, box[1]!], [box[2]!, box[1]!], [box[2]!, box[3]!], [box[0]!, box[3]!]]];
    const near = (rings: Rings) => {
      const p = rings.flat();
      return p.length > 0 && Math.max(...p.map((q) => q[0])) >= box[0]! && Math.min(...p.map((q) => q[0])) <= box[2]! &&
        Math.max(...p.map((q) => q[1])) >= box[1]! && Math.min(...p.map((q) => q[1])) <= box[3]!;
    };
    const floorParts = data.walkingSupport.floors.filter((f) => Math.abs(f.elevationFeet - z) < 0.05).flatMap((f) => f.partsFeet ?? [f.ringsFeet]) as Rings[];
    const local = floorParts.filter(near);
    if (!local.length) return fail("no original walking slab lies under the drawn path");
    const joins = nativeSlabJoinClosures(local.map((part, i) => ({ nativeElementId: i, partsFeet: [part] })));
    let support: NativeRationalParts = nativeRationalOverlay("intersection", [window], joins.length ? nativeRationalOverlay("union", local, joins) : local);
    const levels = new Set(data.nativeLevels.filter((l) => Math.abs(l.elevationFeet - z) < 0.05).map((l) => l.id));
    const material = (materialQuery ?? createNativeRoutingMaterialQuery(data))(z), boundary = createNativeExactBoundaryMaterialQuery(data);
    // A portal endpoint stands inside its own doorway: only that door's own
    // footprint is exempt from the vetoes, never any other doorway or leaf.
    const ownDoorIds = new Set([from, to].flatMap((n) => (n.kind === "portal" ? [n.id.replace(/:[01]$/, "")] : [])));
    const ownDoors = (data.doors ?? []).filter((d) => ownDoorIds.has(d.id) && d.state === "connected" && d.footprintFeet && data.edges.some((e) => e.id === d.id && e.kind === "door" && e.enabled && [e.from, e.to].some((id) => id === from.id || id === to.id)));
    const masks: Rings[] = [
      ...(material.derivedParts ?? []),
      ...material.parts.map((p) => p.rings),
      ...(data.circulationGeometry?.fixtures ?? []).filter((f) => Math.abs(f.elevationFeet - z) < 0.05).map((f) => f.ringsFeet as Rings),
      ...indoorExclusionParts(data, z),
      ...(data.doors ?? []).filter((d) => levels.has(d.levelId) && d.footprintFeet && !ownDoors.includes(d)).map((d) => [d.footprintFeet!] as Rings),
      ...data.records.filter((r) => Math.abs(r.elevationFeet - z) < 0.05 && (r.access === "staff" || !r.walkable)).map((r) => nativeRoomIdentityRings(data, r) as Rings),
    ].filter((m) => near(m as Rings));
    // Reviewed boundary patches keep their exact (rational) bodies.
    const patched: NativeRationalParts = data.walls
      .filter((w) => levels.has(w.levelId) && near(w.ringsFeet as Rings) && (!material.known.has(w.nativeElementId) || (w.reviewPatchId && material.present.has(w.nativeElementId))))
      .flatMap((w) => boundary(w));
    const zoneParts = nativeAccessZonesAt(data, z).flatMap((zone) => zone.parts);
    const vetoes: NativeRationalParts = masks.length || patched.length ? nativeRationalOverlay("union", [...masks, ...patched] as Rings[]) : [];
    const exempt = ownDoors.map((d) => [d.footprintFeet!] as Rings);
    const blocking = exempt.length && vetoes.length ? nativeRationalOverlay("difference", vetoes, exempt) : vetoes;
    if (blocking.length) support = nativeRationalOverlay("difference", support, blocking);
    if (zoneParts.length && support.length) support = nativeRationalOverlay("difference", support, zoneParts);
    if (!support.length || !nativeRationalPathSupported(points, support)) return fail("the drawn path leaves original walking slab or crosses native material, a door leaf, an exclusion, an access zone or a restricted place");
    return { ok: true, roomKeys: [...new Set([from.roomKey, to.roomKey])].sort(), lengthFeet };
  } catch (error) {
    return fail(`exact link support is unclassifiable: ${String(error)}`);
  }
}
/** A prepared edge is valid only while it still equals its reviewed link and
 * the link still replays against current source geometry. */
export function validReviewedCirculationLinkEdge(data: IndoorDataset, edge: IndoorEdge, materialQuery?: MaterialQuery): boolean {
  if (edge.kind !== "walk" || edge.reviewedCirculationLinkId === undefined || edge.nativeCellId !== undefined) return false;
  const link = data.reviewedCirculationLinks?.links.find((l) => l.id === edge.reviewedCirculationLinkId);
  if (!link || edge.id !== reviewedCirculationLinkEdgeId(link) || edge.from !== link.fromNodeId || edge.to !== link.toNodeId ||
      JSON.stringify(edge.pointsFeet) !== JSON.stringify(link.pointsFeet)) return false;
  const support = reviewedCirculationLinkSupport(data, link, materialQuery);
  return support.ok && JSON.stringify([...edge.roomKeys].sort()) === JSON.stringify(support.roomKeys) && edge.accessible !== "yes";
}
/** Compiler: replay every reviewed link and emit its walking edge. */
export function applyReviewedCirculationLinks(data: IndoorDataset) {
  const applied: IndoorEdge[] = [], rejected: { id: string; reason: string }[] = [];
  data.edges = data.edges.filter((e) => e.reviewedCirculationLinkId === undefined);
  const links = data.reviewedCirculationLinks?.links ?? [];
  if (!links.length) return { applied, rejected };
  const materialQuery = createNativeRoutingMaterialQuery(data);
  for (const link of links) {
    const support = reviewedCirculationLinkSupport(data, link, materialQuery);
    if (!support.ok) { rejected.push({ id: link.id, reason: support.reason }); continue; }
    if (data.edges.some((e) => e.id === reviewedCirculationLinkEdgeId(link))) { rejected.push({ id: link.id, reason: "its edge identity already exists" }); continue; }
    const edge: IndoorEdge = {
      id: reviewedCirculationLinkEdgeId(link), from: link.fromNodeId, to: link.toNodeId, kind: "walk", reviewedCirculationLinkId: link.id,
      roomKeys: support.roomKeys, pointsFeet: structuredClone(link.pointsFeet),
      lengthMetres: support.lengthFeet * data.alignment.horizontalMetresPerFoot, accessible: "unknown", enabled: true,
      evidence: `Reviewed owner link ${link.decision.source}#${link.decision.id}; original walking slab, native material, door leaves, exclusions, access zones and restricted places checked along the drawn path; access and accessibility unverified.`,
    };
    data.edges.push(edge);
    applied.push(edge);
  }
  return { applied, rejected };
}
