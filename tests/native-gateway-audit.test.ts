import assert from "node:assert/strict";
import test from "node:test";
import type {
  IndoorDataset,
  IndoorEdge,
  IndoorNode,
  IndoorRecord,
} from "../lib/reviter/indoor-contract.ts";
import {
  auditNativeGateways,
  type NativeGatewayAuditRequest,
} from "../lib/reviter/native-gateway-audit.ts";

const sourceHash = "a".repeat(64);
const request = (): NativeGatewayAuditRequest => ({
  format: "reviter-native-gateway-audit-request",
  version: 1,
  sourceIndoorSha256: sourceHash,
  sourceModelSha256: "b".repeat(64),
  sourceRoomsSha256: "c".repeat(64),
  gateways: [
    {
      id: "link",
      label: "Original native link",
      nativeDoorElementId: 42,
      levelId: 7,
    },
  ],
});
function fixture(): IndoorDataset {
  const record = (key: string, building: string): IndoorRecord => ({
    key,
    number: `${building}-101`,
    name: "Hallway",
    building,
    levelId: 7,
    elevationFeet: 10,
    elevationEvidence: "native floor",
    surfaceId: key,
    circulation: true,
    stair: false,
    access: "unknown",
    walkable: true,
    confidence: 1,
    ringsFeet: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ],
    properties: {},
  });
  const node = (
    id: string,
    roomKey: string,
    x: number,
    kind: IndoorNode["kind"],
  ): IndoorNode => ({
    id,
    roomKey,
    levelId: 7,
    building: roomKey === "a" ? "01" : "02",
    surfaceId: roomKey,
    pointFeet: [x, 0, 10],
    geographic: [0, 0],
    kind,
  });
  const nodes = [
    node("a-in", "a", -3, "arrival"),
    node("door:7:42:0", "a", -1, "portal"),
    node("door:7:42:1", "b", 1, "portal"),
    node("b-in", "b", 3, "arrival"),
  ];
  const edge = (
    id: string,
    from: IndoorNode,
    to: IndoorNode,
    kind: IndoorEdge["kind"],
  ): IndoorEdge => ({
    id,
    from: from.id,
    to: to.id,
    kind,
    roomKeys: [...new Set([from.roomKey, to.roomKey])],
    pointsFeet: [[...from.pointFeet], [...to.pointFeet]],
    lengthMetres: 0.6096,
    evidence: "original saved graph",
    enabled: true,
    accessible: "unknown",
    ...(kind === "door" ? { nativeElementId: 42 } : {}),
  });
  return {
    format: "reviter-indoor",
    version: 1,
    generator: "reviter/indoor-pipeline-1",
    source: {
      modelFileName: "original.rvt",
      modelSha256: "b".repeat(64),
      roomsSha256: "c".repeat(64),
    },
    alignment: {
      originFeet: [0, 0, 0],
      originGeographic: [0, 0],
      projectionLatitude: 0,
      rotationRadians: 0,
      horizontalMetresPerFoot: 0.3048,
      verticalMetresPerFoot: 0.3048,
      rmsMetres: 0,
      referenceCount: 2,
    },
    floors: [{ id: "floor", name: "Floor", levelIds: [7], elevationFeet: 10 }],
    nativeLevels: [{ id: 7, name: "Native floor", elevationFeet: 10 }],
    records: [record("a", "01"), record("b", "02")],
    nodes,
    edges: [
      edge("approach-a", nodes[0], nodes[1], "walk"),
      edge("door:7:42", nodes[1], nodes[2], "door"),
      edge("approach-b", nodes[2], nodes[3], "walk"),
    ],
    doors: [
      {
        id: "door:7:42",
        levelId: 7,
        nativeElementId: 42,
        pointFeet: [0, 0],
        footprintFeet: [
          [-1, -2],
          [1, -2],
          [1, 2],
          [-1, 2],
        ],
        roomKeys: ["a", "b"],
        state: "connected",
      },
    ],
    walls: [],
    issues: [],
    report: {
      recordCount: 2,
      routableArrivals: 2,
      components: 1,
      largestComponentArrivals: 2,
      unmatchedDoors: 0,
      cellSizeFeet: 0.6,
      omittedSourceLabels: 0,
    },
  };
}
const audit = (data = fixture(), value = request()) =>
  auditNativeGateways(data, value, sourceHash);
const codes = (data: IndoorDataset) =>
  audit(data).results[0].issues.map((issue) => issue.code);

test("an original crossing and both directed approaches give only a local topology witness", () => {
  const data = fixture(),
    before = JSON.stringify(data),
    report = audit(data);
  assert.equal(report.counts.localBidirectionalWitnesses, 1);
  assert.deepEqual(report.results[0].directedLocalWitness, {
    fromTo: true,
    toFrom: true,
  });
  assert.deepEqual(
    report.results[0].sides.map((side) => side.approaches.map((a) => a.edgeId)),
    [["approach-a"], ["approach-b"]],
  );
  assert.equal(report.results[0].crossing?.accessible, "unknown");
  assert.equal(report.results[0].publicRouteApproved, false);
  assert.equal(report.results[0].stepFreeApproved, false);
  assert.equal(report.authorityGranted, false);
  assert.equal(report.campusConnectivityProven, false);
  assert.equal(JSON.stringify(data), before);
});

test("changed complete-source, model and room bindings are rejected", () => {
  for (const key of [
    "sourceIndoorSha256",
    "sourceModelSha256",
    "sourceRoomsSha256",
  ] as const) {
    assert.throws(
      () => audit(fixture(), { ...request(), [key]: "d".repeat(64) }),
      /binding mismatch/,
    );
  }
});

test("an unmatched single owner remains unresolved even when a nearby crossing exists", () => {
  const data = fixture();
  data.doors![0].state = "unmatched";
  data.doors![0].roomKeys = ["a"];
  const result = audit(data).results[0];
  assert.equal(result.localBidirectionalWitness, false);
  assert(
    result.issues.some((issue) => issue.code === "SOURCE_OWNERSHIP_UNRESOLVED"),
  );
  assert.deepEqual(data.doors![0].roomKeys, ["a"]);
});

test("duplicate source doors and multiple saved crossing aliases are refused", () => {
  const duplicate = fixture();
  duplicate.doors!.push(structuredClone(duplicate.doors![0]));
  assert(codes(duplicate).includes("SOURCE_DOOR_AMBIGUOUS"));
  const alias = fixture();
  alias.edges.push({ ...alias.edges[1], id: "alias-door" });
  assert(codes(alias).includes("SAVED_CROSSING_AMBIGUOUS"));
  assert.equal(audit(alias).results[0].localBidirectionalWitness, false);
});

test("a lone alias or changed native identity cannot replace the original crossing", () => {
  for (const change of [
    { id: "alias-door" },
    { nativeElementId: 43 },
    { kind: "opening" as const },
  ]) {
    const data = fixture();
    Object.assign(data.edges[1], change);
    assert(codes(data).includes("SAVED_CROSSING_IDENTITY_MISMATCH"));
    assert.equal(audit(data).results[0].localBidirectionalWitness, false);
  }
});

test("held crossings and another native plane remain refused", () => {
  const held = fixture();
  held.edges[1].enabled = false;
  assert(codes(held).includes("SAVED_CROSSING_DISABLED"));
  const wrongPlane = fixture();
  wrongPlane.nodes[2].levelId = 8;
  assert(codes(wrongPlane).includes("SAVED_CROSSING_NATIVE_PLANE_MISMATCH"));
  const wrongHeight = fixture();
  wrongHeight.edges[1].pointsFeet.splice(1, 0, [0, 0, 11]);
  assert(codes(wrongHeight).includes("SAVED_CROSSING_NATIVE_PLANE_MISMATCH"));
  const missing = fixture();
  missing.nativeLevels = [];
  assert(codes(missing).includes("SOURCE_NATIVE_LEVEL_MISSING_OR_AMBIGUOUS"));
  const movedPlane = fixture();
  for (const node of movedPlane.nodes) node.pointFeet[2] = 11;
  for (const edge of movedPlane.edges)
    for (const point of edge.pointsFeet) point[2] = 11;
  assert(codes(movedPlane).includes("SAVED_CROSSING_NATIVE_PLANE_MISMATCH"));
});

test("crossing owners, exact endpoint positions and portal identity must agree", () => {
  const owners = fixture();
  owners.edges[1].roomKeys = ["a", "a"];
  assert(codes(owners).includes("SAVED_CROSSING_OWNER_MISMATCH"));
  const moved = fixture();
  moved.edges[1].pointsFeet[0][0] -= 0.01;
  assert(codes(moved).includes("SAVED_CROSSING_GEOMETRY_INVALID"));
  const portal = fixture();
  portal.nodes[2].kind = "arrival";
  assert(codes(portal).includes("SAVED_CROSSING_ENDPOINTS_INVALID"));
});

test("disabled and wrong-plane walks cannot qualify an approach", () => {
  const held = fixture();
  held.edges[0].enabled = false;
  const a = audit(held).results[0];
  assert.equal(a.localBidirectionalWitness, false);
  assert(a.sides[0].rejectedApproaches[0].reasons.includes("DISABLED"));
  const different = fixture();
  different.nodes[0].pointFeet[2] = 11;
  different.edges[0].pointsFeet[0][2] = 11;
  const b = audit(different).results[0];
  assert.equal(b.localBidirectionalWitness, false);
  assert(
    b.sides[0].rejectedApproaches[0].reasons.includes(
      "WRONG_OR_MISSING_NATIVE_PLANE",
    ),
  );
});

test("a portal bypass or self-loop is not an independent walking approach", () => {
  const data = fixture(),
    crossing = data.edges[1];
  data.edges = [
    crossing,
    { ...crossing, id: "bypass", kind: "walk" },
    {
      ...crossing,
      id: "self",
      kind: "walk",
      to: crossing.from,
      pointsFeet: [crossing.pointsFeet[0], crossing.pointsFeet[0]],
    },
  ];
  const result = audit(data).results[0];
  assert.equal(result.localBidirectionalWitness, false);
  assert(
    result.sides[0].rejectedApproaches.some((edge) =>
      edge.reasons.includes("PORTAL_BYPASS"),
    ),
  );
  assert(
    result.sides[0].rejectedApproaches.some((edge) =>
      edge.reasons.includes("SELF_LOOP"),
    ),
  );
});

test("directional approaches and crossings report each local direction separately", () => {
  const data = fixture();
  data.edges[0].direction = "from-to";
  let result = audit(data).results[0];
  assert.deepEqual(result.directedLocalWitness, {
    fromTo: true,
    toFrom: false,
  });
  assert.equal(result.localBidirectionalWitness, false);
  const oneWay = fixture();
  oneWay.edges[1].direction = "to-from";
  result = audit(oneWay).results[0];
  assert.deepEqual(result.directedLocalWitness, {
    fromTo: false,
    toFrom: true,
  });
});

test("cross-building tag expansion retains unsupported/staff identities without double counting", () => {
  const data = fixture();
  data.records[1].access = "staff";
  data.doors!.push({ ...data.doors![0], id: "door:7:43", nativeElementId: 43 });
  const report = audit(data, {
    ...request(),
    includeCrossBuildingOwners: true,
  });
  assert.equal(report.counts.checkedDoorIdentities, 2);
  assert.equal(report.counts.autoCrossBuildingRequests, 1);
  assert.equal(report.counts.incomplete, 1);
  assert.equal(report.results[0].owners[1].access, "staff");
  assert.equal(report.results[0].publicRouteApproved, false);
});

test("explicit expectations and duplicate resolved requests cannot change source identity", () => {
  const expected = request();
  expected.gateways[0].expectedRoomKeys = ["a", "other"];
  assert(
    audit(fixture(), expected).results[0].issues.some(
      (issue) => issue.code === "SOURCE_OWNER_PAIR_MISMATCH",
    ),
  );
  const repeat = request();
  repeat.gateways.push({
    ...repeat.gateways[0],
    id: "second",
    levelId: undefined,
  });
  assert.throws(() => audit(fixture(), repeat), /same original doorway/);
});

test("cross-building expansion retains three-way ambiguous ownership candidates", () => {
  const data = fixture();
  data.records.push({
    ...data.records[1],
    key: "c",
    number: "02-102",
    access: "staff",
  });
  data.doors!.push({
    ...data.doors![0],
    id: "door:7:43",
    nativeElementId: 43,
    roomKeys: ["a", "b", "c"],
    state: "ambiguous",
  });
  const report = audit(data, {
    ...request(),
    includeCrossBuildingOwners: true,
  });
  assert.equal(report.counts.checkedDoorIdentities, 2);
  assert.equal(report.counts.localBidirectionalWitnesses, 1);
  const unresolved = report.results[1];
  assert.equal(unresolved.owners.length, 3);
  assert.equal(unresolved.localBidirectionalWitness, false);
  assert(
    unresolved.issues.some(
      (issue) => issue.code === "SOURCE_OWNERSHIP_UNRESOLVED",
    ),
  );
  assert(
    unresolved.issues.some(
      (issue) => issue.code === "SOURCE_OWNER_PAIR_MISSING",
    ),
  );
});
