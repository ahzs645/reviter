import {unzipSync,zipSync,strFromU8,strToU8} from "fflate";
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareIndoorDataset, sha256Bytes } from '../lib/reviter/indoor-pipeline.ts';
import { createProjectPackage, readProjectPackage } from '../lib/reviter/project-package.ts';
import { parseRoomDirectory, type RoomDirectoryData } from '../lib/reviter/room-directory.ts';
import type { ConvertResult } from '../lib/reviter/types.ts';
import type { ReviewedAreaPartitions } from '../lib/reviter/reviewed-area-partitions.ts';

const modelFile = new File(['unchanged source'], 'Logical.rvt');
const model = {
  fileName: modelFile.name,
  origin: {x:0,y:0,z:0},
  levels: [{levelId:1,elevation:0,candidates:1,name:'Ground'}],
  elementBounds:[], nativeAssociatedLevelRelations:[{elementId:100,levelId:1}], nativeStairAssemblies:[],
} as unknown as ConvertResult;
const rooms: RoomDirectoryData = {
  format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',
  model:{fileName:modelFile.name},
  annotations:[{key:'a',number:'01-001',name:'Corridor',levelId:1,confidence:1,
    polygonFeet:[[0,0],[20,0],[20,20],[0,20]],labelPointFeet:[10,10]}],
  georeference:{format:'reviter-georeference',version:1,coordinateSystem:'WGS84',method:'fixed-scale',modelFileName:modelFile.name,
    points:[{id:'p',name:'Origin',modelFeet:[0,0],levelId:1,geographic:{longitude:-122,latitude:53}},
      {id:'q',name:'Second',modelFeet:[100,0],levelId:1,geographic:{longitude:-121.999545,latitude:53}}]},
};
function logical(hash:string): ReviewedAreaPartitions {
  return {version:1,sourceModelSha256:hash,partitions:[{
    id:'shutter:pickup',levelId:1,elevationFeet:0,geometrySha256:'b'.repeat(64),kind:'shutter',
    pointsFeet:[[5,0],[5,20]],closed:false,status:'proposed',label:'Pickup shutter',
    notes:'Open front is a logical definition; original model and routes retained.',
    evidence:{kind:'reviewed-assumption',nativeElementIds:[],reason:'User describes an open shutter front.'},
    selection:'closed',navigation:'unchanged',
  }]};
}
test('logical proposals survive compiler and exact ZIP round trip without changing physical routes or raised blocks', async()=>{
  const hash=await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const baseline=await prepareIndoorDataset(model, rooms, hash);
  const input={...rooms,reviewedAreaPartitions:logical(hash)};
  const before=structuredClone(input);
  const prepared=await prepareIndoorDataset(model,input,hash);
  assert.deepEqual(input,before);
  assert.deepEqual(prepared.reviewedAreaPartitions,input.reviewedAreaPartitions);
  for(const key of ['records','walls','doors','nodes','edges','presentation','stairDisplay','circulationGeometry','issues'] as const)
    assert.deepEqual(prepared[key],baseline[key], `${key} must remain physical`);
  const unpacked=await readProjectPackage(await createProjectPackage(modelFile,input,{indoor:prepared}));
  assert.deepEqual(unpacked.rooms.reviewedAreaPartitions,input.reviewedAreaPartitions);
  assert.deepEqual(unpacked.indoor?.reviewedAreaPartitions,input.reviewedAreaPartitions);
  assert.equal(await unpacked.model.text(),'unchanged source');
});
test('source/prepared mismatch is rejected even when room checksum is rebound',async()=>{
  const hash=await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const input={...rooms,reviewedAreaPartitions:logical(hash)};
  const prepared=await prepareIndoorDataset(model,input,hash);
  delete prepared.reviewedAreaPartitions;
  await assert.rejects(createProjectPackage(modelFile,input,{indoor:prepared}),/partition|logical|differ|binding/i);
});
test('missing physical partitions and shaft outlines are review proposals, never applied route walls',async()=>{
  const hash=await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const value=logical(hash);value.partitions[0]!.kind='missing-partition';
  assert.deepEqual(parseRoomDirectory(JSON.stringify({...rooms,reviewedAreaPartitions:value})).reviewedAreaPartitions,value);
  value.partitions[0]!.kind='shaft-boundary';value.partitions[0]!.closed=true;
  value.partitions[0]!.pointsFeet=[[2,2],[4,2],[4,4],[2,4]];
  assert.deepEqual(parseRoomDirectory(JSON.stringify({...rooms,reviewedAreaPartitions:value})).reviewedAreaPartitions,value);
  value.partitions[0]!.status='applied';
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...rooms,reviewedAreaPartitions:value})),/shaft|proposal|partition/i);
});
test('applied virtual boundary is still metadata only during regeneration',async()=>{
  const hash=await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const baseline=await prepareIndoorDataset(model,rooms,hash);
  const value=logical(hash);value.partitions[0]!.status='applied';
  // Historic applied evidence may be stale after physical edits. Preservation
  // does not authorize tracing it: the native-selection worker rechecks it.
  const prepared=await prepareIndoorDataset(model,{...rooms,reviewedAreaPartitions:value},hash);
  assert.deepEqual(prepared.reviewedAreaPartitions,value);
  for(const key of ['records','walls','doors','nodes','edges','presentation','stairDisplay','circulationGeometry','issues'] as const)
    assert.deepEqual(prepared[key],baseline[key], `${key} must ignore logical boundaries`);
});

test('package reader rejects metadata stripped from a checksum-correct prepared dataset',async()=>{
  const hash=await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const input={...rooms,reviewedAreaPartitions:logical(hash)};
  const indoor=await prepareIndoorDataset(model,input,hash);
  const files=unzipSync(await createProjectPackage(modelFile,input,{indoor}));
  const saved=JSON.parse(strFromU8(files['viewer/indoor.json']!));
  delete saved.reviewedAreaPartitions;
  files['viewer/indoor.json']=strToU8(JSON.stringify(saved));
  const manifest=JSON.parse(strFromU8(files['manifest.json']!));
  manifest.indoor.bytes=files['viewer/indoor.json'].length;
  manifest.indoor.sha256=await sha256Bytes(files['viewer/indoor.json']);
  files['manifest.json']=strToU8(JSON.stringify(manifest));
  await assert.rejects(readProjectPackage(zipSync(files)),/logical boundaries differ/);
});
test('reversible propose/apply/restore history survives regeneration and authoring ZIP byte-for-byte',async()=>{
  const hash=await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const value=logical(hash), proposed=structuredClone(value.partitions[0]!);
  const applied={...structuredClone(proposed),status:'applied' as const};
  value.history=[
    {action:'propose',id:proposed.id,at:'2026-10-07T00:00:00.000Z',after:proposed},
    {action:'apply',id:proposed.id,at:'2026-10-07T00:01:00.000Z',before:proposed,after:applied},
    {action:'restore',id:proposed.id,at:'2026-10-07T00:02:00.000Z',before:applied,after:proposed},
  ];
  const input={...rooms,reviewedAreaPartitions:value};
  const baseline=await prepareIndoorDataset(model,rooms,hash);
  const indoor=await prepareIndoorDataset(model,input,hash);
  const unpacked=await readProjectPackage(await createProjectPackage(modelFile,input,{indoor}));
  assert.equal(JSON.stringify(unpacked.rooms.reviewedAreaPartitions),JSON.stringify(value));
  assert.equal(JSON.stringify(unpacked.indoor?.reviewedAreaPartitions),JSON.stringify(value));
  assert.deepEqual(indoor.edges,baseline.edges);
  assert.deepEqual(indoor.presentation,baseline.presentation);
  value.history[2]!.after=applied;
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...rooms,reviewedAreaPartitions:value})),/history transition/);
});
