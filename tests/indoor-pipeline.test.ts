import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareIndoorDataset,
  sha256Bytes,
} from "../lib/reviter/indoor-pipeline.ts";
import {
  createProjectPackage,
  readProjectPackage,
} from "../lib/reviter/project-package.ts";
import type {
  RoomDirectoryData,
  DirectoryRoom,
} from "../lib/reviter/room-directory.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
const modelFile = new File(["original"], "Synthetic.rvt");
const model = {
  fileName: modelFile.name,
  origin: { x: 0, y: 0, z: 0 },
  levels: [
    { levelId: 1, elevation: 0, candidates: 1, name: "Floor 1" },
    { levelId: 2, elevation: 10, candidates: 1, name: "Floor 2" },
  ],
  elementBounds: [],
  nativeAssociatedLevelRelations: [
    { elementId: 100, levelId: 1 },
    { elementId: 200, levelId: 2 },
  ],
  nativeStairAssemblies: [],
} as unknown as ConvertResult;
const room = (key: string, x: number, levelId = 1): DirectoryRoom => ({
  key,
  number: key,
  building: "01",
  name: "Corridor",
  levelId,
  confidence: 1,
  polygonFeet: [
    [x, 0],
    [x + 10, 0],
    [x + 10, 10],
    [x, 10],
  ],
  labelPointFeet: [x + 5, 5],
});
const data: RoomDirectoryData = {
  format: "reviter-room-annotations",
  version: 1,
  coordinateSystem: "revit-model-feet",
  model: { fileName: modelFile.name },
  annotations: [room("a", 0), room("b", 10), room("upper", 0, 2)],
  georeference: {
    format: "reviter-georeference",
    version: 1,
    modelFileName: modelFile.name,
    coordinateSystem: "WGS84",
    method: "fixed-scale",
    points: [
      {
        id: "p",
        name: "Origin",
        modelFeet: [0, 0],
        levelId: 1,
        geographic: { longitude: -122, latitude: 53 },
      },
      {
        id: "q",
        name: "Second",
        modelFeet: [100, 0],
        levelId: 1,
        geographic: { longitude: -121.999545, latitude: 53 },
      },
    ],
  },
};
test("prepared v2 archive binds graph to original bytes and exact room reviews", async () => {
  const hash = await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer())),
    indoor = await prepareIndoorDataset(model, data, hash);
  const result = await readProjectPackage(
    await createProjectPackage(modelFile, data, { indoor }),
  );
  assert.equal(result.manifest.version, 2);
  assert.deepEqual(result.indoor, JSON.parse(JSON.stringify(indoor)));
  assert.deepEqual(result.rooms, data);
  assert.equal(await result.model.text(), "original");
  await assert.rejects(
    createProjectPackage(
      modelFile,
      { ...data, annotations: [...data.annotations, room("added", 20)] },
      { indoor },
    ),
    /stale/,
  );
});
test("campus display grouping does not connect coincident rooms on native floors", async () => {
  const d = await prepareIndoorDataset(
    model,
    {
      ...data,
      campusStoreys: [
        {
          id: "same-storey",
          name: "Campus first floor",
          levelIds: [1, 2],
          evidence: "user-reported",
        },
      ],
    },
    "a".repeat(64),
  );
  assert.equal(d.floors.length, 1);
  assert.ok(d.edges.length > 0);
  assert.ok(
    d.edges.every(
      (e) =>
        d.nodes.find((n) => n.id === e.from)!.levelId ===
        d.nodes.find((n) => n.id === e.to)!.levelId,
    ),
  );
  assert.ok(
    d.issues.some(
      (i) => i.roomKey === "upper" && i.code === "isolated-arrival",
    ),
  );
});
test("metadata review names do not change original circulation classification on regeneration", async () => {
  const reviews = {
    version: 1,
    records: {
      a: { name: "New display name", notes: "Preserve source label" },
    },
    edges: {},
  };
  const d = await prepareIndoorDataset(
    model,
    { ...data, indoorReviews: reviews },
    "a".repeat(64),
  );
  assert.equal(d.records.find((r) => r.key === "a")!.name, "New display name");
  assert.equal(d.records.find((r) => r.key === "a")!.circulation, true);
  assert.equal(data.annotations[0]!.name, "Corridor");
});
test("accessibility reviews require unchanged endpoint geometry when regenerated", async () => {
  const hash = "a".repeat(64),
    first = await prepareIndoorDataset(model, data, hash),
    e = first.edges[0]!;
  const reviews = {
    version: 1,
    records: {},
    edges: {
      [e.id]: {
        accessible: "yes",
        geometryKey: JSON.stringify([
          hash,
          e.from,
          e.to,
          e.roomKeys,
          e.pointsFeet,
        ]),
      },
    },
  };
  const again = await prepareIndoorDataset(
    model,
    { ...data, indoorReviews: reviews },
    hash,
  );
  assert.equal(again.edges.find((x) => x.id === e.id)!.accessible, "yes");
  const stale = await prepareIndoorDataset(
    model,
    {
      ...data,
      indoorReviews: {
        ...reviews,
        edges: { [e.id]: { accessible: "yes", geometryKey: "stale" } },
      },
    },
    hash,
  );
  assert.equal(stale.edges.find((x) => x.id === e.id)!.accessible, "unknown");
  assert.ok(stale.issues.some((i) => i.code === "connection-review-stale"));
});

test("prepared display retains precise unmatched native doors without authorizing links", async () => {
  const door = {
    elementId: 100,
    categoryId: -2000023,
    boundsFeet: { min: { x: 40, y: 40, z: 0 }, max: { x: 44, y: 41, z: 8 } },
    orientedBox: [
      [40, 40, 0],
      [44, 40, 0],
      [44, 41, 0],
      [40, 41, 0],
    ],
  };
  const d = await prepareIndoorDataset(
    { ...model, elementBounds: [door] } as unknown as ConvertResult,
    data,
    await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer())),
  );
  assert.equal(d.doors?.length, 1);
  assert.equal(d.doors![0]!.nativeElementId, 100);
  assert.equal(d.doors![0]!.levelId, 1);
  assert.deepEqual(d.doors![0]!.pointFeet, [42, 40.5]);
  assert.equal(d.doors![0]!.footprintFeet?.length, 4);
  assert.equal(d.doors![0]!.state, "unmatched");
  assert.equal(d.edges.filter((e) => e.kind === "door").length, 0);
});

test("native columns are classified separately from walls in portable display geometry", async () => {
  const elementBounds = [
    {
      elementId: 100,
      categoryId: -2000100,
      boundsFeet: { min: { x: 4, y: 4, z: 0 }, max: { x: 6, y: 6, z: 8 } },
    },
    {
      elementId: 200,
      categoryId: -2000011,
      boundsFeet: {
        min: { x: 9.9, y: 0, z: 0 },
        max: { x: 10.1, y: 10, z: 8 },
      },
    },
  ];
  const hash = await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const indoor = await prepareIndoorDataset(
    { ...model, elementBounds } as unknown as ConvertResult,
    data,
    hash,
  );
  assert.equal(
    indoor.walls.find((w) => w.nativeElementId === 100)!.kind,
    "column",
  );
  assert.equal(
    indoor.walls.find((w) => w.nativeElementId === 200)!.kind,
    "wall",
  );
  assert.equal(indoor.walls.find((w) => w.nativeElementId === 200)!.approximate, true);
  const result = await readProjectPackage(
    await createProjectPackage(modelFile, data, { indoor }),
  );
  assert.deepEqual(result.indoor!.walls, indoor.walls);
});

test('explicit reviewed lift connects actual native floor entrances and survives prepared archive',async()=>{
  const hash=await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const nativeModel={...model,elementBounds:[900,100,200].map(elementId=>({elementId,boundsFeet:{min:{x:0,y:0,z:0},max:{x:1,y:1,z:20}}}))} as unknown as ConvertResult;
  const reviewed:RoomDirectoryData={...data,indoorConnectors:{version:1,modelSha256:hash,connectors:[{id:'lift',kind:'elevator',nativeElementId:900,evidence:'Reviewed native lift entrance elements',accessible:'unknown',direction:'both',entrances:[{roomKey:'a',levelId:1,nativeElementId:100,pointFeet:[5,5]},{roomKey:'upper',levelId:2,nativeElementId:200,pointFeet:[5,5]}]}]}};
  const prepared=await prepareIndoorDataset(nativeModel,reviewed,hash);
  assert.equal(prepared.connectors?.length,1);
  const transfer=prepared.edges.find(e=>e.kind==='walk'&&e.lengthMetres===0&&e.from.includes('arrival:')&&e.to.includes('connector:'));
  assert.ok(transfer, 'coincident arrival and lift entrance retain an explicit identity transfer');
  assert.equal(transfer.accessible,'yes');
  assert.match(transfer.evidence,/stationary node identity transfer/);
  assert.ok(prepared.edges.filter(e=>e.kind==='walk'&&e.lengthMetres>0).every(e=>e.accessible==='unknown'),'physical walking branches retain unverified accessibility');
  const lift=prepared.edges.find(e=>e.kind==='elevator');assert.ok(lift);assert.equal(lift.connectorId,'lift');assert.equal(lift.direction,'both');
  assert.equal(prepared.nodes.find(n=>n.id===lift.to)?.levelId,2);
  const archive=await readProjectPackage(await createProjectPackage(modelFile,reviewed,{indoor:prepared}));assert.deepEqual(archive.rooms.indoorConnectors,reviewed.indoorConnectors);assert.deepEqual(archive.indoor?.connectors,prepared.connectors);
});

test("a native doorway cannot bridge a source floor opening between two safe side anchors", async () => {
  const door={elementId:100,categoryId:-2000023,boundsFeet:{min:{x:9.9,y:4,z:0},max:{x:10.1,y:6,z:8}},orientedBox:[[9.9,4,0],[10.1,4,0],[10.1,6,0],[9.9,6,0]]};
  const nativeModel={...model,elementBounds:[door]} as unknown as ConvertResult;
  const a={...room("a",0),polygonFeet:[[0,0],[9.9,0],[9.9,10],[0,10]] as [number,number][]};
  const b={...room("b",10.1),polygonFeet:[[10.1,0],[20,0],[20,10],[10.1,10]] as [number,number][]};
  const hash=await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const baseline=await prepareIndoorDataset(nativeModel,{...data,annotations:[a,b]},hash);
  assert.ok(baseline.edges.some(e=>e.kind==='door'));
  const hole:[[number,number],[number,number],[number,number],[number,number]]=[[9.97,4.5],[10.03,4.5],[10.03,5.5],[9.97,5.5]];
  const blocked=await prepareIndoorDataset(nativeModel,{...data,annotations:[{...a,floorOpeningsFeet:[hole]},{...b,floorOpeningsFeet:[hole]}]},hash);
  assert.equal(blocked.edges.filter(e=>e.kind==='door').length,0);
  assert.ok(blocked.issues.some(i=>i.code==='connection-void'));
  assert.equal(blocked.doors![0].state,'connected',"native threshold remains in inventory for explicit source review");
});

test("regeneration connects a registered doorless open front with source proof and retains unknown access", async () => {
  const floor = { elementId: 100, categoryId: -2000032, boundsFeet: { min: { x: 0, y: 0, z: -.5 }, max: { x: 21, y: 10, z: 0 } }, loops: [[[0,0,0],[21,0,0],[21,10,0],[0,10,0]]] };
  const nativeModel = { ...model, elementBounds: [floor] } as unknown as ConvertResult;
  const service: DirectoryRoom = { ...room("service",0),name:"Library Services Desk",dwg:{sectionId:"01 floor"} };
  const hall: DirectoryRoom = { ...room("hall",10.4),dwg:{sectionId:"01 floor"} };
  const source: RoomDirectoryData = { ...data, annotations:[service,hall], boundaryReference:{format:"reviter-boundary-reference",version:1,coordinateSystem:"revit-model-feet",sourceSha256:"drawing",sections:[{sectionId:"01 floor",levelId:1,registrationErrorFeet:0,wallSegments:[],doorSegments:[]}]} };
  const hash=await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const prepared=await prepareIndoorDataset(nativeModel,source,hash),opening=prepared.edges.find(e=>e.kind==="opening");
  assert.ok(opening);assert.ok(prepared.records.find(r=>r.key==="service")?.arrivalNodeId);
  assert.match(opening.evidence,/recovered registered source open front.*widthFeet=2.*continuously native-floor-covered/);
  assert.equal(opening.accessible,"unknown");assert.equal(prepared.records.find(r=>r.key==="service")?.access,"unknown");
  assert.ok(prepared.issues.some(i=>i.code==="recovered-open-front"&&i.roomKey==="service"));
  assert.equal(prepared.edges.some(e=>e.kind==="door"),false);
  const preserved=await readProjectPackage(await createProjectPackage(modelFile,source,{indoor:prepared}));
  assert.equal(preserved.indoor!.edges.find(e=>e.id===opening.id)?.evidence,opening.evidence);
  const absentFloor=await prepareIndoorDataset(model,source,hash);
  assert.equal(absentFloor.records.find(r=>r.key==="service")?.arrivalNodeId,undefined);
});


test("confirmed through-navigation reviews survive regeneration only with matching room geometry", async () => {
  const input = { ...data, annotations: data.annotations.map(r => r.key === "a" ? { ...r, name: "Reception" } : r) };
  const hash = "a".repeat(64);
  const original = await prepareIndoorDataset(model, input, hash);
  const room = original.records.find(r => r.key === "a")!;
  assert.equal(room.circulation, false);
  const geometryKey = JSON.stringify([hash, room.key, room.levelId, room.ringsFeet]);
  const review = { throughNavigation: true, throughNavigationGeometryKey: geometryKey, notes: "Confirmed reception passage to washrooms." };
  const saved = { version: 1, records: { a: review }, edges: {} };
  const regenerated = await prepareIndoorDataset(model, { ...input, indoorReviews: saved }, hash);
  const restored = regenerated.records.find(r => r.key === "a")!;
  assert.equal(restored.circulation, false);
  assert.deepEqual(restored.ringsFeet, room.ringsFeet);
  assert.deepEqual(restored.properties.throughNavigationReview, { geometryKey, notes: review.notes });
  const stale = await prepareIndoorDataset(model, { ...input, indoorReviews: { ...saved, records: { a: { ...review, throughNavigationGeometryKey: "stale" } } } }, hash);
  assert.equal(stale.records.find(r => r.key === "a")!.properties.throughNavigationReview, undefined);
  assert.ok(stale.issues.some(i => i.code === "through-navigation-review-stale" && i.roomKey === "a"));
});

test("independently recovered circulation seams keep unique deterministic review IDs", async () => {
  const floor={elementId:100,categoryId:-2000032,boundsFeet:{min:{x:-11,y:0,z:-.5},max:{x:21,y:10,z:0}},loops:[[[-11,0,0],[21,0,0],[21,10,0],[-11,10,0]]]};
  const rooms=[room('a',0),room('b',10.4),room('c',-10.4)].map(r=>({...r,dwg:{sectionId:'01 floor',sha256:'drawing'}}));
  const source:RoomDirectoryData={...data,annotations:rooms,boundaryReference:{format:'reviter-boundary-reference',version:1,coordinateSystem:'revit-model-feet',sourceSha256:'drawing',sections:[{sectionId:'01 floor',levelId:1,registrationErrorFeet:0,wallSegments:[],doorSegments:[]}]}};
  const nativeModel={...model,elementBounds:[floor]} as unknown as ConvertResult;
  const first=await prepareIndoorDataset(nativeModel,source,'a'.repeat(64)),second=await prepareIndoorDataset(nativeModel,source,'a'.repeat(64));
  const issues=first.issues.filter(i=>i.code==='recovered-open-front'&&i.roomKey==='a');
  assert.equal(issues.length,2);
  assert.equal(new Set(first.issues.map(i=>i.id)).size,first.issues.length);
  assert.deepEqual(first.issues.map(i=>i.id),second.issues.map(i=>i.id));
  assert.equal(issues[0]!.id,'recovered-open-front:a:1');
  assert.equal(issues[1]!.id,'recovered-open-front:a:1:2');
});
