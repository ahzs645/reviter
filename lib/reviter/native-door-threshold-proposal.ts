/** Source-envelope proposal only. An oriented bound is NOT a qualified tread,
 * riser or complete headroom body. Never turn this output into a route edge.
 */
import {
  Rational, rational, nativeRationalScalarToIEEE,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import { nativeConservativeTwoFootStrip } from "./native-stepped-stair-v2-stations.ts";

type Point3 = readonly [number, number, number];
const add=(a:Rational,b:Rational)=>new Rational(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a:Rational,b:Rational)=>new Rational(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a:Rational,b:Rational)=>new Rational(a.n*b.n,a.d*b.d);
const div=(a:Rational,b:Rational)=>new Rational(a.n*b.d,a.d*b.n);
const cmp=(a:Rational,b:Rational)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
const delta=(a:NativeRationalPoint,b:NativeRationalPoint):NativeRationalPoint=>[sub(a[0],b[0]),sub(a[1],b[1])];
const cross=(a:NativeRationalPoint,b:NativeRationalPoint)=>sub(mul(a[0],b[1]),mul(a[1],b[0]));
const xy=(p:Point3):NativeRationalPoint=>[rational(p[0]),rational(p[1])];
const orient=(a:Point3,b:Point3,c:Point3)=>cross(delta(xy(b),xy(a)),delta(xy(c),xy(a))).n;
const intersection=(a:NativeRationalPoint,b:NativeRationalPoint,s:NativeRationalPoint,e:NativeRationalPoint)=>{
  const v=delta(b,a),w=delta(e,s),den=cross(v,w);
  if(!den.n)return undefined;
  const offset=delta(s,a),t=div(cross(offset,w),den),u=div(cross(offset,v),den);
  return {goParameter:t,sourceEnvelopeEdgeParameter:u,
    pointFeet:[add(a[0],mul(v[0],t)),add(a[1],mul(v[1],t))] as NativeRationalPoint,
    properFullSpanCrossing:cmp(t,rational(0))>0&&cmp(t,rational(1))<0&&cmp(u,rational(0))>=0&&cmp(u,rational(1))<=0};
};

export function proposeNativeDoorThresholdProfile(input:{
  originalOrientedBox:readonly Point3[];
  baseElevationFeet:number;
  topElevationFeet:number;
  fromFeet:Point3;
  toFeet:Point3;
}) {
  const {originalOrientedBox:box,baseElevationFeet:base,topElevationFeet:top,fromFeet:from,toFeet:to}=input;
  if(box.length!==8 || !Number.isFinite(base) || !Number.isFinite(top) || top<=base ||
      [...box,from,to].some(p=>p.length!==3 || !p.every(Number.isFinite)) ||
      from[2]!==base || to[2]!==base)
    throw Error("Original eight-corner source bound and same-plane approaches are required");
  const lower=box.filter(p=>p[2]===base),upper=box.filter(p=>p[2]===top);
  if(lower.length!==4 || upper.length!==4 ||
      lower.some(p=>!upper.some(q=>p[0]===q[0]&&p[1]===q[1])) ||
      new Set(lower.map(p=>JSON.stringify(p))).size!==4)
    throw Error("Unsupported source threshold envelope; do not invent cap or riser faces");
  const sorted=[...lower].sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  const hull=(points:Point3[])=>{
    const result:Point3[]=[];
    for(const p of points){
      while(result.length>=2 && orient(result.at(-2)!,result.at(-1)!,p)<=0n)result.pop();
      result.push(p);
    }
    return result;
  };
  const ring=[...hull(sorted).slice(0,-1),...hull([...sorted].reverse()).slice(0,-1)];
  if(ring.length!==4)throw Error("Degenerate source threshold envelope");
  const a=xy(from),b=xy(to),v=delta(b,a);
  if(!v.some(q=>q.n))throw Error("Zero-plan threshold proposal");
  const strip=nativeConservativeTwoFootStrip(a,b)[0]![0]!;
  const tracks=[[strip[0]!,strip[1]!],[strip[3]!,strip[2]!]];
  const crossings=ring.flatMap((p,i)=>{
    const q=ring[(i+1)%ring.length]!,s=xy(p),e=xy(q),hit=intersection(a,b,s,e);
    if(!hit?.properFullSpanCrossing)return [];
    const outerTrackChecks=tracks.map(([start,end])=>intersection(start!,end!,s,e));
    return [{parameter:hit.goParameter,point:hit.pointFeet,originalEnvelopeEdge:[p,q],
      outerTrackChecks,fullTwoFootEnvelopeSpan:outerTrackChecks.every(c=>c?.properFullSpanCrossing===true)}];
  }).sort((c,d)=>cmp(c.parameter,d.parameter));
  if(crossings.length!==2 || cmp(crossings[0]!.parameter,crossings[1]!.parameter)===0)
    throw Error("Approaches must cross two distinct source envelope faces");
  const first=crossings[0]!,last=crossings[1]!;
  const at=(point:NativeRationalPoint,z:number)=>[point[0],point[1],rational(z)];
  const exactProfileFeet=[at(a,base),at(first.point,base),at(first.point,top),
    at(last.point,top),at(last.point,base),at(b,base)];
  return {
    format:"native-door-threshold-envelope-proposal-v1",
    originalOrientedBox:structuredClone(box),
    sourceBoundIsNotQualifiedBody:true,
    statedWalkingWidthFeet:2,
    riseMillimetres:(top-base)*304.8,
    crossings,
    fullTwoFootEnvelopeSpanProposed:crossings.every(c=>c.fullTwoFootEnvelopeSpan),
    exactProfileFeet,
    displayProfileFeet:exactProfileFeet.map(p=>p.map(nativeRationalScalarToIEEE)),
    proposedMode:"stepped-door-threshold",
    proposedWheelchairEligible:false,
    sourceGeometryEdited:false,
    ordinaryFlatDoorApproval:false,
    routingActivationAllowed:false,
    remainingChecks:["Original body/cap/riser correspondence, not an oriented bound alone",
      "Continuous full approach and threshold body/headroom clearance with foreign obstacles and holes",
      "Current persisted host/door membership and exact permitted door opening",
      "Source ownership application, access policy and bidirectional actual route acceptance"],
  };
}
