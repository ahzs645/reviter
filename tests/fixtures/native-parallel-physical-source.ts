import{nativeIndoorEnvelopeHash}from'../../lib/reviter/native-indoor-envelopes.ts';
import type{IndoorDataset,IndoorRecord}from'../../lib/reviter/indoor-contract.ts';
import type{ConvertResult}from'../../lib/reviter/types.ts';
type P2=[number,number];const rect=(x:number,y:number,X:number,Y:number):P2[]=>[[x,y],[X,y],[X,Y],[x,Y]];
/** Deterministic original-input-shaped physical fixture. Labels identify faces;
 * walls, native slabs/holes and certified envelopes supply the geometry. */
export async function nativeParallelPhysicalSource(planes=4,wallCount=8){
 const sourceModelSha256='d'.repeat(64),zs=Array.from({length:planes},(_,i)=>i*20),width=120,height=81;
 const holes=Array.from({length:6},(_,i)=>rect(12+i*17,55,13+i*17,56));
 const records=zs.map((z,i)=>({key:'native-hall-'+i,number:'H'+i,name:'Corridor',building:'fixture',levelId:i+1,elevationFeet:z,elevationEvidence:'native',surfaceId:'fixture:'+i,circulation:true,stair:false,walkable:true,access:'unknown',confidence:1,ringsFeet:[rect(.5,.5,width-.5,height-.5)],properties:{}} as IndoorRecord));
 const elementBounds:any[]=zs.flatMap((z,i)=>[{elementId:1000+i,categoryId:-2000032,boundsFeet:{min:{x:-0,y:-0,z:z-.5},max:{x:width,y:height,z}},loops:[rect(-0,-0,width,height),...holes].map(r=>r.map(p=>[...p,z]))},...Array.from({length:wallCount},(_,j)=>{const x=2+j*(width-14)/wallCount;return{elementId:2000+i*1000+j,categoryId:-2000011,solid:{start:{x,y:0},end:{x:x+10,y:height},thickness:.25,baseElevation:z,topElevation:z+8,startCorners:[{x:x-.125,y:0},{x:x+.125,y:0}],endCorners:[{x:x+10-.125,y:height},{x:x+10+.125,y:height}]}};})]);
 const model={elementBounds,levels:zs.map((z,i)=>({levelId:i+1,elevation:z})),nativeAssociatedLevelRelations:[]} as unknown as ConvertResult;
 const data={source:{modelSha256:sourceModelSha256},records,nativeLevels:zs.map((z,i)=>({id:i+1,name:'Floor '+(i+1),elevationFeet:z})),walls:[],doors:[],nodes:[],edges:[],alignment:{horizontalMetresPerFoot:.3048},report:{components:0,largestComponentArrivals:0},walkingSupport:{version:1,sourceModelSha256,floors:zs.map((z,i)=>({nativeElementId:1000+i,elevationFeet:z,ringsFeet:[rect(-0,-0,width,height),...holes]}))}} as unknown as IndoorDataset;
 const source={version:1 as const,sourceModelSha256,levels:zs.map((z,i)=>({levelId:i+1,elevationFeet:z,partsFeet:[[rect(1,1,width-1,height-1)]],sourceElementIds:[1000+i],cutElevationsFeet:[z+4,z+8],evidenceSha256:'e'.repeat(64)}))};
 data.nativeIndoorEnvelopes={...source,geometrySha256:await nativeIndoorEnvelopeHash(source)};
 return{model,data};
}
