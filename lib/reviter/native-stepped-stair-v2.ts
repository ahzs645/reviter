/** A separate source-produced stepped variant. It uses existing claimed floor
 * cells only and cannot create a landing, move a node or grant accessibility.
 * Raw wire facts grant no original-RVT authority: the source producer and source
 * import reconstruction remain mandatory before publishing prepared assets. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { nativeCirculationGeometryKey } from "./native-circulation-geometry.ts";
import { createNativeExactRoutingAuthority } from "./native-exact-routing-authority.ts";
import {
  createNativeExactTopologyIndex,
  nativeRationalPathSupported,
  nativeRationalPointInParts,
} from "./native-exact-planar-topology.ts";
import {
  NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
  nativeRationalScalarToIEEE,
} from "./native-rational-overlay.ts";
const routingCalculationValue = <T>(_data: IndoorDataset, _key: string, read: () => T): T => read();
import {
  replayPortableSteppedStairV2,
  type SteppedStairV2WireValue,
} from "./native-stepped-stair-v2-kernel.ts";
import { prepareConservativeSteppedStairV2Wire } from "./native-stepped-stair-v2-lazy-wire.ts";
import {
  createCurrentSteppedStairGraphBinding,
  type PortableSteppedGraphBinding,
} from "./native-stepped-stair-v2-graph-binding.ts";
import type { IndoorDataset, IndoorEdge } from "./indoor-contract.ts";

export type NativeSteppedStairV2SourceIndexEntry = {
  id: string;
  physical: SteppedStairV2WireValue;
};
export type NativeSteppedStairV2Approach = {
  nodeId: string;
  nativeCellId: string;
  walkEdgeId: string;
  walkEdgeSha256: string;
  cellSha256: string;
};
export type NativeSteppedStairV2EdgeProof = {
  version: 2;
  sourceIndexId: string;
  receipt: SteppedStairV2WireValue;
  originalGraphBinding: PortableSteppedGraphBinding;
  anchorPolicy: "existing-claimed-cell-only";
  circulationGeometryKey: string;
  terminalApproaches: [
    NativeSteppedStairV2Approach,
    NativeSteppedStairV2Approach,
  ];
};
export const nativeSteppedStairV2Digest = (value: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length < 2000;
const digest = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const samePoint = (a: number[], b: number[]) =>
  a.length === b.length && a.every((n, i) => n === b[i]);

/** Graph rendering uses original logical endpoint coordinates. The complete
 * source physical chain and its same-XY attachments remain in the v2 receipt;
 * replacing the display endpoints adds no fictitious vertical walking segment. */
export function nativeSteppedStairV2DrawingPoints(
  replay: ReturnType<typeof replayPortableSteppedStairV2>,
  binding: PortableSteppedGraphBinding,
): [number, number, number][] {
  if (!replay.mathematicalReplayPassed || replay.physicalPointsFeet.length < 2)
    throw new Error("No complete stepped physical path");
  const points = replay.physicalPointsFeet.map(
    (p) => p.map(nativeRationalScalarToIEEE) as [number, number, number],
  );
  points[0] = [...binding.terminals[0]!.node.pointFeet];
  points[points.length - 1] = [...binding.terminals[1]!.node.pointFeet];
  return points.filter((p, i) => !i || !samePoint(p, points[i - 1]!));
}

/** Rechecks the actual current original floor/material face. A descriptor hash
 * or an existing walk label cannot establish physical lateral support. No door
 * half or unclaimed connector anchor extends this deliberately narrow variant. */
export function assertExistingClaimedSteppedApproaches(
  data: IndoorDataset,
  edge: IndoorEdge,
  proof: NativeSteppedStairV2EdgeProof,
) {
  const geometry = data.circulationGeometry;
  if (
    !data.nativeIndoorEnvelopes ||
    !geometry?.exactTopology ||
    geometry.sourceModelSha256 !== data.source.modelSha256 ||
    geometry.sourceGeometryKey !== proof.circulationGeometryKey ||
    geometry.sourceGeometryKey !== nativeCirculationGeometryKey(data)
  )
    throw new Error(
      "Stepped stair needs unchanged current original circulation cells",
    );
  if (
    !Array.isArray(proof.terminalApproaches) ||
    proof.terminalApproaches.length !== 2
  )
    throw new Error("Missing existing stepped terminal approaches");
  const exact = createNativeExactTopologyIndex(geometry.exactTopology, {
      sourceModelSha256: data.source.modelSha256,
      sourceGeometryKey: geometry.sourceGeometryKey,
      kernelVersion: NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
    }),
    authority = createNativeExactRoutingAuthority(data);
  for (const [side, nodeId] of [edge.from, edge.to].entries()) {
    const binding = proof.terminalApproaches[side]!,
      node = data.nodes.find((n) => n.id === nodeId),
      record = node && data.records.find((r) => r.key === node.roomKey),
      cells = geometry.cells.filter((c) => c.id === binding?.nativeCellId),
      walks = data.edges.filter((e) => e.id === binding?.walkEdgeId),
      cell = cells[0],
      walk = walks[0];
    if (
      !binding ||
      binding.nodeId !== nodeId ||
      !node ||
      !record ||
      !record.walkable ||
      record.access === "staff" ||
      !(record.stair || record.circulation) ||
      cells.length !== 1 ||
      walks.length !== 1 ||
      !cell ||
      !walk ||
      !cell.exactFaceId ||
      !cell.roomKeys.includes(node.roomKey) ||
      !cell.levelIds.includes(node.levelId) ||
      cell.elevationFeet !== node.pointFeet[2] ||
      !walk.enabled ||
      walk.kind !== "walk" ||
      walk.nativeCellId !== cell.id ||
      ![walk.from, walk.to].includes(nodeId) ||
      !walk.roomKeys.includes(node.roomKey) ||
      walk.roomKeys.some((k) => !cell.roomKeys.includes(k)) ||
      !digest(binding.walkEdgeSha256) ||
      !digest(binding.cellSha256) ||
      nativeSteppedStairV2Digest(walk) !== binding.walkEdgeSha256 ||
      nativeSteppedStairV2Digest(cell) !== binding.cellSha256
    )
      throw new Error(
        "Stepped stair changed or borrowed an existing claimed terminal approach",
      );
    const from = data.nodes.find((n) => n.id === walk.from),
      to = data.nodes.find((n) => n.id === walk.to),
      original = exact.parts(cell.exactFaceId);
    if (
      !from ||
      !to ||
      !original ||
      walk.pointsFeet.length === 0 ||
      !samePoint(walk.pointsFeet[0]!, from.pointFeet) ||
      !samePoint(walk.pointsFeet.at(-1)!, to.pointFeet) ||
      walk.pointsFeet.some(
        (p) =>
          p.length !== 3 ||
          !p.every(Number.isFinite) ||
          p[2] !== cell.elevationFeet,
      )
    )
      throw new Error("Stepped lateral walk changed original endpoints/plane");
    const physical = authority(cell.elevationFeet, original);
    if (
      !nativeRationalPointInParts(node.pointFeet, physical) ||
      !nativeRationalPathSupported(walk.pointsFeet, physical)
    )
      throw new Error(
        "Stepped terminal lacks its current original physical lateral floor/material support",
      );
  }
}

export function inspectNativeSteppedStairV2Binding(
  data: IndoorDataset,
  edge: IndoorEdge,
) {
  return routingCalculationValue(data, `stepped-v2-result:${edge.id}`, () =>
    inspectNativeSteppedStairV2BindingSnapshot(data, edge),
  );
}
function inspectNativeSteppedStairV2BindingSnapshot(
  data: IndoorDataset,
  edge: IndoorEdge,
) {
  const proof = edge.nativeSteppedStairV2;
  if (
    !proof ||
    proof.version !== 2 ||
    proof.anchorPolicy !== "existing-claimed-cell-only" ||
    edge.nativeSourceStair ||
    !["stairs", "local-steps"].includes(edge.kind) ||
    edge.accessible !== "no" ||
    !text(proof.sourceIndexId) ||
    !text(proof.circulationGeometryKey)
  )
    throw new Error("Invalid distinct stepped stair variant");
  const rows = data.nativeSteppedStairV2SourceIndices;
  if (!Array.isArray(rows) || rows.length > 1000)
    throw new Error("Missing bounded shared stepped source index");
  const matches = rows.filter((row) => row.id === proof.sourceIndexId);
  if (matches.length !== 1)
    throw new Error("Missing or duplicated stepped physical source index");
  const prepared = routingCalculationValue(
      data,
      `stepped-v2-index:${proof.sourceIndexId}:${edge.id}`,
      () =>
        prepareConservativeSteppedStairV2Wire(
          matches[0]!.physical,
          proof.receipt,
        ),
    ),
    { index: physical, receipt } = prepared,
    current = createCurrentSteppedStairGraphBinding(data, edge.id),
    replay = replayPortableSteppedStairV2(
      physical,
      receipt,
      proof.originalGraphBinding,
      current,
    );
  if (!replay.mathematicalReplayPassed)
    throw new Error(
      `Stepped stair profile refused: ${replay.issues.join("; ")}`,
    );
  const points = nativeSteppedStairV2DrawingPoints(replay, current);
  if (JSON.stringify(points) !== JSON.stringify(edge.pointsFeet))
    throw new Error(
      "Stepped drawing path differs from its physical receipt and original logical endpoints",
    );
  assertExistingClaimedSteppedApproaches(data, edge, proof);
  return { physical, receipt, replay, currentGraphBinding: current };
}
export function validNativeSteppedStairV2Binding(
  data: IndoorDataset,
  edge: IndoorEdge,
): boolean {
  return routingCalculationValue(data, `stepped-v2-binding:${edge.id}`, () => {
    try {
      inspectNativeSteppedStairV2Binding(data, edge);
      return true;
    } catch {
      return false;
    }
  });
}
export function validateNativeSteppedStairV2Proofs(data: IndoorDataset) {
  const rows = data.nativeSteppedStairV2SourceIndices,
    edges = data.edges.filter(
      (edge) => edge.nativeSteppedStairV2 !== undefined,
    );
  if (rows === undefined) {
    if (edges.length > 0)
      throw new Error("Missing shared stepped source indices");
    return;
  }
  if (
    !Array.isArray(rows) ||
    rows.length > 1000 ||
    rows.some((row) => !row || !text(row.id)) ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw new Error("Invalid shared stepped source index inventory");
  if (
    rows.some(
      (row) =>
        !edges.some(
          (edge) => edge.nativeSteppedStairV2!.sourceIndexId === row.id,
        ),
    )
  )
    throw new Error("Unreferenced stepped source index");
  for (const edge of edges)
    if (!validNativeSteppedStairV2Binding(data, edge))
      inspectNativeSteppedStairV2Binding(data, edge);
}
