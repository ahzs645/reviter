import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cadSourceSurfaceRings,validateCadFloorSurfaces,validateCadSurfacePaths,type CadFloorSurfaces} from '../lib/reviter/dwg-floor-surfaces.ts';
import {cadPolygonTriangles} from '../lib/reviter/dwg-building-scene.ts';
import type {CadDrawingPaths} from '../lib/reviter/dwg-drawing-paths.ts';
type Point=[number,number];
function fixture(){const f={id:'a',buildingCode:'B',regions:[{roomKey:'track',anchorMetres:[1,5] as Point}],primitives:[{sourceHandle:'outer-a',pointsMetres:[[0,0],[10,0],[10,10]] as Point[]},{sourceHandle:'outer-b',pointsMetres:[[10,10],[0,10],[0,0]] as Point[]},{sourceHandle:'inner-a',pointsMetres:[[2,2],[8,2],[8,8]] as Point[]},{sourceHandle:'inner-b',pointsMetres:[[8,8],[2,8],[2,2]] as Point[]}]};
 const chains=[['outer-a','outer-b'],['inner-a','inner-b']].map(c=>c.map(handle=>({handle,reverse:false})));
 const rings=cadSourceSurfaceRings(f,chains,.002);const review:CadFloorSurfaces={format:'reviter-cad-floor-surfaces',version:1,sourceSha256:'source',geometrySha256:'geometry',appliedToNativeGeometry:false,routingEligible:false,graphEdges:[],surfaces:[{id:'track-floor',floorId:'a',buildingCode:'B',roomKey:'track',title:'Track',sourceChains:chains,maximumJoinMetres:.002,ringsMetres:rings,openToBelowConfirmed:true,physicalSlabVerified:false,reason:'Centre confirmed open to below; no bridge.',remainingReview:['Physical slab height unknown.']}]};return {f,review};}
test('a source-bound annular surface triangulates without a centre bridge or source mutation',()=>{
 const {f,review}=fixture(),before=JSON.stringify(f);validateCadFloorSurfaces(review,{sourceSha256:'source',floors:[f]},'geometry');const tris=cadPolygonTriangles(review.surfaces[0]!.ringsMetres,p=>p);let area=0;
 for(let i=0;i<tris.length;i+=9){const a=tris.slice(i,i+3),b=tris.slice(i+3,i+6),c=tris.slice(i+6,i+9);area+=Math.abs((b[0]!-a[0]!)*(c[2]!-a[2]!)-(b[2]!-a[2]!)*(c[0]!-a[0]!))/2;const x=(a[0]!+b[0]!+c[0]!)/3,y=-(a[2]!+b[2]!+c[2]!)/3;assert.ok(!(x>2&&x<8&&y>2&&y<8));}
 assert.equal(area,64);assert.equal(JSON.stringify(f),before);
});
test('floor review rejects changed source chains, stale hashes and unbounded joins',()=>{
 const {f,review}=fixture();assert.throws(()=>validateCadFloorSurfaces(review,{sourceSha256:'source',floors:[f]},'changed'),/source boundaries/);
 review.surfaces[0]!.ringsMetres[1]![1]![0]=7;assert.throws(()=>validateCadFloorSurfaces(review,{sourceSha256:'source',floors:[f]},'geometry'),/source boundaries/);
 f.primitives[1]!.pointsMetres[0]![0]=10.003;assert.throws(()=>cadSourceSurfaceRings(f,review.surfaces[0]!.sourceChains,.002),/unsupported source join/);
});
test('openings veto stale path reports, filled cells and even short off-centre edge crossings',()=>{
 const {review}=fixture();const p={floorSurfacesSha256:'surface',floors:[{id:'a',cells:[{ringsMetres:review.surfaces[0]!.ringsMetres}],nodes:[{pointMetres:[1,7]},{pointMetres:[9,9]}],previewEdges:[]}]} as unknown as CadDrawingPaths;
 validateCadSurfacePaths(review,p,'surface');assert.throws(()=>validateCadSurfacePaths(review,p,'stale'),/regeneration/);
 p.floors[0]!.cells[0]!.ringsMetres=[review.surfaces[0]!.ringsMetres[0]!];assert.throws(()=>validateCadSurfacePaths(review,p,'surface'),/fills an open/);p.floors[0]!.cells[0]!.ringsMetres=review.surfaces[0]!.ringsMetres;
 p.floors[0]!.previewEdges=[{a:0,b:1,kind:'interior',doorId:null,lengthMetres:Math.sqrt(68)}];assert.throws(()=>validateCadSurfacePaths(review,p,'surface'),/crosses an open/);
});
test('provisional facade floors require substantial finite evidence on every side and preserve scoped obstacles',async()=>{
 const {cadFacadeEnvelope,cadSurfaceObstacles}=await import('../lib/reviter/dwg-floor-surfaces.ts');const {f,review}=fixture();
 const sides={left:[[0,0],[0,10]],right:[[10,0],[10,10]],bottom:[[0,0],[10,0]],top:[[0,10],[10,10]]} as const;
 for(const [sourceHandle,points] of Object.entries(sides))f.primitives.push({sourceHandle,pointsMetres:points.map(p=>[...p] as Point)});
 const e={reason:'Human confirmed connected corner floor; physical slab unknown.',...Object.fromEntries(Object.keys(sides).map(handle=>[handle,[{handle,segmentIndex:0}]]))} as Parameters<typeof cadFacadeEnvelope>[1];
 assert.deepEqual(cadFacadeEnvelope(f,e),[[0,0],[10,0],[10,10],[0,10],[0,0]]);
 const surface=review.surfaces[0]!;surface.assumedFacadeEnvelope=e;surface.sourceChains[0]=[];surface.excludedWallPairIds=['column'];surface.ringsMetres=cadSourceSurfaceRings(f,surface.sourceChains,.002,e);
 const floor={...f,wallCandidates:[{id:'column',ringsMetres:[[[0,4],[1,4],[1,6],[0,6],[0,4]] as Point[]]}]};
 assert.ok(cadSurfaceObstacles(floor,surface).length);assert.throws(()=>cadSurfaceObstacles({...floor,wallCandidates:[]},surface),/Stale/);
 f.primitives.find(p=>p.sourceHandle==='top')!.pointsMetres=[[0,10],[2,10]];assert.throws(()=>cadFacadeEnvelope(f,e),/Unsupported assumed/);
});
test('finite wall and measured threshold witnesses cannot exceed their original source intervals',()=>{
 const {f,review}=fixture();const floor={...f,doors:[{id:'door',thresholdSegmentsMetres:[[[0,0],[10,0]] as Point[]]}]};
 const chains=review.surfaces[0]!.sourceChains;chains[0]=[{doorId:'door',thresholdIndex:0,reverse:false,interval:[0,1]},{handle:'outer-a',segmentIndex:1,reverse:false},{handle:'outer-b',reverse:false}];
 const before=JSON.stringify(floor);assert.equal(cadSourceSurfaceRings(floor,chains,.002)[0]!.length,8);assert.equal(JSON.stringify(floor),before);
 chains[0]![0]!.interval=[0,1.01];assert.throws(()=>cadSourceSurfaceRings(floor,chains,.002),/unsupported source/);
 chains[0]![0]!.interval=[0,1];chains[0]![0]!.thresholdIndex=1;assert.throws(()=>cadSourceSurfaceRings(floor,chains,.002),/unsupported source/);
});

test('strict strip collision accepts contacts and hole boundaries but rejects tiny real overlaps',async()=>{
 const {cadRingsOverlapInterior}=await import('../lib/reviter/dwg-floor-surfaces.ts');const box=(l:number,b:number,r:number,t:number):Point[][]=>[[[l,b],[r,b],[r,t],[l,t],[l,b]]];
 assert.equal(cadRingsOverlapInterior(box(0,0,2,2),box(2,0,3,2)),false);
 assert.equal(cadRingsOverlapInterior(box(0,0,2,2),box(2,0,3,2).map(r=>r.slice(0,-1))),false);
 assert.equal(cadRingsOverlapInterior(box(0,0,2,2),box(1.999,0,3,2)),true);
 assert.equal(cadRingsOverlapInterior(box(0,0,2,2),box(0,0,2,2)),true);
 assert.equal(cadRingsOverlapInterior([...box(0,0,4,4),...box(1,1,3,3)],box(1,1,3,3)),false);
});
