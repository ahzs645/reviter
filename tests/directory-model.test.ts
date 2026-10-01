import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { directoryModelFloor, directoryFloorPlanes, directoryRoomGroup } from "../app/studio/directory-model.ts";
import type { DirectoryRoom } from "../lib/reviter/room-directory.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

const room: DirectoryRoom = {key:"room",number:"10-1000",name:"Office",levelId:42,confidence:1,polygonFeet:[[100,200],[110,200],[110,210],[100,210]],holesFeet:[[[103,203],[107,203],[107,207],[103,207]]],labelPointFeet:[101,201]};
const model = {levels:[{levelId:42,elevation:30,candidates:1,elevationSource:"level-element" as const},{levelId:43,elevation:45,candidates:1}]};
const origin = {x:90,y:180,z:25};

test("a directory cutaway uses the chosen Revit level and excludes other levels and deleted rooms",()=>{
  const floor=directoryModelFloor(model,[room,{...room,key:"other",levelId:43},{...room,key:"deleted",status:"deleted"}],42,null)!;
  assert.equal(floor.rooms.length,1); assert.equal(floor.elevation,30);
  assert.equal(floor.elevationSource,"Revit level");
  assert.equal(directoryModelFloor(model,[room],999,null),null);
});

test("cutaway planes remove upper and lower floors and neighboring buildings after origin translation",()=>{
  const floor=directoryModelFloor(model,[room],42,null)!;
  const planes=directoryFloorPlanes(floor,origin,4);
  const inside=(x:number,y:number,z:number)=>planes.every(p=>p.distanceToPoint(new THREE.Vector3(x-origin.x,y-origin.y,z-origin.z))>=0);
  assert.ok(inside(105,205,31));
  assert.ok(!inside(105,205,35)); assert.ok(!inside(105,205,27)); assert.ok(!inside(200,205,31));
  assert.ok(directoryFloorPlanes(floor,origin,8).every(p=>p.distanceToPoint(new THREE.Vector3(15,25,12))>=0));
});

test("3D room surfaces preserve enclosed holes, model coordinates, and shared hallway identities",()=>{
  const floor=directoryModelFloor(model,[{...room,name:"Corridor",circulationGroup:"hall"},{...room,key:"alias",name:"Corridor",circulationGroup:"hall"}],42,"alias")!;
  const group=directoryRoomGroup(floor,origin,"alias");
  const meshes=group.children.filter(o=>(o as THREE.Mesh).isMesh) as THREE.Mesh[];
  assert.equal(meshes.length,1);
  const mesh=meshes[0]!; const geometry=mesh.geometry; const positions=geometry.getAttribute("position"); const indices=geometry.index!;
  let area=0;
  for(let i=0;i<indices.count;i+=3){
    const a=new THREE.Vector3().fromBufferAttribute(positions,indices.getX(i)); const b=new THREE.Vector3().fromBufferAttribute(positions,indices.getX(i+1)); const c=new THREE.Vector3().fromBufferAttribute(positions,indices.getX(i+2));
    area+=new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).length()/2;
    const center=a.add(b).add(c).divideScalar(3);
    assert.ok(!(center.x>13 && center.x<17 && center.y>23 && center.y<27),"No triangle fills the enclosed hole");
  }
  assert.ok(Math.abs(area-84)<1e-5); assert.equal(mesh.position.z,5.15);
  assert.equal((mesh.material as THREE.MeshBasicMaterial).color.getHexString(),"a7dcd7");
});

test("a split-level room sits on its own recovered slab instead of floating at the directory level",()=>{
  const slab=(id:number,x:number,z:number)=>({elementId:id,categoryId:-2000032,boundsFeet:{min:{x,y:200,z:z-1},max:{x:x+20,y:220,z}},loops:[[[x,200,z],[x+20,200,z],[x+20,220,z],[x,220,z]]],kind:"solid"});
  const splitModel={levels:[...model.levels,{levelId:41,elevation:26,candidates:1}],elementBounds:[slab(1,100,30),slab(2,120,26)],nativeAssociatedLevelRelations:[{elementId:1,levelId:42},{elementId:2,levelId:41}]} as unknown as ConvertResult;
  const lowerRoom={...room,key:"lower",holesFeet:[],polygonFeet:room.polygonFeet.map(([x,y])=>[x+20,y] as [number,number]),labelPointFeet:[125,205] as [number,number]};
  const floor=directoryModelFloor(splitModel,[room,lowerRoom],42,null)!;
  assert.equal(floor.roomElevations.lower!.elevation,26);
  assert.equal(floor.roomElevations.lower!.levelId,41);
  assert.equal(floor.boundsFeet.min.z,24);
  const group=directoryRoomGroup(floor,origin,null);
  assert.equal(group.children.find(o=>o.userData.roomKey==="lower")!.position.z,1.15);
});
test("3D circulation context highlights linked areas while preserving picking and source boundaries",()=>{
  const atrium={...room,key:'atrium',name:'Atrium',holesFeet:[]},hall={...room,key:'hall',name:'Corridor',holesFeet:[],polygonFeet:room.polygonFeet.map(([x,y])=>[x+11,y] as [number,number]),labelPointFeet:[116,205] as [number,number]};
  const floor=directoryModelFloor(model,[atrium,hall],42,'atrium')!;
  floor.connectedCirculation=true;floor.portals=[{doorId:1,rooms:['atrium','hall'],point:[110.5,205],from:[110,205],to:[111,205],halfWidth:1,halfHeight:1}];
  const meshes=directoryRoomGroup(floor,origin,'atrium').children.filter(o=>(o as THREE.Mesh).isMesh) as THREE.Mesh[];
  assert.equal(meshes.length,2);assert.ok(meshes.every(m=>(m.material as THREE.MeshBasicMaterial).color.getHexString()==='a7dcd7'));
  assert.deepEqual(meshes.map(m=>m.userData.roomKey),['atrium','hall']);
  floor.connectedCirculation=false;
  const other=directoryRoomGroup(floor,origin,'atrium').children.find(o=>o.userData.roomKey==='hall') as THREE.Mesh;
  assert.equal((other.material as THREE.MeshBasicMaterial).color.getHexString(),'d7eee3');
});

test('open-to-below areas keep their 3D outline but have no fake floor mesh, including overlaps',()=>{
  const voidRoom={...room,key:'drop',name:'Rotunda',holesFeet:[],walkability:'void' as const};
  const floor=directoryModelFloor(model,[voidRoom],42,'drop')!;
  const group=directoryRoomGroup(floor,origin,'drop');
  assert.ok(!group.children.some(o=>(o as THREE.Mesh).isMesh));
  assert.equal(group.children[0]!.userData.walkability,'void');
  const overlapped=directoryModelFloor(model,[{...room,key:'hall',name:'Corridor',holesFeet:[]},voidRoom],42,'drop')!;
  assert.equal(overlapped.areas.find(a=>a.kind==='hallway')!.areaFeet,0);
});
