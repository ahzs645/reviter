import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import {
  assertStairBaseIdentityFieldsPreserved,
  assertStairBaseProposalFieldsPreserved,
  type OriginalStairBaseProposalFields,
  type OriginalStairBaseIdentityFields,
} from "../lib/reviter/native-source-stair-base-identity-guard.ts";
import {
  bindOriginalSourceStairBaseCompilerInput,
  assertOriginalSourceStairBaseIdentityPreserved,
  assertOriginalSourceStairBaseProposal,
  type OriginalSourceStairBaseStanding,
} from "../lib/reviter/native-source-stair-base-standing.ts";

import { assertOriginalStairBaseCompilerSession } from "../lib/reviter/indoor-pipeline.ts";
import type { RoomDirectoryData } from "../lib/reviter/room-directory.ts";
const compilerRoomsSha256 = "c".repeat(64);

// Synthetic identity/math comparisons. No fixture mints a source capability.
function fixture() {
  const model = "a".repeat(64),
    rooms = "b".repeat(64),
    own = {
      key: "own",
      arrivalNodeId: "arrival:own",
      levelId: 1,
      surfaceId: "floor",
      building: "05",
      elevationFeet: 0,
      access: "unknown",
      walkable: true,
      stair: true,
    },
    corridor = {
      key: "hall",
      arrivalNodeId: "arrival:hall",
      levelId: 1,
      surfaceId: "floor",
      building: "05",
      elevationFeet: 0,
      access: "unknown",
      walkable: true,
      circulation: true,
    },
    seed = {
      id: "arrival:own",
      roomKey: "own",
      levelId: 1,
      surfaceId: "floor",
      building: "05",
      kind: "arrival",
      pointFeet: [0, 0, 0],
      geographic: [0, 0],
    },
    terminal = { ...seed, id: "stairs:own", kind: "stair" },
    anchor = {
      ...seed,
      id: "arrival:hall",
      roomKey: "hall",
      pointFeet: [-4, 0, 0],
    },
    held = {
      id: "held",
      kind: "stairs",
      from: terminal.id,
      to: "upper",
      roomKeys: ["own", "upper"],
      nativeElementId: 10,
      enabled: false,
      accessible: "no",
      pointsFeet: [
        [0, 0, 0],
        [0, 0, 10],
      ],
      lengthMetres: 3,
      evidence: "Original preserved held source edge",
    },
    level = { id: 1, name: "Main", elevationFeet: 0 },
    node = { ...seed, id: "new", pointFeet: [2, 0, 0] },
    edge = {
      id: "new-approach",
      kind: "walk",
      from: anchor.id,
      to: node.id,
      pointsFeet: [
        [-4, 0, 0],
        [2, 0, 0],
      ],
      accessible: "unknown",
      enabled: false,
    };
  const proof = {
    original: {
      sourceModelSha256: model,
      sourceRoomsSha256: rooms,
      room: own,
      seed,
      terminal,
      heldEdge: held,
      nativeLevel: level,
      approach: { node: anchor, room: corridor },
    },
    proposedNode: node,
    proposedApproach: edge,
    nativeFloorElementId: 50,
  } as unknown as OriginalStairBaseProposalFields;
  const data = {
    source: { modelSha256: model, roomsSha256: compilerRoomsSha256 },
    records: [structuredClone(own), structuredClone(corridor)],
    nodes: [seed, terminal, anchor, node].map((n) => structuredClone(n)),
    nativeLevels: [level],
    edges: [
      structuredClone(held),
      {
        id: "fresh-current-corridor",
        kind: "walk",
        from: anchor.id,
        to: "other",
        enabled: true,
      },
      {
        ...structuredClone(edge),
        nativeCellId: "cell",
        roomKeys: ["foreign", "hall", "own"],
        enabled: true,
      },
    ],
    circulationGeometry: {
      sourceModelSha256: model,
      cells: [
        {
          id: "cell",
          roomKeys: ["foreign", "hall"],
          nativeFloorIds: [50],
          levelIds: [1],
          elevationFeet: 0,
        },
      ],
    },
  } as unknown as IndoorDataset;
  return { proof: structuredClone(proof), data };
}
test("original identity permits a missing exact derived seed pointer and accepts rebuilt corridor walk IDs", () => {
  const { proof, data } = fixture();
  assertStairBaseIdentityFieldsPreserved(proof.original, data, compilerRoomsSha256);
  delete data.records[0]!.arrivalNodeId;
  assertStairBaseIdentityFieldsPreserved(proof.original, data, compilerRoomsSha256);
  assert.equal(
    assertStairBaseProposalFieldsPreserved(proof, data, compilerRoomsSha256).routeApproved,
    false,
  );
  assert.deepEqual(data.circulationGeometry!.cells[0]!.roomKeys, [
    "foreign",
    "hall",
  ]);
});
test("record, node, held-edge, source and native-level mutation each refuse", () => {
  const changes: ((data: IndoorDataset) => void)[] = [
    (d) => {
      d.records[0]!.arrivalNodeId = "other-pointer";
    },
    (d) => {
      d.records[0]!.access = "public";
    },
    (d) => {
      d.records[1]!.access = "public";
    },
    (d) => {
      d.nodes[0]!.pointFeet[0]++;
    },
    (d) => {
      d.nodes[1]!.kind = "arrival";
    },
    (d) => {
      d.nodes[2]!.pointFeet[0]++;
    },
    (d) => {
      d.edges[0]!.enabled = true;
    },
    (d) => {
      d.edges[0]!.notes = "changed held edge";
    },
    (d) => {
      d.source.roomsSha256 = "b".repeat(64);
    },
    (d) => {
      d.nativeLevels[0]!.elevationFeet++;
    },
  ];
  for (const change of changes) {
    const { proof, data } = fixture();
    change(data);
    assert.throws(() =>
      assertStairBaseIdentityFieldsPreserved(proof.original, data, compilerRoomsSha256),
    );
  }
});
test("exact source path and all cell owners plus stair demand are required, without adding a cell owner", () => {
  const changes: ((data: IndoorDataset) => void)[] = [
    (d) => {
      d.nodes[3]!.pointFeet[0]++;
    },
    (d) => {
      d.nodes[3]!.surfaceId = "other";
    },
    (d) => {
      d.edges[2]!.pointsFeet[0]![0]++;
    },
    (d) => {
      d.edges[2]!.roomKeys = ["hall", "own"];
    },
    (d) => {
      d.edges[2]!.roomKeys.push("own");
    },
    (d) => {
      d.edges[2]!.accessible = "yes";
    },
    (d) => {
      d.edges[2]!.direction = "from-to";
    },
    (d) => {
      d.edges[1]!.enabled = false;
    },
    (d) => {
      d.circulationGeometry!.cells[0]!.nativeFloorIds = [51];
    },
    (d) => {
      d.circulationGeometry!.cells[0]!.roomKeys.push("hall");
    },
  ];
  for (const change of changes) {
    const { proof, data } = fixture();
    change(data);
    assert.throws(() => assertStairBaseProposalFieldsPreserved(proof, data, compilerRoomsSha256));
  }
});
test("detached or forged facts cannot enter live source identity/proposal APIs", () => {
  const { data } = fixture(),
    forged = {} as OriginalSourceStairBaseStanding;
  assert.throws(() =>
    assertOriginalSourceStairBaseIdentityPreserved(forged, data),
  );
  assert.throws(() => assertOriginalSourceStairBaseProposal(forged, data));
});

test("raw source-room and normalized compiler digest domains remain distinct", () => {
  const {proof, data} = fixture();
  assert.notEqual(proof.original.sourceRoomsSha256, compilerRoomsSha256);
  assertStairBaseIdentityFieldsPreserved(proof.original, data, compilerRoomsSha256);
  assert.throws(() => assertStairBaseIdentityFieldsPreserved(
    proof.original, data, proof.original.sourceRoomsSha256!));
  assert.throws(() => assertStairBaseIdentityFieldsPreserved(proof.original, data, ""));
});
test("matching checksums and saved identity cannot register arbitrary or copied compiler datasets", () => {
  const {data} = fixture();
  const forged = {sourceModelSha256: data.source.modelSha256,
    sourceCensusSha256: "d".repeat(64), roomKey: "own"} as OriginalSourceStairBaseStanding;
  for (const current of [data, structuredClone(data), JSON.parse(JSON.stringify(data))]) {
    assert.throws(() => assertOriginalStairBaseCompilerSession(
      forged, current, compilerRoomsSha256), /Live same-dataset/);
    assert.throws(() => bindOriginalSourceStairBaseCompilerInput(
      forged, current, {} as RoomDirectoryData), /Live complete/);
    assert.throws(() => assertOriginalSourceStairBaseIdentityPreserved(forged, current), /Live original/);
  }
});

// These seven original/current objects are the literal bounded extraction from
// original4f and the failed retry002 pre-plane mathematical snapshot. They
// exercise identity only and cannot mint a native source/compiler capability.
function observedOriginal05Identity() {
  return JSON.parse(readFileSync(new URL(
    "./fixtures/native-original05-preplane-identity.json", import.meta.url,
  ), "utf8")) as {
    original: OriginalStairBaseIdentityFields;
    current: IndoorDataset;
    expectedCurrentCompilerRoomsSha256: string;
  };
}
test("actual05 pre-plane missing exact corridor arrival pointer passes identity without inserting either pointer or approving routes", () => {
  const observed = observedOriginal05Identity(),
    before = JSON.stringify(observed);
  assert.equal(Object.hasOwn(observed.current.records[0]!, "arrivalNodeId"), false);
  assert.equal(Object.hasOwn(observed.current.records[1]!, "arrivalNodeId"), false);
  assert.deepEqual(assertStairBaseIdentityFieldsPreserved(
    observed.original, observed.current, observed.expectedCurrentCompilerRoomsSha256,
  ), {originalIdentityPreserved: true, sourceAuthorityGranted: false, routeApproved: false});
  assert.equal(JSON.stringify(observed), before);
});
test("actual05 transient pointer comparison still refuses changed corridor pointer, node, geometry, owner, access, held edge and level", () => {
  const changes: ((observed: ReturnType<typeof observedOriginal05Identity>) => void)[] = [
    ({current}) => { current.records[1]!.arrivalNodeId = "different-arrival"; },
    ({current}) => { current.records[1]!.arrivalNodeId = null as unknown as string; },
    ({current}) => { current.records[1]!.ringsFeet[0]![0]![0]++; },
    ({current}) => { current.records[1]!.properties.extra = "changed original corridor metadata"; },
    ({current}) => { current.records[1]!.access = "public"; },
    ({current}) => { current.records[1]!.levelId++; },
    ({current}) => { current.nodes[2]!.pointFeet[0]++; },
    ({current}) => { current.nodes[2]!.roomKey = "another-owner"; },
    ({current}) => { current.nodes[2]!.levelId++; },
    ({current}) => { current.nodes[0]!.pointFeet[0]++; },
    ({current}) => { current.nodes[1]!.kind = "arrival"; },
    ({current}) => { current.edges[0]!.enabled = true; },
    ({current}) => { current.edges[0]!.notes = "changed original held edge"; },
    ({current}) => { current.nativeLevels[0]!.name = "different original level"; },
    ({current}) => { current.records[0]!.access = "public"; },
    ({original}) => { original.approach!.room.arrivalNodeId = "different-original-pointer"; },
  ];
  for (const change of changes) {
    const observed = observedOriginal05Identity();
    change(observed);
    const before = JSON.stringify(observed);
    assert.throws(() => assertStairBaseIdentityFieldsPreserved(
      observed.original, observed.current, observed.expectedCurrentCompilerRoomsSha256,
    ));
    assert.equal(JSON.stringify(observed), before);
  }
});
test("restoring the exact original corridor pointer remains valid while removing it never selects a different anchor", () => {
  const observed = observedOriginal05Identity();
  observed.current.records[1]!.arrivalNodeId = observed.original.approach!.node.id;
  assert.equal(assertStairBaseIdentityFieldsPreserved(observed.original,
    observed.current, observed.expectedCurrentCompilerRoomsSha256).routeApproved, false);
  delete observed.current.records[1]!.arrivalNodeId;
  observed.current.nodes[2]!.id = "different-corridor-node";
  assert.throws(() => assertStairBaseIdentityFieldsPreserved(observed.original,
    observed.current, observed.expectedCurrentCompilerRoomsSha256), /missing\/duplicated/);
});
