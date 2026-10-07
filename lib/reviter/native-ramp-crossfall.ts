function containsRoomPoint(p:readonly number[],ring:readonly (readonly number[])[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i]!,b=ring[j]!;if((a[1]!>p[1]!)!==(b[1]!>p[1]!)&&p[0]!<(b[0]!-a[0]!)*(p[1]!-a[1]!)/(b[1]!-a[1]!)+a[0]!)inside=!inside;}return inside;}
type Point3=[number,number,number];
export type NativeRampCrossfallCertificate={version:1;halfWidthFeet:.5;maximumCrossfallRatio:number;maximumContinuousHeightJointFeet:number;maximumNativeJointFeet:number;tracks:{segmentIndex:number;offsetFeet:number;sections:{start:number;end:number;startHeightFeet:number;endHeightFeet:number;nativeTriangleIndex?:number;nativeFloorId?:number;nativeJoint?:true}[]}[]};
type Floor={elementId:number;categoryId?:number;boundsFeet:{max:{z:number}};loops?:Point3[][]};
type Surface={start:number;end:number;z:(t:number)=>number;nativeTriangleIndex?:number;nativeFloorId?:number};
/** Original triangle profiles, not a widened plane-height tolerance. Each
 * lateral track follows its own native surface. Gaps and vertical discontinuity
 * stay blocked; the measured crossfall is evidence, not accessibility approval. */
export function certifyNativeRampCrossfall(triangles:Point3[][],floors:Floor[],points:readonly Point3[],diagnostics?:string[]):NativeRampCrossfallCertificate|undefined{
 const reject=(reason:string)=>{diagnostics?.push(reason);return undefined;};
 const certificate:NativeRampCrossfallCertificate={version:1,halfWidthFeet:.5,maximumCrossfallRatio:0,maximumContinuousHeightJointFeet:0,maximumNativeJointFeet:0,tracks:[]};
 for(let index=1;index<points.length;index++){
  const a=points[index-1]!,b=points[index]!,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1e-10)continue;
  for(const offset of[-.5,0,.5]){
   const p:Point3=[a[0]-dy/length*offset,a[1]+dx/length*offset,a[2]],q:Point3=[b[0]-dy/length*offset,b[1]+dx/length*offset,b[2]],surfaces:Surface[]=[];
   triangles.forEach((triangle,nativeTriangleIndex)=>{
    const [u,v,w]=triangle;if(!u||!v||!w)return;const den=(v[1]-w[1])*(u[0]-w[0])+(w[0]-v[0])*(u[1]-w[1]);if(Math.abs(den)<1e-8)return;
    const height=(t:number)=>{const x=p[0]+(q[0]-p[0])*t,y=p[1]+(q[1]-p[1])*t,h=((v[1]-w[1])*(x-w[0])+(w[0]-v[0])*(y-w[1]))/den,j=((w[1]-u[1])*(x-w[0])+(u[0]-w[0])*(y-w[1]))/den;return h*u[2]+j*v[2]+(1-h-j)*w[2];};
    const sign=Math.sign((v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]));let lo=0,hi=1;
    for(let k=0;k<3;k++){const c=triangle[k]!,d=triangle[(k+1)%3]!,side=(s:Point3)=>sign*((d[0]-c[0])*(s[1]-c[1])-(d[1]-c[1])*(s[0]-c[0])),sp=side(p),sq=side(q),slope=sq-sp;if(Math.abs(slope)<1e-12){if(sp< -1e-8)return;}else{const t=(-1e-8-sp)/slope;if(slope>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);}if(lo>hi)return;}
    surfaces.push({start:Math.max(0,lo),end:Math.min(1,hi),z:height,nativeTriangleIndex});
   });
   for(const floor of floors){if(floor.categoryId!==-2000032||!floor.loops?.[0])continue;const cuts=[0,1];for(const ring of floor.loops)for(let i=0;i<ring.length;i++){const c=ring[i]!,d=ring[(i+1)%ring.length]!,sx=d[0]-c[0],sy=d[1]-c[1],den=dx*sy-dy*sx;if(Math.abs(den)<1e-12)continue;const t=((c[0]-p[0])*sy-(c[1]-p[1])*sx)/den,u=((c[0]-p[0])*dy-(c[1]-p[1])*dx)/den;if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);}cuts.sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++){const start=cuts[i-1]!,end=cuts[i]!,t=(start+end)/2,point:[number,number]=[p[0]+dx*t,p[1]+dy*t],z=floor.boundsFeet.max.z;if(Math.abs(p[2]+(q[2]-p[2])*t-z)>.002||!containsRoomPoint(point,floor.loops[0].map(v=>[v[0],v[1]]))||floor.loops.slice(1).some(r=>containsRoomPoint(point,r.map(v=>[v[0],v[1]]))))continue;surfaces.push({start,end,z:()=>z,nativeFloorId:floor.elementId});}}
   const cuts=[...new Set([0,1,...surfaces.flatMap(s=>[s.start,s.end])])].sort((a,b)=>a-b),sections:NativeRampCrossfallCertificate['tracks'][number]['sections']=[];
   for(let i=1;i<cuts.length;i++){const start=cuts[i-1]!,end=cuts[i]!;if(end-start<1e-11)continue;const t=(start+end)/2,centerHeight=p[2]+(q[2]-p[2])*t,candidates=surfaces.filter(s=>s.start<=t&&s.end>=t).sort((u,v)=>Math.abs(u.z(t)-centerHeight)-Math.abs(v.z(t)-centerHeight));const surface=candidates[0];if(!surface){const previous=sections.at(-1),next=surfaces.filter(v=>v.start>=end-1e-10).sort((u,v)=>u.start-v.start)[0];if(!previous||!next|| (previous.nativeFloorId!==undefined)===(next.nativeFloorId!==undefined)||(end-start)*length>.02)return reject(`No original surface at segment ${index-1}, track ${offset}, parameter ${t}`);const floor=floors.find(f=>f.elementId===(previous.nativeFloorId??next.nativeFloorId)),point:[number,number]=[p[0]+dx*t,p[1]+dy*t];if(floor?.loops?.slice(1).some(h=>containsRoomPoint(point,h.map(v=>[v[0],v[1]]))))return reject('A genuine native floor opening cannot be a ramp modelling joint.');const z=next.z(end),joint=Math.abs(z-previous.endHeightFeet);if(joint>.002)return reject('Floor/ramp source joint exceeds original height bound.');certificate.maximumNativeJointFeet=Math.max(certificate.maximumNativeJointFeet,(end-start)*length);certificate.maximumContinuousHeightJointFeet=Math.max(certificate.maximumContinuousHeightJointFeet,joint);sections.push({start,end,startHeightFeet:previous.endHeightFeet,endHeightFeet:z,nativeFloorId:previous.nativeFloorId??next.nativeFloorId,nativeJoint:true});continue;}const startHeightFeet=surface.z(start),endHeightFeet=surface.z(end);
    // The central route must still lie on its own original native surface.
    if(offset===0&&(Math.abs(startHeightFeet-(p[2]+(q[2]-p[2])*start))>.002||Math.abs(endHeightFeet-(p[2]+(q[2]-p[2])*end))>.002))return reject(`Central native surface differs at segment ${index-1}, interval ${start}:${end}`);
    const previous=sections.at(-1);if(previous){const joint=Math.abs(previous.endHeightFeet-startHeightFeet);if(joint>.002)return reject(`Native height discontinuity ${joint} at segment ${index-1}, track ${offset}, parameter ${start}`);certificate.maximumContinuousHeightJointFeet=Math.max(certificate.maximumContinuousHeightJointFeet,joint);}
    if(offset!==0)certificate.maximumCrossfallRatio=Math.max(certificate.maximumCrossfallRatio,Math.abs(startHeightFeet-(p[2]+(q[2]-p[2])*start))/Math.abs(offset),Math.abs(endHeightFeet-(p[2]+(q[2]-p[2])*end))/Math.abs(offset));
    sections.push({start,end,startHeightFeet,endHeightFeet,...(surface.nativeTriangleIndex!==undefined?{nativeTriangleIndex:surface.nativeTriangleIndex}:{nativeFloorId:surface.nativeFloorId})});
   }
   if(!sections.length||sections[0]!.start>1e-10||sections.at(-1)!.end<1-1e-10)return reject(`Incomplete original track ${index-1}:${offset}`);
   certificate.tracks.push({segmentIndex:index-1,offsetFeet:offset,sections});
  }
 }
 return certificate.tracks.length?certificate:undefined;
}
export function nativeRampTrackHeight(certificate:NativeRampCrossfallCertificate,index:number,offset:number,t:number):number|undefined{
 const track=certificate.tracks.find(v=>v.segmentIndex===index&&v.offsetFeet===offset),section=track?.sections.find(s=>s.start-1e-10<=t&&s.end+1e-10>=t);if(!section)return;return section.startHeightFeet+(section.endHeightFeet-section.startHeightFeet)*(t-section.start)/(section.end-section.start);
}

export function nativeRampTrackJoint(certificate:NativeRampCrossfallCertificate,index:number,offset:number,t:number):boolean{return certificate.tracks.find(v=>v.segmentIndex===index&&v.offsetFeet===offset)?.sections.some(s=>s.nativeJoint&&s.start<=t&&s.end>=t)??false;}
