import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCadFloors} from '../lib/reviter/dwg-floor-analysis.ts';
import {buildCadBuildingScenes,cadPolygonTriangles} from '../lib/reviter/dwg-building-scene.ts';
type Point=[number,number];
const square:Point[][]=[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[2,4],[4,4],[4,2],[2,2]]];
test('3D drawing triangulation retains holes rather than spanning them',()=>{
 const triangles=cadPolygonTriangles(square,p=>p);let area=0;
 for(let i=0;i<triangles.length;i+=9){const a=triangles.slice(i,i+3),b=triangles.slice(i+3,i+6),c=triangles.slice(i+6,i+9);
  area+=Math.abs((b[0]!-a[0]!)*(c[2]!-a[2]!)-(b[2]!-a[2]!)*(c[0]!-a[0]!))/2;
  const x=(a[0]!+b[0]!+c[0]!)/3,y=-(a[2]!+b[2]!+c[2]!)/3;assert.ok(!(x>2&&x<4&&y>2&&y<4));
 }assert.equal(area,96);
});
function floor(id:string,ordinal:number){return {id,ordinal,buildingCode:'B',name:'Level '+ordinal,alignment:{status:'provisional'},
 primitives:[{sourceHandle:'stroke',pointsMetres:[[0,0],[10,0]] as Point[]}],
 wallCandidates:[{id:'wall-'+id,ringsMetres:[[[0,0],[10,0],[10,.3],[0,.3]] as Point[]]}],
 regions:[{roomKey:'room-'+id,number:'B-'+id,name:'Office',ringsMetres:square,sharedRoomKeys:['room-'+id],status:'closed-drawing-region-needs-review'}],
 doors:[{closedLeafMetres:[[0,0],[1,0]] as Point[]}],stairs:[],stairAreas:[{id:'area-'+id,ringsMetres:square,runIds:[],sourceHandles:['stroke']}],stairReview:[]};}
test('building scenes preserve source, use separate XY alignment and keep connections provisional',()=>{
 const floors=[floor('a',0),floor('b',1)];const analysis=analyzeCadFloors(floors);
 analysis.floors[1]!.additionalTransform={a:0,b:1,c:-1,d:0,e:20,f:30};
 const input=JSON.stringify(floors),scenes=buildCadBuildingScenes({floors,sourceSha256:'drawing'},Object.assign(analysis,{geometrySha256:'geometry'}));
 assert.equal(JSON.stringify(floors),input);assert.deepEqual(Array.from(scenes[0]!.floors[1]!.source),Array.from(new Float32Array([20,.018,-30,20,.018,-40])));
 assert.equal(scenes[0]!.links.length,1);assert.equal(scenes[0]!.sourceSha256,'drawing');assert.equal(scenes[0]!.geometrySha256,'geometry');assert.deepEqual(analysis.graphEdges,[]);
});
test('3D links cannot bypass a missing drawing floor even if a forged candidate asks for it',()=>{
 const floors=[floor('a',0),floor('b',2)],analysis=analyzeCadFloors(floors);
 analysis.candidates.push({buildingCode:'B',fromFloorId:'a',toFloorId:'b',fromAreaId:'area-a',toAreaId:'area-b',overlapRatio:1,alignmentStatus:'provisional',sourceHandles:[],reviewRequired:[],routingEligible:false,servedFloorsVerified:false,physicalElevations:null,status:'review'});
 assert.equal(buildCadBuildingScenes({floors},analysis)[0]!.links.length,0);
});
