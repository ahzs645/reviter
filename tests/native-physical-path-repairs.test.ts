import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeWalkingRegion} from '../lib/reviter/native-circulation-links.ts';
import {nativeIndoorEnvelopeHash} from '../lib/reviter/native-indoor-envelopes.ts';
import {nativeRationalPointInParts} from '../lib/reviter/native-exact-planar-topology.ts';
import {createNativeExactRoutingAuthority} from '../lib/reviter/native-exact-routing-authority.ts';
import type {IndoorDataset} from '../lib/reviter/indoor-contract.ts';
import type {ConvertResult} from '../lib/reviter/types.ts';
const rect=(a:number,b:number,c:number,d:number):[number,number][]=>[[a,b],[c,b],[c,d],[a,d]];
async function setup(){
 const modelSha256='a'.repeat(64),outer=rect(0,0,20,10),hole=rect(16,2,17,3);
 const envelope={version:1 as const,sourceModelSha256:modelSha256,levels:[{levelId:1,elevationFeet:0,partsFeet:[[outer,hole]],sourceElementIds:[10],cutElevationsFeet:[4,8],evidenceSha256:'b'.repeat(64)}]};
 const data={source:{modelSha256},records:[{key:'hall',levelId:1,elevationFeet:0,circulation:true,stair:false,walkable:true,access:'public',ringsFeet:[outer],properties:{}}],nativeLevels:[{id:1,name:'Main',elevationFeet:0}],walls:[],doors:[],edges:[],nodes:[],nativeIndoorEnvelopes:{...envelope,geometrySha256:await nativeIndoorEnvelopeHash(envelope)},walkingSupport:{version:1,sourceModelSha256:modelSha256,floors:[{nativeElementId:10,elevationFeet:0,ringsFeet:[outer,hole]}]},stairDisplay:{version:1,sourceModelSha256:modelSha256,flights:[],sourceFlights:[{stairElementId:20,levelIds:[1],buildings:['B'],floorElevationFeet:0,sourceGeometry:'native-brep',treads:[{runElementId:21,elevationFeet:5.8,ringFeet:rect(8,2,10,8)},{runElementId:21,elevationFeet:6.2,ringFeet:rect(12,2,14,8)}],runs:[],landings:[]}]}} as unknown as IndoorDataset;
 const model={elementBounds:[{elementId:10,categoryId:-2000032,boundsFeet:{min:{x:0,y:0,z:-1},max:{x:20,y:10,z:0}},loops:[outer,hole].map(r=>r.map(p=>[...p,0]))}],levels:[{levelId:1,elevation:0}],nativeAssociatedLevelRelations:[]} as unknown as ConvertResult;
 return {data,model};
}
test('source-flight-only low native treads veto compiler walks exactly as runtime without approving stair routes',async()=>{
 const {data,model}=await setup(),before=JSON.stringify([data,model]);
 const compiler=nativeWalkingRegion(model,data,0,true).exact!.free,runtime=createNativeExactRoutingAuthority(data)(0);
 for(const parts of [compiler,runtime]){
  assert.equal(nativeRationalPointInParts([9,5],parts),false,'retained native tread below the six-foot projection limit remains a veto');
  assert.equal(nativeRationalPointInParts([13,5],parts),true,'a tread above the existing six-foot limit is not projected down');
  assert.equal(nativeRationalPointInParts([16.5,2.5],parts),false,'the real floor hole stays open');
  assert.equal(nativeRationalPointInParts([3,5],parts),true,'unrelated supported floor remains available');
 }
 assert.equal(JSON.stringify([data,model]),before,'no source geometry, terminal or route admission is changed');
});
test('a foreign source-flight model cannot supply the additive native tread mask',async()=>{
 const {data,model}=await setup();data.stairDisplay!.sourceModelSha256='c'.repeat(64);
 assert.equal(nativeRationalPointInParts([9,5],nativeWalkingRegion(model,data,0,true).exact!.free),true);
});

test('registered seam recovery tries another original placement after a native physical veto',async()=>{
 const {recoverRegisteredCirculationSeams}=await import('../lib/reviter/registered-open-fronts.ts');
 const a={key:'a',number:'B-1',name:'Corridor',levelId:1,confidence:1,polygonFeet:rect(0,0,5,10),labelPointFeet:[2,5],dwg:{sectionId:'drawing',sha256:'source'}};
 const b={...a,key:'b',number:'B-2',polygonFeet:rect(5.4,0,11,10),labelPointFeet:[8,5]};
 const reference={format:'reviter-boundary-reference',version:1,coordinateSystem:'revit-model-feet',sourceSha256:'source',sections:[{sectionId:'drawing',levelId:1,registrationErrorFeet:0,wallSegments:[],doorSegments:[]}]};
 const geometry={walls:[],columns:[],doors:[],cutElevation:4,floors:[[rect(0,0,11,10)]]};
 const support=new Map([a,b].map(r=>[r.key,{elevationFeet:0,floors:geometry.floors}]));
 const ordinary=recoverRegisteredCirculationSeams([a,b] as never,reference as never,geometry,support);
 assert.equal(ordinary.length,1);
 let rejected=0;
 const recovered=recoverRegisteredCirculationSeams([a,b] as never,reference as never,geometry,support,front=>{if(front.from[1]<5){rejected++;return false;}return true;});
 assert.ok(rejected>0,'the first source-supported but physically obstructed placement is examined');
 assert.equal(recovered.length,1);
 assert.ok(recovered[0]!.from[1]>=5);
 assert.notDeepEqual(recovered[0]!.from,ordinary[0]!.from);
 assert.equal(recoverRegisteredCirculationSeams([a,b] as never,reference as never,geometry,support,()=>false).length,0,'no native-clear placement retains the refusal');
});

test('cell-route compiler invokes bounded refinement for original unsnappable terminals',async()=>{
 const {prepareNativeCirculationGeometry,attachNativeCirculationCellRoutes}=await import('../lib/reviter/native-circulation-geometry.ts');
 const {nativeRationalPathSupported,createNativeExactTopologyIndex}=await import('../lib/reviter/native-exact-planar-topology.ts');
 const ring:[number,number][]=[[0,0],[3,0],[3,.18],[.18,.18],[.18,3],[0,3]];
 const {data,model}=await setup();
 data.records[0]!.ringsFeet=[ring];data.records[0]!.building='B';data.records[0]!.surfaceId='B:1:0';
 data.nativeIndoorEnvelopes!.levels[0]!.partsFeet=[[ring]];
 data.nativeIndoorEnvelopes!.geometrySha256=await nativeIndoorEnvelopeHash(data.nativeIndoorEnvelopes!);
 data.walkingSupport!.floors[0]!.ringsFeet=[ring];
 model.elementBounds[0]!.loops=[ring.map(p=>[...p,0])];
 data.nodes=[{id:'arrival:hall',roomKey:'hall',kind:'arrival',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[2.8,.09,0],geographic:[0,0]},{id:'terminal',roomKey:'hall',kind:'portal',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[.09,2.8,0],geographic:[0,0]}];
 data.alignment={horizontalMetresPerFoot:.3048} as never;data.report={components:0,largestComponentArrivals:0} as never;
 delete data.stairDisplay;
 data.circulationGeometry=prepareNativeCirculationGeometry(model,data).geometry;
 const before=JSON.stringify(data.nodes);
 assert.equal(attachNativeCirculationCellRoutes(data),1);
 assert.equal(data.edges.length,1);
 assert.equal(JSON.stringify(data.nodes),before,'original arrival and portal coordinates remain unchanged');
 const edge=data.edges[0]!,cell=data.circulationGeometry.cells[0]!;
 const exact=createNativeExactTopologyIndex(data.circulationGeometry.exactTopology!,{sourceModelSha256:data.source.modelSha256,sourceGeometryKey:data.circulationGeometry.sourceGeometryKey,kernelVersion:data.circulationGeometry.exactTopology!.kernelVersion});
 assert.ok(nativeRationalPathSupported(edge.pointsFeet,exact.parts(cell.exactFaceId!)!));
 assert.equal(edge.accessible,'unknown','a raster proposal does not certify step-free access');
});

test('scoped source physical authority equals complete original replay and runtime for holes and foreign material',async()=>{
 const {data}=await setup();
 data.walls.push({nativeElementId:30,levelId:1,kind:'wall',ringsFeet:[rect(4,4,6,6)]});
 const {nativeRationalOverlay,Rational}=await import('../lib/reviter/native-rational-overlay.ts');
 const {nativeRationalOverlay:visitorOverlay}=await import('../../openindoormaps/app/indoor-project/native-rational-overlay.ts');
 const {createNativeExactRoutingAuthority:visitor}=await import('../../openindoormaps/app/indoor-project/native-exact-routing-authority.ts');
 const authority=createNativeExactRoutingAuthority(data),runtime=visitor(data);
 const scope=nativeRationalOverlay('union',[[rect(1,1,18,9)]]),subset=authority(0,scope);
 assert.deepEqual(nativeRationalOverlay('xor',subset,nativeRationalOverlay('intersection',scope,authority(0))),[]);
 const visitorScope=visitorOverlay('union',[[rect(1,1,18,9)]]);
 const compared=runtime(0,visitorScope).map(part=>part.map(ring=>ring.map(point=>point.map(value=>new Rational(value.n,value.d)) as never)));
 assert.deepEqual(nativeRationalOverlay('xor',subset,compared),[],'complete original source/runtime facts remain identical under the scope optimization');
 assert.equal(nativeRationalPointInParts([5,5],subset),false);
 assert.equal(nativeRationalPointInParts([9,5],subset),false);
 assert.equal(nativeRationalPointInParts([16.5,2.5],subset),false);
 assert.equal(nativeRationalPointInParts([3,5],subset),true);
});

test('final source replay retains an unsupported fixed terminal and branch identity disabled',async()=>{
 const {prepareNativeCirculationGeometry,attachNativeCirculationCellRoutes,replayNativePhysicalCellRoutes}=await import('../lib/reviter/native-circulation-geometry.ts');
 const {data,model}=await setup();delete data.stairDisplay;
 data.records[0]!.building='B';data.records[0]!.surfaceId='B:1:0';
 data.alignment={horizontalMetresPerFoot:.3048} as never;data.report={components:0,largestComponentArrivals:0} as never;
 data.walls.push({nativeElementId:30,levelId:1,kind:'wall',ringsFeet:[rect(8,4,10,6)]});
 data.nodes=[{id:'arrival:hall',roomKey:'hall',kind:'arrival',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[2,5,0],geographic:[0,0]},{id:'terminal',roomKey:'hall',kind:'portal',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[9,5,0],geographic:[0,0]}];
 data.circulationGeometry=prepareNativeCirculationGeometry(model,data).geometry;
 assert.equal(attachNativeCirculationCellRoutes(data),1);
 const original=JSON.stringify([data.nodes,data.edges[0]!.pointsFeet]),id=data.edges[0]!.id;
 const result=replayNativePhysicalCellRoutes(data);
 assert.deepEqual(result,{checked:1,rerouted:[],disabled:[id]});
 assert.equal(data.edges[0]!.enabled,false);
 assert.equal(JSON.stringify([data.nodes,data.edges[0]!.pointsFeet]),original,'neither the fixed terminal nor refused path is moved');
 assert.equal(data.issues.at(-1)!.code,'native-physical-route-refused');
});

test('final source replay replans around foreign material inside complete original physical support',async()=>{
 const {prepareNativeCirculationGeometry,attachNativeCirculationCellRoutes,replayNativePhysicalCellRoutes}=await import('../lib/reviter/native-circulation-geometry.ts');
 const {data,model}=await setup();delete data.stairDisplay;
 data.records[0]!.building='B';data.records[0]!.surfaceId='B:1:0';
 data.alignment={horizontalMetresPerFoot:.3048} as never;data.report={components:0,largestComponentArrivals:0} as never;
 data.walls.push({nativeElementId:30,levelId:1,kind:'wall',ringsFeet:[rect(8,4,10,6)]});
 data.nodes=[{id:'arrival:hall',roomKey:'hall',kind:'arrival',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[2,5,0],geographic:[0,0]},{id:'terminal',roomKey:'hall',kind:'portal',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[18,5,0],geographic:[0,0]}];
 data.circulationGeometry=prepareNativeCirculationGeometry(model,data).geometry;
 assert.equal(attachNativeCirculationCellRoutes(data),1);
 const oldNodes=JSON.stringify(data.nodes),id=data.edges[0]!.id;
 const result=replayNativePhysicalCellRoutes(data);
 assert.deepEqual(result,{checked:1,rerouted:[id],disabled:[]});
 assert.equal(data.edges[0]!.enabled,true);
 assert.equal(data.edges[0]!.accessible,'unknown');
 assert.equal(JSON.stringify(data.nodes),oldNodes);
 const {nativeRationalPathSupported}=await import('../lib/reviter/native-exact-planar-topology.ts');
 assert.ok(nativeRationalPathSupported(data.edges[0]!.pointsFeet,createNativeExactRoutingAuthority(data)(0)));
});

test('physical replanning never flattens a tolerated original endpoint height into the cell plane',async()=>{
 const {prepareNativeCirculationGeometry,attachNativeCirculationCellRoutes,replayNativePhysicalCellRoutes}=await import('../lib/reviter/native-circulation-geometry.ts');
 const {data,model}=await setup();delete data.stairDisplay;
 data.records[0]!.building='B';data.records[0]!.surfaceId='B:1:0';
 data.alignment={horizontalMetresPerFoot:.3048} as never;data.report={components:0,largestComponentArrivals:0} as never;
 data.walls.push({nativeElementId:30,levelId:1,kind:'wall',ringsFeet:[rect(8,4,10,6)]});
 data.nodes=[{id:'arrival:hall',roomKey:'hall',kind:'arrival',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[2,5,0],geographic:[0,0]},{id:'terminal',roomKey:'hall',kind:'portal',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[18,5,0],geographic:[0,0]}];
 data.circulationGeometry=prepareNativeCirculationGeometry(model,data).geometry;
 assert.equal(attachNativeCirculationCellRoutes(data),1);
 data.nodes[0]!.pointFeet[2]=0.01;data.edges[0]!.pointsFeet[0]![2]=0.01;
 const before=JSON.stringify([data.nodes,data.edges[0]!.pointsFeet]),id=data.edges[0]!.id;
 assert.deepEqual(replayNativePhysicalCellRoutes(data),{checked:1,rerouted:[],disabled:[id]});
 assert.equal(JSON.stringify([data.nodes,data.edges[0]!.pointsFeet]),before,'the tolerated source terminal and refused original path stay byte-identical');
 assert.equal(data.edges[0]!.enabled,false);
});
