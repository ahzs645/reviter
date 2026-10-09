import { nativeAuthoredStairTreads } from "./native-authored-stair-treads.ts";
import { validNativeSourceStairBody } from "./native-source-stair-body.ts";
import { validNativeSourceStairMaterial } from "./native-source-stair-material.ts";
import type { IndoorDataset, IndoorEdge } from "./indoor-contract.ts";
import { validateNativeSourceStairWidth } from "./native-source-stair-width.ts";

const samePoint = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const sameRing = (a: number[][], b: number[][]) => {
  const open = (r: number[][]) =>
    r.length > 1 && samePoint(r[0]!, r.at(-1)!) ? r.slice(0, -1) : r;
  a = open(a);
  b = open(b);
  if (a.length !== b.length || !a.length) return false;
  return b.some((_, start) =>
    [1, -1].some((direction) =>
      a.every((point, i) =>
        samePoint(point, b[(start + direction * i + b.length) % b.length]!),
      ),
    ),
  );
};
const sameRings = (a: number[][][], b: number[][][]) =>
  a.length === b.length && a.every((r, i) => sameRing(r, b[i]!));

/** Replay the actual original owner inventory, not a label or a saved approval.
 * Exact enclosure/material checks remain mandatory for terminal attachments. */
export function validNativeSourceStairBinding(
  data: IndoorDataset,
  edge: IndoorEdge,
): boolean {
  try {
    const proof = edge.nativeSourceStair;
    if (
      !data.nativeIndoorEnvelopes ||
      !proof ||
      !(edge.kind === "stairs" || edge.kind === "local-steps") ||
      proof.sourceModelSha256 !== data.source.modelSha256 ||
      proof.nativeStairId !== edge.nativeElementId ||
      edge.accessible !== "no" ||
      JSON.stringify(proof.pointsFeet) !== JSON.stringify(edge.pointsFeet) ||
      data.stairDisplay?.sourceModelSha256 !== data.source.modelSha256 ||
      data.walkingSupport?.sourceModelSha256 !== data.source.modelSha256
    )
      return false;
    const flight = data.stairDisplay.sourceFlights?.find(
      (f) => f.stairElementId === proof.nativeStairId,
    );
    if (
      !flight ||
      flight.context === "outdoor" ||
      flight.context === "tiered-seating" ||
      proof.nativeRunIds.some(
        (id) => !flight.runs?.some((r) => r.runElementId === id),
      )
    )
      return false;
    const authored = nativeAuthoredStairTreads(data.nativeSourceStairMaterials?.authoredTreadRoles, data.source.modelSha256);
    const boundRuns = proof.nativeRunIds.filter(id => authored.has(id));
    if (boundRuns.length && (
      flight.authoredTreadRolesSha256 !== data.nativeSourceStairMaterials!.authoredTreadRoles!.geometrySha256 ||
      boundRuns.some(id => {
        const exact = authored.get(id)!, exported = flight.treads.filter(t => t.runElementId === id);
        return exact.length !== exported.length || exact.some((t, i) => t.elevationFeet !== exported[i]!.elevationFeet || !sameRing(t.ringFeet, exported[i]!.ringFeet));
      })
    )) return false;
    const original = flight.treads.filter((t) =>
      proof.nativeRunIds.includes(t.runElementId),
    );
    const unmatched = [...original];
    if (unmatched.length !== proof.treads.length) return false;
    for (const tread of proof.treads) {
      const index = unmatched.findIndex(
        (o) =>
          o.runElementId === tread.runElementId &&
          o.elevationFeet === tread.elevationFeet &&
          sameRing(o.ringFeet, tread.ringFeet),
      );
      if (index < 0) return false;
      unmatched.splice(index, 1);
    }
    if (
      proof.landings.some(
        (l) =>
          !flight.landings?.some(
            (o) =>
              o.nativeElementId === l.nativeElementId &&
              o.elevationFeet === l.elevationFeet &&
              sameRings(o.ringsFeet, l.ringsFeet),
          ),
      )
    )
      return false;
    const nodes = [edge.from, edge.to].map((id) =>
      data.nodes.find((n) => n.id === id),
    );
    if (
      nodes.some(
        (n, i) =>
          !n ||
          (n.roomKey !== "" && !data.records.some(r => r.key === n.roomKey && r.levelId === n.levelId)) ||
          n.kind !== "stair" ||
          n.levelId !== proof.levelIds[i] ||
          !samePoint(n.pointFeet, proof.terminalCaps[i]!.pointFeet) ||
          !data.nativeLevels.some(
            (l) =>
              l.id === n.levelId &&
              l.elevationFeet === n.pointFeet[2],
          ),
      )
    )
      return false;
    // Room keys are identity/access metadata only. They cannot move a native cap
    // or supply any of the original flight, floor or foreign-material geometry.
    const endpointKeys = [...new Set(nodes.flatMap(n => n!.roomKey ? [n!.roomKey] : []))];
    if (edge.roomKeys.length !== endpointKeys.length || edge.roomKeys.some(k => !endpointKeys.includes(k))) return false;
    return (
      validNativeSourceStairBody(
        proof.walkingBody,
        proof,
        data.walkingSupport.floors,
        true,
      ) &&
      validNativeSourceStairMaterial(
        proof.foreignMaterial,
        data.source.modelSha256,
        proof.nativeStairId,
        proof.pointsFeet,
        data.nativeWallPositionRepairs,
        data.nativeDerivedFrameReturns,
        data.nativeProvisionalCornerSeals,
        true,
      ) &&
      validateNativeSourceStairWidth(proof, data.walkingSupport.floors, true)
    );
  } catch {
    return false;
  }
}

/** Only these independently bound original endpoints may have no room metadata. */
export function nativeSourceStairNodeIds(data: IndoorDataset): Set<string> {
  return new Set(
    data.edges
      .filter(
        (e) =>
          e.enabled &&
          e.nativeSourceStair &&
          validNativeSourceStairBinding(data, e),
      )
      .flatMap((e) => [e.from, e.to]),
  );
}

/** Strict native stairs require complete current body/width/material evidence.
 * Legacy archives keep their existing reviewed routing behavior. */
export function nativeStairRouteQualified(data: IndoorDataset, edge: IndoorEdge): boolean {
  if (edge.nativeSourceStair) return validNativeSourceStairBinding(data, edge);
  return !(data.nativeIndoorEnvelopes && (edge.kind === "stairs" || edge.kind === "local-steps"));
}

/** Reviewable original metadata stays present even when a flight cannot route. */
export function nativeStairQualificationIssues(data: IndoorDataset) {
  return data.edges.filter(e => (e.kind === "stairs" || e.kind === "local-steps") && !nativeStairRouteQualified(data, e)).map(e => ({
    edgeId: e.id,
    nativeElementId: e.nativeElementId,
    from: e.from,
    to: e.to,
    enabled: e.enabled,
    reason: e.nativeSourceStair ? "Current original flight/body/material/terminal evidence did not validate" : "Missing complete original native flight/body/material/terminal receipt",
  }));
}
