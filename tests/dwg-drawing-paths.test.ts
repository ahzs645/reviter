import {test} from 'node:test';import assert from 'node:assert/strict';
import {findCadDrawingPath,findCadMultiFloorPath,validateCadDrawingPaths,type CadPathFloor,type CadDrawingPaths} from '../lib/reviter/dwg-drawing-paths.ts';
function fixture():CadPathFloor{return {id:'f',buildingCode:'X',name:'Floor',routingEligible:false,graphEdges:[],cells:[0,1,2].map(id=>({id,ringsMetres:[[[0,0],[3,0],[3,3],[0,0]]],roomKeys:[],transit:id===1,status:id===1?'drawing-circulation':'endpoint-only'})),nodes:[0,1,2].map(id=>({id,pointMetres:[id,0],cellId:id,kind:'room'})),previewEdges:[{a:0,b:1,lengthMetres:1,kind:'door',doorId:'d1'},{a:1,b:2,lengthMetres:1,kind:'door',doorId:'d2'}],doors:['d1','d2'].map((id,i)=>({id,arcHandle:id,closedLeafMetres:[[i,0],[i,1]],cellIds:[i,i+1],nodeIds:[i,i+1],status:'two-sided-drawing-door',reason:'preview',routingEligible:false,access:null})),rooms:[0,2].map(n=>({roomKey:String(n),number:String(n),name:'Office',nodeId:n,cellId:n,status:'drawing-anchor'}))};}
test('path passes through named circulation but never an intermediate ordinary room',()=>{const f=fixture();assert.equal(findCadDrawingPath(f,'0','2').lengthMetres,2);f.cells[1]!.transit=false;assert.equal(findCadDrawingPath(f,'0','2').status,'disconnected');assert.equal(findCadDrawingPath(f,'0','2',true).status,'disconnected');f.cells[1]!.status='unlabelled-needs-review';assert.equal(findCadDrawingPath(f,'0','2',true).status,'drawing-preview');});
test('missing anchors and disconnected boundaries remain explicit',()=>{const f=fixture();f.rooms[0]!.nodeId=null;assert.equal(findCadDrawingPath(f,'0','2').status,'missing-boundary');});
test('path companion rejects source mismatch, cross-area interior edges and unsupported doors',()=>{const f=fixture(),g={floors:[{id:'f',doors:f.doors.map(d=>({id:d.id})),regions:f.rooms.map(r=>({roomKey:r.roomKey}))}]};const report:CadDrawingPaths={format:'reviter-cad-drawing-paths',version:1,sourceSha256:'s',geometrySha256:'g',routingEligible:false,appliedToNativeGeometry:false,graphEdges:[],floors:[f],limits:[]};assert.equal(validateCadDrawingPaths(report,g,'s','g'),report);assert.throws(()=>validateCadDrawingPaths(report,g,'changed','g'),/evidence/);f.previewEdges[0]!.kind='interior';assert.throws(()=>validateCadDrawingPaths(report,g,'s','g'),/evidence/);f.previewEdges[0]!.kind='door';f.doors[0]!.status='unmatched-area';assert.throws(()=>validateCadDrawingPaths(report,g,'s','g'),/evidence/);});
test('selection closure evidence requires exact original finite contacts and measured margins',()=>{
 const f=fixture();f.previewEdges=[];const g={floors:[{id:'f',doors:f.doors.map(d=>({...d,widthMetres:1,thresholdSegmentsMetres:[[[0,-.1],[0,1.05]]] as [number,number][][],supportingWallHandles:['lo','hi']})),primitives:[{sourceHandle:'lo',pointsMetres:[[0,-2],[0,-.2]] as [number,number][]},{sourceHandle:'hi',pointsMetres:[[0,1.1],[0,3]] as [number,number][]}],regions:f.rooms.map(r=>({roomKey:r.roomKey}))}]};
 f.selectionDoorClosures=[{doorId:'d1',originalThresholdSegmentsMetres:[[[0,-.1],[0,1.05]]],selectionThresholdSegmentsMetres:[[[0,-.2],[0,1.1]]],contacts:[{handles:['lo','hi'],pointsMetres:[[0,-.2],[0,1.1]],hingeMarginMetres:.2,latchMarginMetres:.1}],endpointFrameHandles:[],selectionOnly:true,physicalDoorWidthMetres:1,maximumNormalCorrectionMetres:.0001,maximumEndMarginMetres:.4}];
 const report:CadDrawingPaths={format:'reviter-cad-drawing-paths',version:1,sourceSha256:'s',geometrySha256:'g',routingEligible:false,appliedToNativeGeometry:false,graphEdges:[],floors:[f],limits:[]};
 assert.equal(validateCadDrawingPaths(report,g,'s','g'),report);
 f.selectionDoorClosures[0]!.contacts[0]!.hingeMarginMetres=.1;assert.throws(()=>validateCadDrawingPaths(report,g,'s','g'),/evidence/);
 f.selectionDoorClosures[0]!.contacts[0]!.hingeMarginMetres=.2;f.selectionDoorClosures[0]!.contacts[0]!.pointsMetres[0]=[0,-.21];assert.throws(()=>validateCadDrawingPaths(report,g,'s','g'),/evidence/);
});

function multiFixture(){
 const floors=['low','high'].map(id=>{const f=fixture();f.id=id;f.rooms[0]!.name='Stair';f.rooms[0]!.roomKey=id+'-stair';f.rooms[1]!.roomKey=id+'-room';f.cells[0]!.roomKeys=[id+'-stair'];f.nodes[0]!.pointMetres=[.5,.5];return f;});
 const paths:CadDrawingPaths={format:'reviter-cad-drawing-paths',version:1,sourceSha256:'s',geometrySha256:'g',routingEligible:false,appliedToNativeGeometry:false,graphEdges:[],floors,limits:[]};
 const assumptions={format:'reviter-cad-stair-assumptions' as const,version:1 as const,sourceSha256:'s',geometrySha256:'g',routingEligible:false as const,graphEdges:[] as never[],userAssumed:true as const,unresolved:[],connections:[{id:'stair',buildingCode:'X',family:'X-S*01',fromFloorId:'low',toFloorId:'high',fromAreaId:'low-stair',toAreaId:'high-stair',fromPointMetres:[.5,.5] as [number,number],toPointMetres:[.5,.5] as [number,number],missingIntermediateOrdinals:[1],assumedContinuous:true as const,servedStopsVerified:false as const,physicalElevations:null,reason:'user assumption'}]};
 // Give each cell a distinct footprint; the same XY stair is on both floors.
 for(const f of floors){f.cells[0]!.ringsMetres=[[[0,0],[1,0],[1,1],[0,1],[0,0]]];f.cells[1]!.ringsMetres=[[[1,0],[2,0],[2,1],[1,1],[1,0]]];f.cells[2]!.ringsMetres=[[[2,0],[3,0],[3,1],[2,1],[2,0]]];}
 return {paths,assumptions};
}
test('multi-floor comparison is opt-in, source-bound and preserves missing intermediate stops',()=>{
 const {paths,assumptions}=multiFixture();
 assert.equal(findCadMultiFloorPath(paths,assumptions,'low','low-stair','high','high-stair').status,'stairs-disabled');
 const result=findCadMultiFloorPath(paths,assumptions,'low','low-stair','high','high-stair',true);
 assert.equal(result.status,'drawing-preview');assert.deepEqual(result.connections,['stair']);assert.deepEqual(result.segments.map(s=>s.floorId),['low','high']);assert.equal(result.routingEligible,false);assert.deepEqual(paths.graphEdges,[]);assert.deepEqual(assumptions.connections[0]!.missingIntermediateOrdinals,[1]);
 assumptions.geometrySha256='changed';assert.equal(findCadMultiFloorPath(paths,assumptions,'low','low-stair','high','high-stair',true).status,'stale-stair-evidence');
});
test('unmeshed landings, holes and ordinary room ownership never receive a nearest-room connection',()=>{
 for(const mode of ['missing','hole','office']){const {paths,assumptions}=multiFixture();
  if(mode==='missing')assumptions.connections[0]!.fromPointMetres=[-1,.5];
  if(mode==='hole')paths.floors[0]!.cells[0]!.ringsMetres.push([[.4,.4],[.6,.4],[.6,.6],[.4,.6],[.4,.4]]);
  if(mode==='office')paths.floors[0]!.rooms[0]!.name='Office';
  const r=findCadMultiFloorPath(paths,assumptions,'low','low-stair','high','high-stair',true);assert.equal(r.status,'disconnected',mode);assert.equal(r.unresolved.length,1,mode);
 }
});
test('intermediate offices remain excluded across floors and the worker-serialized solver works',()=>{
 const {paths,assumptions}=multiFixture();paths.floors[0]!.cells[1]!.transit=false;
 assert.equal(findCadMultiFloorPath(paths,assumptions,'low','low-room','high','high-room',true,true).status,'disconnected');
 const workerSolve=Function('return ('+findCadMultiFloorPath.toString()+')')();assert.equal(workerSolve(paths,assumptions,'low','low-stair','high','high-stair',true).status,'drawing-preview');
});
