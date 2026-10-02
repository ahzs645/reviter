import assert from "node:assert/strict";
import test from "node:test";
import { applySemanticRoomBoundaries, validateSemanticRoomBoundaries, type SemanticRoomBoundaryInput } from "../lib/reviter/semantic-room-boundaries.ts";
import { auditRoomBoundaries } from "../lib/reviter/room-boundary-audit.ts";
import { prepareIndoorPresentation } from "../lib/reviter/indoor-presentation.ts";
import type { IndoorDataset, IndoorRecord } from "../lib/reviter/indoor-contract.ts";
import type { RoomDirectoryData } from "../lib/reviter/room-directory.ts";
import { parseRoomDirectory } from "../lib/reviter/room-directory.ts";
type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const record = (key = "room"): IndoorRecord => ({ key, number: "05-107", name: "Meeting", building: "05", levelId: 1, elevationFeet: 0, elevationEvidence: "native", surfaceId: "05:1", circulation: false, stair: false, access: "public", walkable: true, confidence: .7, ringsFeet: [rect(.4,.4,9.6,9.6)], properties: {} });
const setup = () => {
  const r = record();
  const dataset = { source: { modelSha256: "a".repeat(64) }, records: [r], walls: [], doors: [] } as unknown as IndoorDataset;
  const annotations = [{ key: r.key, levelId: 1, polygonFeet: r.ringsFeet[0]!, labelPointFeet: [5,5] as Point, confidence: .7 }];
  const input: SemanticRoomBoundaryInput = { format: "reviter-semantic-room-boundaries", version: 1, sourceModelSha256: dataset.source.modelSha256, coordinateSystem: "revit-internal", units: "feet", boundaryLocation: "finish", exporter: "Revit API Finish export", rooms: [{ roomKey: r.key, nativeRoomUniqueId: "native-room-guid", phaseUniqueId: "phase-guid", levelId: 1, elevationFeet: 0, ringsFeet: [rect(0,0,10,10)], boundaryElementIds: [10,11,12,13] }] };
  return { dataset, annotations, input };
};

test("semantic Finish input recovers missing native topology with model-bound provenance without altering sources", () => {
  const { dataset, annotations, input } = setup(), before = JSON.stringify([dataset,annotations]);
  const result = validateSemanticRoomBoundaries(dataset, annotations, input);
  assert.equal(result.rooms.length, 1); assert.equal(result.diagnostics.length, 0);
  assert.ok(result.rooms[0]!.boundaryEvidence.includes("phase-guid"));
  const presentation = prepareIndoorPresentation(dataset, annotations, input);
  assert.equal(presentation.rooms[0]!.boundarySource, "revit-finish-face");
  assert.equal(presentation.diagnostics.length, 0);
  assert.equal(JSON.stringify([dataset,annotations]), before);
});

test("wrong model/units/origin/boundary convention reject the whole semantic export", () => {
  const { dataset, annotations, input } = setup();
  for (const patch of [{sourceModelSha256:"b".repeat(64)}, {units:"metres"}, {coordinateSystem:"shared"}, {boundaryLocation:"center"}])
    assert.throws(() => validateSemanticRoomBoundaries(dataset, annotations, {...input,...patch}));
});

test("wrong level, elevation, missing phase and duplicate annotation/semantic mappings cannot be accepted", () => {
  const { dataset, annotations, input } = setup();
  for (const patch of [{levelId:2}, {elevationFeet:1}, {phaseUniqueId:""}, {boundaryElementIds:[]}]) {
    const result = validateSemanticRoomBoundaries(dataset, annotations, {...input, rooms:[{...input.rooms[0],...patch}]});
    assert.equal(result.rooms.length,0); assert.equal(result.diagnostics.length,1);
  }
  assert.equal(validateSemanticRoomBoundaries(dataset, annotations, {...input, rooms:[input.rooms[0],input.rooms[0]]}).rooms.length,0);
});

test("self intersection, hole outside exterior and intersecting holes are rejected", () => {
  const { dataset, annotations, input } = setup();
  const bad: Point[] = [[0,0],[10,10],[10,0],[0,10]];
  for (const ringsFeet of [[bad], [rect(0,0,10,10),rect(9,9,12,12)], [rect(0,0,10,10),rect(1,1,4,4),rect(3,3,5,5)]]) {
    const result = validateSemanticRoomBoundaries(dataset, annotations, {...input,rooms:[{...input.rooms[0],ringsFeet}]});
    assert.equal(result.rooms.length,0); assert.equal(result.diagnostics[0]!.code,"semantic-invalid-topology");
  }
});

test("semantic room cannot consume native barrier, circulation, another label or lose existing holes", () => {
  const { dataset, annotations, input } = setup();
  dataset.walls.push({kind:"wall",levelId:1,nativeElementId:100,ringsFeet:[rect(4,0,5,10)]});
  assert.equal(validateSemanticRoomBoundaries(dataset,annotations,input).diagnostics[0]!.code,"semantic-native-barrier-overlap");
  dataset.walls = [];
  dataset.records.push({...record("corridor"),circulation:true,ringsFeet:[rect(8,0,10,10)]});
  assert.equal(validateSemanticRoomBoundaries(dataset,annotations,input).diagnostics[0]!.code,"semantic-protected-floor-overlap");
  dataset.records.pop();
  dataset.records.push({...record("other"),ringsFeet:[rect(7,7,9,9)]});
  assert.equal(validateSemanticRoomBoundaries(dataset,[...annotations,{...annotations[0]!,key:"other",labelPointFeet:[8,8]}],input).diagnostics[0]!.code,"semantic-multiple-room-labels");
  dataset.records.pop(); dataset.records[0]!.ringsFeet.push(rect(1,1,2,2));
  assert.equal(validateSemanticRoomBoundaries(dataset,annotations,input).rooms[0]!.ringsFeet.length,2);
});

test("opt-in semantic promotion clones annotations and preserves source identity and reviewed metadata", () => {
  const { dataset, annotations, input } = setup();
  const data = { format:"reviter-room-annotations",version:1,coordinateSystem:"revit-model-feet",model:{fileName:"UNBC.rvt"}, annotations,
    georeference:{modelFileName:"UNBC.rvt",points:[]}, indoorReviews:{records:{room:{name:"Meeting room"}}} } as unknown as RoomDirectoryData;
  const before = JSON.stringify(data), accepted = validateSemanticRoomBoundaries(dataset,annotations,input).rooms;
  const next = applySemanticRoomBoundaries(data,accepted);
  assert.equal(JSON.stringify(data),before); assert.deepEqual(next.annotations[0]!.polygonFeet.slice(0,4),input.rooms[0]!.ringsFeet[0]);
  assert.deepEqual(next.model,data.model); assert.deepEqual(next.georeference,data.georeference);
  assert.deepEqual(next.indoorReviews,data.indoorReviews); assert.match(next.annotations[0]!.walkabilityNotes!,/Semantic Finish boundary imported/);
});

test("coverage audit exposes unresolved rooms by building and native level with concrete corrective actions", () => {
  const { dataset, annotations } = setup();
  dataset.presentation = prepareIndoorPresentation(dataset,annotations);
  const audit = auditRoomBoundaries(dataset,annotations);
  assert.equal(audit.eligibleRooms,1); assert.equal(audit.fallbackRooms,1);
  assert.equal(audit.prioritizedScopes[0]!.building,"05"); assert.equal(audit.prioritizedScopes[0]!.reasons["no-native-walls"],1);
  assert.match(audit.rooms[0]!.nextAction!,/model-bound semantic/);
  assert.deepEqual(audit.ordinaryRoomCoverage,{eligible:1,prepared:0,fallback:1});
  assert.deepEqual(audit.verticalCirculationCoverage,{eligible:0,prepared:0,fallback:0});
  dataset.records.push({...record("stairs"),stair:true,name:"Stairwell"});
  const withStairs=auditRoomBoundaries(dataset,annotations);
  assert.deepEqual(withStairs.ordinaryRoomCoverage,{eligible:1,prepared:0,fallback:1});
  assert.deepEqual(withStairs.verticalCirculationCoverage,{eligible:1,prepared:0,fallback:1});
  assert.equal(withStairs.rooms.find(r=>r.roomKey==="stairs")!.classification,"vertical-circulation");
});

test("semantic import keeps sub-square-foot column holes and explicit source floor apertures", () => {
  const {dataset,annotations,input}=setup();
  input.rooms[0]!.ringsFeet.push(rect(7,7,7.5,7.5));
  dataset.walls.push({kind:"column",levelId:1,nativeElementId:99,ringsFeet:[rect(7,7,7.5,7.5)]});
  const source=[{...annotations[0]!,floorOpeningsFeet:[rect(1,1,2,2)]}];
  const result=validateSemanticRoomBoundaries(dataset,source,input);
  assert.equal(result.rooms.length,1);assert.equal(result.rooms[0]!.ringsFeet.length,3);
});

test("two otherwise valid semantic rooms that overlap are both rejected independently of ordering",()=>{
  const {dataset,annotations,input}=setup();
  dataset.records[0]!.ringsFeet=[rect(0,0,10,10)];
  dataset.records.push({...record("other"),ringsFeet:[rect(5,0,15,10)]});
  const labels=[{...annotations[0]!,labelPointFeet:[1,5] as Point},{...annotations[0]!,key:"other",labelPointFeet:[14,5] as Point}];
  input.rooms.push({...input.rooms[0]!,roomKey:"other",nativeRoomUniqueId:"other-native-guid",ringsFeet:[rect(5,0,15,10)]});
  const result=validateSemanticRoomBoundaries(dataset,labels,input);
  assert.equal(result.rooms.length,0);assert.equal(result.diagnostics.length,2);
  assert.ok(result.diagnostics.every(d=>d.code==="semantic-contested-interior"));
});

test("promoted semantic source revalidates during ordinary regeneration with no sidecar and retains original rings",()=>{
  const{dataset,annotations,input}=setup();
  const data={format:"reviter-room-annotations",version:1,coordinateSystem:"revit-model-feet",model:{fileName:"UNBC.rvt"},annotations} as RoomDirectoryData;
  const accepted=validateSemanticRoomBoundaries(dataset,annotations,input).rooms;
  const promoted=parseRoomDirectory(JSON.stringify(applySemanticRoomBoundaries(data,accepted)));
  assert.equal((promoted.annotations[0]!.semanticInteriorProvenance as {nativeRoomUniqueId:string}).nativeRoomUniqueId,"native-room-guid");
  dataset.records[0]!.ringsFeet=[promoted.annotations[0]!.polygonFeet,...promoted.annotations[0]!.holesFeet??[]];
  let presentation=prepareIndoorPresentation(dataset,promoted.annotations);
  assert.equal(presentation.rooms[0]!.boundarySource,"revit-finish-face");
  assert.match(presentation.rooms[0]!.boundaryEvidence!,/native-room-guid; phase phase-guid/);
  const repeated=applySemanticRoomBoundaries(promoted,validateSemanticRoomBoundaries(dataset,promoted.annotations,input).rooms);
  assert.deepEqual((repeated.annotations[0]!.semanticInteriorProvenance as {originalRingsFeet:Point[][]}).originalRingsFeet,[annotations[0]!.polygonFeet]);
  for(const patch of [{sourceModelSha256:"b".repeat(64)},{units:"metres"},{nativeRoomUniqueId:undefined}]){
    const stale=structuredClone(promoted.annotations);
    stale[0]!.semanticInteriorProvenance={...(stale[0]!.semanticInteriorProvenance as object),...patch};
    presentation=prepareIndoorPresentation(dataset,stale);
    assert.equal(presentation.rooms.length,0);
    assert.ok(presentation.diagnostics.some(d=>d.code==="semantic-saved-provenance-stale"));
  }
  const changed=structuredClone(promoted.annotations);changed[0]!.polygonFeet=rect(.1,.1,9.9,9.9);
  assert.ok(prepareIndoorPresentation(dataset,changed).diagnostics.some(d=>d.code==="semantic-saved-provenance-stale"));
});

test("saved semantic provenance never bypasses newly recovered native obstacles",()=>{
  const{dataset,annotations,input}=setup();
  const data={format:"reviter-room-annotations",version:1,coordinateSystem:"revit-model-feet",model:{fileName:"UNBC.rvt"},annotations} as RoomDirectoryData;
  const promoted=applySemanticRoomBoundaries(data,validateSemanticRoomBoundaries(dataset,annotations,input).rooms);
  dataset.records[0]!.ringsFeet=[promoted.annotations[0]!.polygonFeet,...promoted.annotations[0]!.holesFeet??[]];
  dataset.walls.push({kind:"wall",levelId:1,nativeElementId:100,ringsFeet:[rect(4,0,4.1,10)]});
  const presentation=prepareIndoorPresentation(dataset,promoted.annotations);
  assert.equal(presentation.rooms.length,0);
  assert.ok(presentation.diagnostics.some(d=>d.code==="semantic-native-barrier-overlap"));
});
