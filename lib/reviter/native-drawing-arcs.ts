/** Source detail curves only: these SVG primitives never enter scene geometry.
 * RE-100 in pinned upstream partition_beam_axes.rs proves the exact full-circle
 * tag 0x00080004 with [0,0]. This helper admits that periodic-circle tag
 * and the measured bounded-arc tag 0x01080004; other tags stay unresolved.
 * Evaluation follows
 * native_parametric_surface.rs: center+r*(cos(t)*x+sin(t)*y).
 */
import * as DMath from "./deterministic-math.ts";
import type { NativeInventoryRecord } from "./native-record-inventory.ts";
type Vec = [number,number,number];
export type NativeDrawingFrame = { origin: Vec; right: Vec; up: Vec; normal: Vec };
export type NativeDetailArc = {
  kind:"source-detail-arc"|"source-detail-circle";
  centerFeet:Vec; xDirection:Vec; yDirection:Vec; radiusFeet:number;
  storedIntervalRadians:[number,number]; evaluatedIntervalRadians:[number,number];
  svgPath:string|null; svgCircle:[number,number,number]|null;
  pointsFeet:Vec[]; bounds2d:[number,number][]; sourceFields:string[];
};
const val=(record:NativeInventoryRecord,key:string)=>record.values[key]?.value;
const vector=(value:unknown):Vec|null=>Array.isArray(value)&&value.length===3&&value.every(n=>typeof n==="number"&&Number.isFinite(n)&&Math.abs(n)<1e9)?value as Vec:null;
const dot=(a:Vec,b:Vec)=>a.reduce((s,n,i)=>s+n*b[i],0);
const length=(a:Vec)=>Math.sqrt(dot(a,a));
const scalar=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n);
const fmt=(n:number)=>String(Number(n.toPrecision(15)));
export function nativeDetailArc(record:NativeInventoryRecord,frame:NativeDrawingFrame):{curve:NativeDetailArc|null;reason?:string}{
 const reject=(reason:string)=>({curve:null,reason});
 if(record.kind!=="source-curve"||val(record,"detailCurve")!==true||val(record,"usesOffsetPosition")!==false||val(record,"curveDriverFlip")!==false)return reject("Detail/offset/driver orientation is unresolved or unsupported.");
 const center=vector(val(record,"storedArcCenterFeet")),x=vector(val(record,"storedArcXDirection")),y=vector(val(record,"storedArcYDirection")),r=val(record,"storedArcRadiusFeet"),raw=val(record,"storedArcEndParameters"),flags=val(record,"storedArcFlags");
 if(!center||!x||!y||!scalar(r)||r<=0||r>=1e8||!Array.isArray(raw)||raw.length!==2||!raw.every(scalar)||raw.some(n=>Math.abs(n)>1e9))return reject("Source arc center, radius, basis or angular interval is unsupported.");
 if(val(record,"storedArcFilled")!==false)return reject("Filled detail arcs are unresolved; no fill or boundary is inferred.");
 if([x,y].some(v=>Math.abs(length(v)-1)>1e-6)||Math.abs(dot(x,y))>1e-6||Math.abs(dot(x,frame.normal))>1e-6||Math.abs(dot(y,frame.normal))>1e-6)return reject("Source arc basis is non-orthonormal or outside the exact view plane.");
 const fullCircle=flags===0x00080004&&raw[0]===0&&raw[1]===0;
 if(!fullCircle&&(flags!==0x01080004||raw[1]<=raw[0]||raw[1]-raw[0]>2*Math.PI+1e-12))return reject("Source arc boundedness/tag and interval disagree; no angular range is guessed.");
 const begin=fullCircle?0:raw[0],end=fullCircle?2*Math.PI:raw[1];
 const evaluate=(t:number):Vec=>center.map((n,i)=>n+r*(DMath.cos(t)*x[i]+DMath.sin(t)*y[i])) as Vec;
 const project=(p:Vec):[number,number]=>{const d=p.map((n,i)=>n-frame.origin[i]) as Vec;return [dot(d,frame.right),-dot(d,frame.up)];};
 const angles=[begin,end,(begin+end)/2];
 // Exact projected-circle extrema; these only frame the SVG, not native lines.
 for(const axis of [frame.right,frame.up]){
  const angle=DMath.atan2(dot(y,axis),dot(x,axis));
  for(const extremum of [angle,angle+Math.PI]){
   const shift=Math.ceil((begin-extremum)/(2*Math.PI));const t=extremum+shift*2*Math.PI;
   if(t>=begin-1e-12&&t<=end+1e-12)angles.push(Math.max(begin,Math.min(end,t)));
  }
 }
 const points=angles.map(evaluate);if(points.some(p=>!vector(p)))return reject("Source arc evaluation exceeds finite coordinate bounds.");
 const c=project(center),px:[number,number]=[dot(x,frame.right),-dot(x,frame.up)],py:[number,number]=[dot(y,frame.right),-dot(y,frame.up)];
 const determinant=px[0]*py[1]-px[1]*py[0];if(Math.abs(Math.abs(determinant)-1)>1e-6)return reject("Source arc projection is not circular in the exact view frame.");
 let path:string|null=null;
 if(!fullCircle){
  const start=project(evaluate(begin));path=`M ${fmt(start[0])} ${fmt(start[1])}`;
  // Splitting at <=pi also supports an explicit bounded full turn without the
  // SVG coincident-endpoint ambiguity. Sweep follows the projected native basis.
  const count=Math.max(1,Math.ceil((end-begin)/Math.PI)),sweep=determinant>0?1:0;
  for(let i=1;i<=count;i++){const p=project(evaluate(begin+(end-begin)*i/count));path+=` A ${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${fmt(p[0])} ${fmt(p[1])}`;}
 }
 return {curve:{kind:fullCircle?"source-detail-circle":"source-detail-arc",centerFeet:center,xDirection:x,yDirection:y,radiusFeet:r,storedIntervalRadians:raw as [number,number],evaluatedIntervalRadians:[begin,end],svgPath:path,svgCircle:fullCircle?[c[0],c[1],r]:null,pointsFeet:points,bounds2d:points.map(project),sourceFields:["detailCurve","usesOffsetPosition","curveDriverFlip","storedArcCenterFeet","storedArcXDirection","storedArcYDirection","storedArcRadiusFeet","storedArcEndParameters","storedArcFlags","storedArcFilled"]}};
}
