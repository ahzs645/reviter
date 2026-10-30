import type {
  IndoorDataset,
  IndoorEdge,
  IndoorNode,
  IndoorRecord,
} from "./indoor-contract.ts";

/** A source-graph diagnostic only. No part of this report admits a route. */
export type NativeGatewayRequest = {
  id: string;
  label: string;
  nativeDoorElementId: number;
  levelId?: number;
  expectedDoorId?: string;
  expectedRoomKeys?: [string, string];
};

export type NativeGatewayAuditRequest = {
  format: "reviter-native-gateway-audit-request";
  version: 1;
  sourceIndoorSha256: string;
  sourceModelSha256: string;
  sourceRoomsSha256: string;
  gateways: NativeGatewayRequest[];
  /** Expand by saved owner building tags, never by proximity or room names. */
  includeCrossBuildingOwners?: boolean;
};

type SourceDoor = NonNullable<IndoorDataset["doors"]>[number];
type Issue = { code: string; message: string };
type Approach = {
  edgeId: string;
  otherNodeId: string;
  otherRoomKey: string;
  incoming: boolean;
  outgoing: boolean;
  accessible: IndoorEdge["accessible"];
};
type RejectedApproach = { edgeId: string; reasons: string[] };
type Side = {
  nodeId: string;
  roomKey: string;
  pointFeet: IndoorNode["pointFeet"];
  incoming: boolean;
  outgoing: boolean;
  approaches: Approach[];
  rejectedApproaches: RejectedApproach[];
};

const shaPattern = /^[a-f0-9]{64}$/;
const validText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 1000;
const unique = <T>(values: T[]) => [...new Set(values)];
const sorted = (values: string[]) => [...values].sort();
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && sorted(a).every((v, i) => v === sorted(b)[i]);
const finitePoint = (point: unknown): point is [number, number, number] =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const samePoint = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);
const canTraverse = (edge: IndoorEdge, from: string, to: string) =>
  (edge.from === from && edge.to === to && edge.direction !== "to-from") ||
  (edge.to === from && edge.from === to && edge.direction !== "from-to");

function indexBy<T>(rows: T[], key: (row: T) => string) {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = index.get(id) ?? [];
    group.push(row);
    index.set(id, group);
  }
  return index;
}

export function validateNativeGatewayAuditRequest(
  value: unknown,
): asserts value is NativeGatewayAuditRequest {
  const request = value as NativeGatewayAuditRequest;
  if (
    !request ||
    request.format !== "reviter-native-gateway-audit-request" ||
    request.version !== 1 ||
    !shaPattern.test(request.sourceIndoorSha256) ||
    !shaPattern.test(request.sourceModelSha256) ||
    !shaPattern.test(request.sourceRoomsSha256) ||
    !Array.isArray(request.gateways) ||
    request.gateways.length > 1000 ||
    (request.includeCrossBuildingOwners !== undefined &&
      typeof request.includeCrossBuildingOwners !== "boolean") ||
    (!request.gateways.length && !request.includeCrossBuildingOwners)
  ) {
    throw new Error("Invalid native gateway audit request or source bindings.");
  }
  const identities = new Set<string>();
  const ids = new Set<string>();
  for (const item of request.gateways) {
    const identity = `${item?.nativeDoorElementId}:${item?.levelId ?? "any"}`;
    if (
      !item ||
      !validText(item.id) ||
      !validText(item.label) ||
      !Number.isSafeInteger(item.nativeDoorElementId) ||
      item.nativeDoorElementId <= 0 ||
      (item.levelId !== undefined && !Number.isSafeInteger(item.levelId)) ||
      (item.expectedDoorId !== undefined && !validText(item.expectedDoorId)) ||
      (item.expectedRoomKeys !== undefined &&
        (!Array.isArray(item.expectedRoomKeys) ||
          item.expectedRoomKeys.length !== 2 ||
          !item.expectedRoomKeys.every(validText) ||
          unique(item.expectedRoomKeys).length !== 2)) ||
      ids.has(item.id) ||
      identities.has(identity)
    ) {
      throw new Error("Invalid or repeated native gateway identity.");
    }
    ids.add(item.id);
    identities.add(identity);
  }
}

function ownerSummary(record: IndoorRecord) {
  return {
    key: record.key,
    number: record.number,
    name: record.name,
    building: record.building,
    levelId: record.levelId,
    elevationFeet: record.elevationFeet,
    circulation: record.circulation,
    stair: record.stair,
    access: record.access,
    walkable: record.walkable,
  };
}

/** The CLI supplies the SHA-256 of the actual complete source file. It also
 * checks the file, parsed value and implementation after this read-only call.
 * This helper examines saved identities/incidence, not physical clearance. */
export function auditNativeGateways(
  data: IndoorDataset,
  request: NativeGatewayAuditRequest,
  actualSourceIndoorSha256: string,
) {
  validateNativeGatewayAuditRequest(request);
  if (
    data?.format !== "reviter-indoor" ||
    data.version !== 1 ||
    actualSourceIndoorSha256 !== request.sourceIndoorSha256 ||
    data.source?.modelSha256 !== request.sourceModelSha256 ||
    data.source.roomsSha256 !== request.sourceRoomsSha256 ||
    ![data.records, data.nodes, data.edges, data.nativeLevels].every(
      Array.isArray,
    )
  ) {
    throw new Error("Native gateway source file/model/rooms binding mismatch.");
  }
  const records = indexBy(data.records, (record) => record.key);
  const nodes = indexBy(data.nodes, (node) => node.id);
  const edges = indexBy(data.edges, (edge) => edge.id);
  const doors = data.doors ?? [];
  const requests = [...request.gateways];
  const requestedDoors = new Set<SourceDoor>();
  for (const item of requests) {
    for (const door of doors) {
      if (
        door.nativeElementId === item.nativeDoorElementId &&
        (item.levelId === undefined || item.levelId === door.levelId)
      ) {
        if (requestedDoors.has(door)) {
          throw new Error("Two requests resolve to the same original doorway.");
        }
        requestedDoors.add(door);
      }
    }
  }
  const autoIdentities = new Set<string>();
  if (request.includeCrossBuildingOwners) {
    for (const door of doors) {
      const owners = door.roomKeys.flatMap((key) => records.get(key) ?? []);
      const identity = `${door.levelId}:${door.nativeElementId}`;
      if (
        !door.drawingBackedPatchId &&
        !requestedDoors.has(door) &&
        !autoIdentities.has(identity) &&
        owners.length >= 2 &&
        unique(owners.map((owner) => owner.building).filter(Boolean)).length > 1
      ) {
        const id = `cross-building:${identity}`;
        if (requests.some((item) => item.id === id)) {
          throw new Error(
            "Generated gateway request ID conflicts with an explicit request.",
          );
        }
        requests.push({
          id,
          label: `Saved owner-building doorway ${door.nativeElementId}`,
          nativeDoorElementId: door.nativeElementId,
          levelId: door.levelId,
        });
        autoIdentities.add(identity);
      }
    }
  }

  function sideApproaches(portal: IndoorNode, opposite: IndoorNode): Side {
    const approaches: Approach[] = [];
    const rejectedApproaches: RejectedApproach[] = [];
    for (const edge of data.edges) {
      if (
        edge.kind !== "walk" ||
        (edge.from !== portal.id && edge.to !== portal.id)
      )
        continue;
      const otherId = edge.from === portal.id ? edge.to : edge.from;
      const otherMatches = nodes.get(otherId) ?? [];
      const other = otherMatches[0];
      const reasons: string[] = [];
      if (!edge.enabled) reasons.push("DISABLED");
      if (edges.get(edge.id)?.length !== 1) reasons.push("AMBIGUOUS_EDGE_ID");
      if (otherMatches.length !== 1) reasons.push("MISSING_OR_AMBIGUOUS_NODE");
      if (otherId === portal.id) reasons.push("SELF_LOOP");
      if (otherId === opposite.id) reasons.push("PORTAL_BYPASS");
      if (!edge.roomKeys.includes(portal.roomKey))
        reasons.push("MISSING_SIDE_OWNER");
      if (![undefined, "both", "from-to", "to-from"].includes(edge.direction)) {
        reasons.push("INVALID_DIRECTION");
      }
      if (
        !other ||
        other.levelId !== portal.levelId ||
        !finitePoint(other.pointFeet) ||
        other.pointFeet[2] !== portal.pointFeet[2] ||
        !Array.isArray(edge.pointsFeet) ||
        edge.pointsFeet.length < 2 ||
        edge.pointsFeet.some(
          (point) => !finitePoint(point) || point[2] !== portal.pointFeet[2],
        )
      )
        reasons.push("WRONG_OR_MISSING_NATIVE_PLANE");
      const from = nodes.get(edge.from)?.[0];
      const to = nodes.get(edge.to)?.[0];
      if (
        !from ||
        !to ||
        !edge.pointsFeet?.length ||
        !samePoint(edge.pointsFeet[0], from.pointFeet) ||
        !samePoint(edge.pointsFeet.at(-1)!, to.pointFeet)
      )
        reasons.push("PATH_ENDPOINT_MISMATCH");
      if (
        !Number.isFinite(edge.lengthMetres) ||
        edge.lengthMetres <= 0 ||
        (other && samePoint(portal.pointFeet, other.pointFeet))
      )
        reasons.push("NO_MOVING_APPROACH");
      if (reasons.length) {
        rejectedApproaches.push({ edgeId: edge.id, reasons });
      } else {
        approaches.push({
          edgeId: edge.id,
          otherNodeId: otherId,
          otherRoomKey: other!.roomKey,
          incoming: canTraverse(edge, otherId, portal.id),
          outgoing: canTraverse(edge, portal.id, otherId),
          accessible: edge.accessible,
        });
      }
    }
    return {
      nodeId: portal.id,
      roomKey: portal.roomKey,
      pointFeet: [...portal.pointFeet],
      incoming: approaches.some((edge) => edge.incoming),
      outgoing: approaches.some((edge) => edge.outgoing),
      approaches,
      rejectedApproaches,
    };
  }

  const results = requests.map((item) => {
    const issues: Issue[] = [];
    const issue = (code: string, message: string) =>
      issues.push({ code, message });
    const matches = doors.filter(
      (door) =>
        door.nativeElementId === item.nativeDoorElementId &&
        (item.levelId === undefined || item.levelId === door.levelId),
    );
    let selected: SourceDoor | undefined;
    let crossing: IndoorEdge | undefined;
    let sides: Side[] = [];
    let forward = false;
    let reverse = false;
    if (matches.length !== 1) {
      issue(
        matches.length ? "SOURCE_DOOR_AMBIGUOUS" : "SOURCE_DOOR_MISSING",
        "Select exactly one original native doorway; coordinates do not resolve ownership.",
      );
    } else {
      selected = matches[0];
      const door = selected;
      if (
        !validText(door.id) ||
        doors.filter((entry) => entry.id === door.id).length !== 1
      ) {
        issue(
          "SOURCE_DOOR_ID_AMBIGUOUS",
          "The source doorway ID must be nonempty and unique.",
        );
      }
      if (
        data.nativeLevels.filter((level) => level.id === door.levelId)
          .length !== 1
      ) {
        issue(
          "SOURCE_NATIVE_LEVEL_MISSING_OR_AMBIGUOUS",
          "The doorway must retain one declared original native level.",
        );
      }
      if (door.drawingBackedPatchId) {
        issue(
          "DRAWING_DOOR_IS_NOT_NATIVE",
          "This identity is a drawing-backed synthetic door.",
        );
      }
      if (
        item.expectedDoorId !== undefined &&
        item.expectedDoorId !== door.id
      ) {
        issue(
          "SOURCE_DOOR_ID_MISMATCH",
          "The original saved doorway ID differs from the request.",
        );
      }
      if (door.state !== "connected") {
        issue(
          "SOURCE_OWNERSHIP_UNRESOLVED",
          `The original doorway state remains ${door.state}.`,
        );
      }
      const ownerKeys = unique(door.roomKeys);
      if (ownerKeys.length !== 2 || door.roomKeys.length !== 2) {
        issue(
          "SOURCE_OWNER_PAIR_MISSING",
          "Two distinct original owner keys are required.",
        );
      }
      for (const key of ownerKeys) {
        const owner = records.get(key) ?? [];
        if (owner.length !== 1 || owner[0].levelId !== door.levelId) {
          issue(
            "SOURCE_OWNER_MISSING_OR_AMBIGUOUS",
            `Owner ${key} is missing, repeated or on another native level.`,
          );
        }
      }
      if (
        item.expectedRoomKeys &&
        !sameSet(door.roomKeys, item.expectedRoomKeys)
      ) {
        issue(
          "SOURCE_OWNER_PAIR_MISMATCH",
          "The original owner pair differs from the explicit request.",
        );
      }
      const possible = data.edges.filter(
        (edge) =>
          edge.id === door.id ||
          (edge.kind === "door" &&
            edge.nativeElementId === door.nativeElementId),
      );
      if (possible.length > 1) {
        issue(
          "SAVED_CROSSING_AMBIGUOUS",
          "Multiple original edge IDs/aliases claim this native doorway.",
        );
      } else if (!possible.length) {
        issue(
          "SAVED_CROSSING_MISSING",
          "No saved crossing exists for this original native door.",
        );
      } else {
        crossing = possible[0];
        if (
          crossing.id !== door.id ||
          crossing.kind !== "door" ||
          crossing.nativeElementId !== door.nativeElementId
        )
          issue(
            "SAVED_CROSSING_IDENTITY_MISMATCH",
            "A differently named or typed edge cannot substitute for the original doorway crossing.",
          );
        if (!crossing.enabled)
          issue(
            "SAVED_CROSSING_DISABLED",
            "The original crossing remains held or disabled.",
          );
        if (!sameSet(crossing.roomKeys, door.roomKeys)) {
          issue(
            "SAVED_CROSSING_OWNER_MISMATCH",
            "The saved edge does not retain the original pair of owners.",
          );
        }
        if (
          ![undefined, "both", "from-to", "to-from"].includes(
            crossing.direction,
          )
        ) {
          issue(
            "SAVED_CROSSING_DIRECTION_INVALID",
            "The saved edge direction is unsupported.",
          );
        }
        const fromMatches = nodes.get(crossing.from) ?? [];
        const toMatches = nodes.get(crossing.to) ?? [];
        const from = fromMatches[0],
          to = toMatches[0];
        if (
          fromMatches.length !== 1 ||
          toMatches.length !== 1 ||
          crossing.from === crossing.to ||
          !from ||
          !to ||
          from.kind !== "portal" ||
          to.kind !== "portal" ||
          !sameSet([from.roomKey, to.roomKey], door.roomKeys)
        ) {
          issue(
            "SAVED_CROSSING_ENDPOINTS_INVALID",
            "Distinct original owner portals must identify both crossing endpoints.",
          );
        } else {
          const plane = from.pointFeet[2];
          if (
            from.levelId !== door.levelId ||
            to.levelId !== door.levelId ||
            !finitePoint(from.pointFeet) ||
            !finitePoint(to.pointFeet) ||
            to.pointFeet[2] !== plane ||
            records.get(from.roomKey)?.[0]?.elevationFeet !==
              from.pointFeet[2] ||
            records.get(to.roomKey)?.[0]?.elevationFeet !== to.pointFeet[2] ||
            !Array.isArray(crossing.pointsFeet) ||
            crossing.pointsFeet.length < 2 ||
            crossing.pointsFeet.some(
              (point) => !finitePoint(point) || point[2] !== plane,
            )
          )
            issue(
              "SAVED_CROSSING_NATIVE_PLANE_MISMATCH",
              "The original crossing is not on one unchanged native plane.",
            );
          if (
            !crossing.pointsFeet?.length ||
            !samePoint(crossing.pointsFeet[0], from.pointFeet) ||
            !samePoint(crossing.pointsFeet.at(-1)!, to.pointFeet) ||
            samePoint(from.pointFeet, to.pointFeet) ||
            !Number.isFinite(crossing.lengthMetres) ||
            crossing.lengthMetres <= 0
          )
            issue(
              "SAVED_CROSSING_GEOMETRY_INVALID",
              "The saved crossing must retain its exact distinct endpoint positions and moving path.",
            );
          sides = [sideApproaches(from, to), sideApproaches(to, from)];
          if (!issues.length) {
            forward =
              canTraverse(crossing, from.id, to.id) &&
              sides[0].incoming &&
              sides[1].outgoing;
            reverse =
              canTraverse(crossing, to.id, from.id) &&
              sides[1].incoming &&
              sides[0].outgoing;
            if (!forward || !reverse) {
              issue(
                "DIRECTED_APPROACH_INCOMPLETE",
                "The saved crossing and side walks do not supply both local travel directions.",
              );
            }
          }
        }
      }
    }
    return {
      request: item,
      sourceDoorMatches: matches.map((door) => ({
        id: door.id,
        nativeElementId: door.nativeElementId,
        levelId: door.levelId,
        state: door.state,
        pointFeet: [...door.pointFeet],
        roomKeys: [...door.roomKeys],
        hostWallNativeElementId: door.hostWallNativeElementId,
      })),
      owners:
        selected?.roomKeys.flatMap((key) =>
          (records.get(key) ?? []).map(ownerSummary),
        ) ?? [],
      ...(crossing
        ? {
            crossing: {
              id: crossing.id,
              nativeElementId: crossing.nativeElementId,
              from: crossing.from,
              to: crossing.to,
              enabled: crossing.enabled,
              direction: crossing.direction ?? "both",
              roomKeys: [...crossing.roomKeys],
              pointsFeet: crossing.pointsFeet.map((point) => [...point]),
              lengthMetres: crossing.lengthMetres,
              accessible: crossing.accessible,
              evidence: crossing.evidence,
            },
          }
        : {}),
      sides,
      directedLocalWitness: { fromTo: forward, toFrom: reverse },
      localBidirectionalWitness: forward && reverse,
      status: forward && reverse ? "LOCAL_TOPOLOGY_PRESENT" : "INCOMPLETE",
      issues,
      sourceIssues: (data.issues ?? [])
        .filter(
          (entry) =>
            entry.nativeElementId === item.nativeDoorElementId &&
            (item.levelId === undefined ||
              entry.levelId === undefined ||
              entry.levelId === item.levelId),
        )
        .map((entry) => ({ ...entry })),
      publicRouteApproved: false,
      stepFreeApproved: false,
    };
  });
  return {
    format: "reviter-native-gateway-audit" as const,
    version: 1 as const,
    sourceIndoorSha256: actualSourceIndoorSha256,
    source: { ...data.source },
    scope:
      "Original saved doorway ownership, same-plane crossing and directed local walk incidence only; no physical/public/step-free or complete-journey approval.",
    counts: {
      sourceDoorRecords: doors.length,
      originalNodes: data.nodes.length,
      originalEdges: data.edges.length,
      explicitRequests: request.gateways.length,
      autoCrossBuildingRequests: requests.length - request.gateways.length,
      checkedDoorIdentities: results.length,
      localBidirectionalWitnesses: results.filter(
        (result) => result.localBidirectionalWitness,
      ).length,
      incomplete: results.filter((result) => !result.localBidirectionalWitness)
        .length,
    },
    results,
    inventoryComplete: false,
    campusConnectivityProven: false,
    authorityGranted: false,
  };
}
