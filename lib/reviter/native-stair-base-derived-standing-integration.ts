/** Insert only the finite original-source approach after ordinary cell routes.
 * Its destination never becomes a cell owner or a new stair connection. */
import * as DMath from "./deterministic-math.ts";
import type {
  IndoorDataset,
  IndoorEdge,
  IndoorNode,
} from "./indoor-contract.ts";
import {
  checkedNativeSourceTerminalApproachCell,
  nativeWalkSurvivedPhysicalReplay,
  type NativePhysicalCellReplay,
} from "./native-circulation-geometry.ts";
import {
  assertOriginalSourceStairBaseIdentityPreserved,
  assertOriginalSourceStairBaseProposal,
  originalSourceStairBaseStandingFacts,
  type OriginalSourceStairBaseStanding,
} from "./native-source-stair-base-standing.ts";

const brand: unique symbol = Symbol("AttachedOriginalStairBaseStanding");
export type AttachedOriginalStairBaseStanding = { readonly [brand]: true };
const attachments = new WeakMap<
  AttachedOriginalStairBaseStanding,
  {
    data: IndoorDataset;
    source: OriginalSourceStairBaseStanding;
    node: IndoorNode;
    edge: IndoorEdge;
    geometry: NonNullable<IndoorDataset["circulationGeometry"]>;
    cell: NonNullable<IndoorDataset["circulationGeometry"]>["cells"][number];
    cellJson: string;
    nodeJson: string;
    edgeJson: string;
  }
>();

/** No serialized fact, source locator or caller boolean can enter this API. */
export function attachOriginalStairBaseDerivedStanding(
  data: IndoorDataset,
  source: OriginalSourceStairBaseStanding,
  geographic: (point: [number, number]) => [number, number],
): AttachedOriginalStairBaseStanding {
  assertOriginalSourceStairBaseIdentityPreserved(source, data);
  const facts = originalSourceStairBaseStandingFacts(source),
    proposal = facts.proposedNode,
    approach = facts.proposedApproach,
    anchor = facts.originalSourceApproach;
  if (
    !facts.fullSourceFiniteApproachQualified ||
    !facts.originalRecordedIntentAndNativeBaseCorrespondenceQualified ||
    facts.originalAccess === "staff" ||
    !proposal ||
    !approach ||
    !anchor
  )
    throw new Error(
      "Complete live original stair identity, standing and finite approach required.",
    );
  if (
    data.nodes.some((n) => n.id === proposal.id) ||
    data.edges.some((e) => e.id === approach.id)
  )
    throw new Error("Derived source stair base identity already exists.");
  const support = checkedNativeSourceTerminalApproachCell(
    data,
    anchor.originalNode.roomKey,
    proposal.levelId,
    approach.pointsFeet,
  );
  const geometry = data.circulationGeometry,
    cell = geometry?.cells.find((value) => value.id === support.nativeCellId);
  if (!geometry || !cell)
    throw new Error("Checked stair base cell disappeared.");
  const cellJson = JSON.stringify(cell),
    projected = geographic([proposal.pointFeet[0], proposal.pointFeet[1]]);
  if (projected.length !== 2 || projected.some((n) => !Number.isFinite(n)))
    throw new Error("Derived stair base geographic projection is invalid.");
  const node: IndoorNode = { ...proposal, geographic: [...projected] },
    edge: IndoorEdge = {
      ...approach,
      nativeCellId: support.nativeCellId,
      roomKeys: [...new Set([...support.roomKeys, proposal.roomKey])].sort(),
      direction: "both",
      enabled: true,
      lengthMetres:
        approach.pointsFeet
          .slice(1)
          .reduce(
            (sum, point, i) =>
              sum +
              DMath.hypot(
                ...point.map(
                  (value, axis) => value - approach.pointsFeet[i]![axis]!,
                ),
              ),
            0,
          ) * data.alignment.horizontalMetresPerFoot,
      evidence:
        "Fresh original recorded stair identity demand plus actual complete native parent/run/base, standing, foreign-body and finite approach/floor proof; whole current pure/free corridor-cell footprint; every incumbent owner plus destination retained on edge. Original cell owners, nodes, held stair connection, access and step-free status remain unchanged.",
    };
  if (
    data.circulationGeometry !== geometry ||
    !geometry.cells.includes(cell) ||
    JSON.stringify(cell) !== cellJson
  )
    throw new Error(
      "Checked stair base cell changed during geographic projection.",
    );
  data.nodes.push(node);
  data.edges.push(edge);
  try {
    assertOriginalSourceStairBaseProposal(source, data);
  } catch (error) {
    data.nodes.splice(data.nodes.indexOf(node), 1);
    data.edges.splice(data.edges.indexOf(edge), 1);
    throw error;
  }
  const token = Object.freeze({ [brand]: true as const });
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

/** A derived pointer follows the unchanged ordinary physical replay; runtime
 * full-width, material, access and returned-path checks still apply. */
export function applyOriginalStairBaseDerivedStandingArrival(
  data: IndoorDataset,
  token: AttachedOriginalStairBaseStanding,
  roomKey: string,
  physicalReplay: NativePhysicalCellReplay,
) {
  const state = attachments.get(token);
  if (!state || state.data !== data)
    throw new Error(
      "Live same-compiler original stair base attachment required.",
    );
  if (state.node.roomKey !== roomKey) return undefined;
  if (
    data.circulationGeometry !== state.geometry ||
    !state.geometry.cells.includes(state.cell) ||
    JSON.stringify(state.cell) !== state.cellJson ||
    JSON.stringify(state.node) !== state.nodeJson ||
    JSON.stringify(state.edge) !== state.edgeJson
  )
    throw new Error(
      "Source-qualified stair base attachment changed after its current-cell check.",
    );
  assertOriginalSourceStairBaseProposal(state.source, data);
  const records = data.records.filter((record) => record.key === roomKey);
  if (records.length !== 1)
    throw new Error("Original stair destination is missing or duplicated.");
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
