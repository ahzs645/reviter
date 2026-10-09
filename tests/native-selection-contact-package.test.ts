import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {createProjectPackage,readProjectPackage} from '../lib/reviter/project-package.ts';
import {nativeMaterialSectionsHash} from '../lib/reviter/native-material-sections.ts';
import type {RoomDirectoryData} from '../lib/reviter/room-directory.ts';
import type {IndoorDataset} from '../lib/reviter/indoor-contract.ts';
import type {NativeSelectionContactRepair} from '../lib/reviter/native-selection-contact-repairs.ts';
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
type P=[number,number];
async function fixture(){
 const model=new File([new Uint8Array([1,2,3,4])],'Contact.rvt'),modelSha=hash(new Uint8Array(await model.arrayBuffer())),gap=2**-45;
 const source:P[]=[[-10,0],[0,0],[0,1],[-10,1]],target:P[]=[[gap,-2],[3,-2],[3,3],[gap,3]];
 const material={version:1 as const,sourceModelSha256:modelSha,levels:[{levelId:1,elevationFeet:0,cutElevationFeet:4,evidenceSha256:'c'.repeat(64),sourceElementIds:[10,20],sections:[source,target].map((r,i)=>({nativeElementId:i?20:10,categoryId:-2000011,kind:'wall' as const,baseElevationFeet:0,topElevationFeet:10,partsFeet:[[r]]}))}]};
 const nativeMaterialSections={...material,geometrySha256:await nativeMaterialSectionsHash(material)};
 const repair:NativeSelectionContactRepair={id:'selection-contact:10-20',sourceModelSha256:modelSha,sourceMaterialGeometrySha256:nativeMaterialSections.geometrySha256,levelId:1,elevationFeet:0,status:'applied',source:{nativeElementId:10,ringsFeet:[source],capFeet:[source[1],source[2]]},target:{nativeElementId:20,ringsFeet:[target],faceFeet:[target[3],target[0]]},evidenceSha256:'d'.repeat(64),notes:'Provisional native contact, revisit required.',assumption:{kind:'provisional-extracted-native-contact',revisitRequired:true}};
 const contacts={version:1 as const,sourceModelSha256:modelSha,repairs:[repair]};
 const rooms={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:model.name},annotations:[],nativeMaterialSections,nativeSelectionContactRepairs:contacts} as RoomDirectoryData;
 const indoor={format:'reviter-indoor',version:1,source:{modelFileName:model.name,modelSha256:modelSha,roomsSha256:hash(JSON.stringify(rooms))},nativeLevels:[{id:1,elevationFeet:0}],walls:[],records:[],doors:[],nodes:[],edges:[],walkingSupport:{version:1,sourceModelSha256:modelSha,floors:[{nativeElementId:30,elevationFeet:0,ringsFeet:[[[-20,-5],[10,-5],[10,5],[-20,5]]]}]},nativeMaterialSections,nativeSelectionContactRepairs:structuredClone(contacts)} as unknown as IndoorDataset;
 return {model,rooms,indoor,gap};
}
const refreshRoomsHash=(rooms:RoomDirectoryData,indoor:IndoorDataset)=>{indoor.source.roomsSha256=hash(JSON.stringify(rooms));};

test('selection-only native contact source and prepared metadata round trip without physical or routing edits',async()=>{
 const {model,rooms,indoor}=await fixture(),before=JSON.stringify({walls:indoor.walls,doors:indoor.doors,nodes:indoor.nodes,edges:indoor.edges,walkingSupport:indoor.walkingSupport});
 const result=await readProjectPackage(await createProjectPackage(model,rooms,{indoor}));
 assert.deepEqual(result.rooms.nativeSelectionContactRepairs,rooms.nativeSelectionContactRepairs);
 assert.deepEqual(result.indoor!.nativeSelectionContactRepairs,rooms.nativeSelectionContactRepairs);
 assert.equal(JSON.stringify({walls:result.indoor!.walls,doors:result.indoor!.doors,nodes:result.indoor!.nodes,edges:result.indoor!.edges,walkingSupport:result.indoor!.walkingSupport}),before);
});

test('source/prepared contact mismatch is rejected by export and checksummed reimport',async()=>{
 const {model,rooms,indoor}=await fixture();
 const altered=structuredClone(indoor);altered.nativeSelectionContactRepairs!.repairs[0].notes+=' Unreviewed change.';
 await assert.rejects(createProjectPackage(model,rooms,{indoor:altered}),/selection contacts do not match/);
 const files=unzipSync(await createProjectPackage(model,rooms,{indoor}));
 const data=JSON.parse(strFromU8(files['viewer/indoor.json']));delete data.nativeSelectionContactRepairs;
 files['viewer/indoor.json']=strToU8(JSON.stringify(data));const manifest=JSON.parse(strFromU8(files['manifest.json']));
 manifest.indoor.bytes=files['viewer/indoor.json'].length;manifest.indoor.sha256=hash(files['viewer/indoor.json']);files['manifest.json']=strToU8(JSON.stringify(manifest));
 await assert.rejects(readProjectPackage(zipSync(files)),/selection contacts do not match/);
});

test('compiler package replay cannot accept a physical door intersection below 1e-15 square feet',async()=>{
 const {model,rooms,indoor,gap}=await fixture();
 indoor.doors=[{id:'door',nativeElementId:40,levelId:1,pointFeet:[gap/2,.5],normalFeet:[1,0],roomKeys:[],state:'unmapped',footprintFeet:[[0,.5],[gap,.5],[gap,.500001],[0,.500001]]}] as unknown as IndoorDataset['doors'];
 await assert.rejects(createProjectPackage(model,rooms,{indoor}),/door/);
});

test('proposed metadata remains portable without masquerading as an applied physical proof',async()=>{
 const {model,rooms,indoor}=await fixture();
 rooms.nativeSelectionContactRepairs!.repairs[0].status='proposed';indoor.nativeSelectionContactRepairs=structuredClone(rooms.nativeSelectionContactRepairs);refreshRoomsHash(rooms,indoor);
 indoor.walkingSupport=undefined;
 assert.equal((await readProjectPackage(await createProjectPackage(model,rooms,{indoor}))).indoor!.nativeSelectionContactRepairs!.repairs[0].status,'proposed');
});
