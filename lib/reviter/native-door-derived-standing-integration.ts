/** Normal compiler integration of live original-source standing capabilities.
 * Source proof, current physical cell admission and final walking replay are
 * separate requirements. Original nodes, doors, owners and access remain. */
import * as DMath from "./deterministic-math.ts";
import type {
  IndoorDataset,
  IndoorEdge,
  IndoorNode,
} from "./indoor-contract.ts";
import {
  checkedNativeStandingOwnerCell,
  nativeWalkSurvivedPhysicalReplay,
  type NativePhysicalCellReplay,
} from "./native-circulation-geometry.ts";
import {
  assertOriginalDoorDerivedStandingIdentityPreserved,
  assertOriginalDoorDerivedStandingProposal,
  inspectOriginalDoorDerivedStanding,
  type OriginalDoorDerivedStanding,
} from "./native-source-door-derived-standing.ts";

const attachedBrand: unique symbol = Symbol("AttachedOriginalDoorStanding");
export type AttachedOriginalDoorStanding = { readonly [attachedBrand]: true };
const attachments = new WeakMap<
  AttachedOriginalDoorStanding,
  {
    data: IndoorDataset;
    source: OriginalDoorDerivedStanding;
    node: IndoorNode;
    edge: IndoorEdge;
    geometry: NonNullable<IndoorDataset["circulationGeometry"]>;
    cell: NonNullable<IndoorDataset["circulationGeometry"]>["cells"][number];
    cellJson: string;
    nodeJson: string;
    edgeJson: string;
  }
>();

/** Called after ordinary cell branches are rebuilt, before their independent
 * final physical replay. A detached source receipt cannot enter this API. */
export function attachOriginalDoorDerivedStanding(
  data: IndoorDataset,
  source: OriginalDoorDerivedStanding,
  geographic: (point: [number, number]) => [number, number],
): AttachedOriginalDoorStanding {
  assertOriginalDoorDerivedStandingIdentityPreserved(source, data);
  const receipt = inspectOriginalDoorDerivedStanding(source),
    proposal = receipt.proposedNode,
    approach = receipt.proposedApproach;
  if (
    data.nodes.some((n) => n.id === proposal.id) ||
    data.edges.some((e) => e.id === approach.id)
  )
    throw new Error("Derived source standing identity already exists.");
  const support = checkedNativeStandingOwnerCell(
    data,
    proposal.roomKey,
    proposal.levelId,
    proposal.pointFeet,
    receipt.originalPortalPointFeet,
  );
  const geometry = data.circulationGeometry,
    cell = geometry?.cells.find((value) => value.id === support.nativeCellId);
  if (!geometry || !cell)
    throw new Error("Checked door standing cell disappeared.");
  const cellJson = JSON.stringify(cell),
    projected = geographic([proposal.pointFeet[0], proposal.pointFeet[1]]);
  if (projected.length !== 2 || projected.some((n) => !Number.isFinite(n)))
    throw new Error("Derived standing geographic projection is invalid.");
  const node: IndoorNode = { ...proposal, geographic: [...projected] },
    edge: IndoorEdge = {
      ...approach,
      ...support,
      lengthMetres:
        DMath.hypot(
          ...proposal.pointFeet.map(
            (n, i) => n - receipt.originalPortalPointFeet[i]!,
          ),
        ) * data.alignment.horizontalMetresPerFoot,
      enabled: true,
      evidence:
        "Fresh original native door/host/stair/full foreign-body/floor standing and finite transverse approach proof; unchanged original portal; complete current owner-cell standing footprint and independent physical free face; every cell owner retained. Door opening, upstream crossing, public access and accessibility remain unapproved.",
    };
  if (
    data.circulationGeometry !== geometry ||
    !geometry.cells.includes(cell) ||
    JSON.stringify(cell) !== cellJson
  )
    throw new Error(
      "Checked door standing cell changed during geographic projection.",
    );
  data.nodes.push(node);
  data.edges.push(edge);
  try {
    assertOriginalDoorDerivedStandingProposal(source, data);
  } catch (error) {
    data.nodes.splice(data.nodes.indexOf(node), 1);
    data.edges.splice(data.edges.indexOf(edge), 1);
    throw error;
  }
  const token = Object.freeze({ [attachedBrand]: true as const });
  attachments.set(token, {
    data,
    source,
    node,
    edge,
    geometry,
    cell,
    cellJson,
    nodeJson: JSON.stringify(node),
    edgeJson: JSON.stringify(edge),
  });
  return token;
}

/** Apply only after the exact inserted approach survives the ordinary final
 * native physical replay unchanged. This names a derived standing point;
 * downstream runtime geometry, full-width and access policy checks still run. */
export function applyOriginalDoorDerivedStandingArrival(
  data: IndoorDataset,
  token: AttachedOriginalDoorStanding,
  roomKey: string,
  physicalReplay: NativePhysicalCellReplay,
) {
  const state = attachments.get(token);
  if (!state || state.data !== data)
    throw new Error("Live same-compiler standing attachment required.");
  if (state.node.roomKey !== roomKey) return undefined;
  if (
    data.circulationGeometry !== state.geometry ||
    !state.geometry.cells.includes(state.cell) ||
    JSON.stringify(state.cell) !== state.cellJson ||
    JSON.stringify(state.node) !== state.nodeJson ||
    JSON.stringify(state.edge) !== state.edgeJson
  )
    throw new Error(
      "Source-qualified door standing attachment changed after its current-cell check.",
    );
  assertOriginalDoorDerivedStandingProposal(state.source, data);
  const records = data.records.filter((r) => r.key === roomKey);
  if (records.length !== 1)
    throw new Error("Original standing owner is missing or duplicated.");
  const record = records[0]!;
  if (
    !record.walkable ||
    record.access === "staff" ||
    record.arrivalNodeId ||
    !nativeWalkSurvivedPhysicalReplay(data, physicalReplay, state.edge) ||
    !data.nodes.includes(state.node) ||
    !data.edges.includes(state.edge)
  )
    return undefined;
  record.arrivalNodeId = state.node.id;
  return {
    roomKey,
    proposedArrivalNodeId: state.node.id,
    nativeCellId: state.edge.nativeCellId,
  };
}
