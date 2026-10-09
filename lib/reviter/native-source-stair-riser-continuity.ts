import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {nativeRationalOverlay,rational,Rational,type NativeRationalParts} from './native-rational-overlay';
import type {NativeSourceStairReceipt} from './native-source-stair-width';

type P2=[number,number];
type P3=[number,number,number];
type Span=[number,number];
export type NativeStairBoundaryCurve={sourceClassName:'GLine';sourceToken:number;sourceSpan:Span;origin:P3;direction:P3;endParameters:[number,number]};
export type NativeStairRiserInventory={
 version:1;sourceModelSha256:string;sourceSchemaSha256:string;originalFrameSha256:string;
 nativeStairId:number;nativeRunId:number;completeOriginalFifoByteReplay:true;
 sourceDeclaration:{sourceClassName:'StairsRun';sourceDeclaredPath:'StairsRun.m_oGeom4TreadFaces';sourceFrameOffset:number;token:number};
 pointsFeet:P3[];
 treads:{runElementId:number;elevationFeet:number;ringFeet:P2[];sourceOriginFeet:P3;sourceFaceClassName:'Face';sourceFaceToken:number;sourceFaceSpan:Span}[];
 seams:{index:number;lowerTreadIndex:number;upperTreadIndex:number;specifiedIndex:number;lowerTypedInfoSpan:Span;upperTypedInfoSpan:Span;
  sourceTypedClassName:'StairsTreadInfo';lowerEndParameters:[number,number];upperStartParameters:[number,number];
  endRiserCurve:NativeStairBoundaryCurve;nextStartRiserCurve:NativeStairBoundaryCurve;
  endLine:NativeStairBoundaryCurve;nextStartLine:NativeStairBoundaryCurve;
  lowerBoundaryIndices:[number,number];upperBoundaryIndices:[number,number];
 }[];
 geometrySha256:string;
};
export type NativeStairRiserContinuity={version:1;sourceModelSha256:string;nativeStairId:number;nativeRunId:number;sourceInventorySha256:string;seamIndexes:number[]};
export type NativeStairRiserProjection={index:number;nativeRunId:number;sourceHeightBand:[number,number];lowerBoundaryXYZ:[P3,P3];upperBoundaryXYZ:[P3,P3];parts:NativeRationalParts};
const hash=(v:unknown)=>bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(v))));
const payload=({geometrySha256:_,...v}:NativeStairRiserInventory)=>v;
export const nativeStairRiserInventoryHash=(v:NativeStairRiserInventory)=>hash(payload(v));
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const point=(v:unknown,n:number):v is number[]=>Array.isArray(v)&&v.length===n&&v.every(x=>typeof x==='number'&&Number.isFinite(x));
const span=(v:unknown):v is Span=>Array.isArray(v)&&v.length===2&&integer(v[0])&&integer(v[1])&&v[1]>v[0];
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sub=(a:Rational,b:Rational)=>new Rational(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a:Rational,b:Rational)=>new Rational(a.n*b.n,a.d*b.d);
const add=(a:Rational,b:Rational)=>new Rational(a.n*b.d+b.n*a.d,a.d*b.d);
const greater=(a:Rational,b:Rational)=>a.n*b.d>b.n*a.d;
const positiveTriangle=(a:P2,b:P2,c:P2)=>sub(mul(sub(rational(b[0]),rational(a[0])),sub(rational(c[1]),rational(a[1]))),mul(sub(rational(b[1]),rational(a[1])),sub(rational(c[0]),rational(a[0])))).n!==0n;
const curve=(c:NativeStairBoundaryCurve)=>c&&c.sourceClassName==='GLine'&&integer(c.sourceToken)&&c.sourceToken>0&&span(c.sourceSpan)&&point(c.origin,3)&&point(c.direction,3)&&point(c.endParameters,2)&&c.endParameters[1]>c.endParameters[0]&&c.direction.some(n=>n!==0);
const sameCurveControls=(a:NativeStairBoundaryCurve,b:NativeStairBoundaryCurve)=>equal(a.origin,b.origin)&&equal(a.direction,b.direction)&&equal(a.endParameters,b.endParameters);
const lineWidthSquared=(c:NativeStairBoundaryCurve)=>{
 const d=sub(rational(c.endParameters[1]),rational(c.endParameters[0]));
 return mul(mul(d,d),add(mul(rational(c.direction[0]),rational(c.direction[0])),mul(rational(c.direction[1]),rational(c.direction[1]))));
};
const edge=(ring:P2[],indices:[number,number]):[P2,P2]|undefined=>{
 if(!Array.isArray(indices)||indices.length!==2||!indices.every(i=>integer(i)&&i<ring.length)||indices[0]===indices[1]||!((indices[0]+1)%ring.length===indices[1]||(indices[1]+1)%ring.length===indices[0]))return;
 return [ring[indices[0]]!,ring[indices[1]]!];
};
const orderedBoundary=(ring:P2[],boundary:[P2,P2],direction:P2,upper:boolean)=>{
 const score=(a:P2,b:P2)=>add(mul(add(rational(a[0]),rational(b[0])),rational(direction[0])),mul(add(rational(a[1]),rational(b[1])),rational(direction[1])));
 const selected=score(...boundary);
 return ring.every((p,i)=>upper?!greater(score(p,ring[(i+1)%ring.length]!),selected):!greater(selected,score(p,ring[(i+1)%ring.length]!)));
};

/** Mathematical replay of an independently exported original typed inventory.
 * Caller must bind the inventory to original declaration/Face/curve bytes and
 * complete body/foreign/terminal/enclosure proofs. This supplies stair-riser
 * transition geometry only; it never creates a floor, repairs a source trim,
 * or grants body, enclosure, access or routing approval. */
export function nativeSourceStairRiserProjections(inventory:NativeStairRiserInventory|undefined,carrier:NativeStairRiserContinuity|undefined,receipt:NativeSourceStairReceipt):NativeStairRiserProjection[]|undefined{
 try{
  if(!inventory||!carrier||inventory.version!==1||carrier.version!==1||!sha(inventory.sourceModelSha256)||!sha(inventory.sourceSchemaSha256)||!sha(inventory.originalFrameSha256)||!sha(inventory.geometrySha256)||!inventory.completeOriginalFifoByteReplay||inventory.sourceModelSha256!==receipt.sourceModelSha256||carrier.sourceModelSha256!==inventory.sourceModelSha256||inventory.nativeStairId!==receipt.nativeStairId||carrier.nativeStairId!==inventory.nativeStairId||carrier.nativeRunId!==inventory.nativeRunId||!receipt.nativeRunIds.includes(inventory.nativeRunId)||carrier.sourceInventorySha256!==inventory.geometrySha256||nativeStairRiserInventoryHash(inventory)!==inventory.geometrySha256)return;
  if(!integer(inventory.nativeStairId)||inventory.nativeStairId<1||!integer(inventory.nativeRunId)||inventory.nativeRunId<1||inventory.sourceDeclaration.sourceClassName!=='StairsRun'||inventory.sourceDeclaration.sourceDeclaredPath!=='StairsRun.m_oGeom4TreadFaces'||!integer(inventory.sourceDeclaration.sourceFrameOffset)||!integer(inventory.sourceDeclaration.token)||inventory.sourceDeclaration.token<1||!Array.isArray(inventory.pointsFeet)||inventory.pointsFeet.length<4||inventory.pointsFeet.length>10000||inventory.pointsFeet.some(p=>!point(p,3))||!Array.isArray(inventory.treads)||inventory.treads.length<2||inventory.treads.length>10000||!Array.isArray(inventory.seams)||inventory.seams.length>inventory.treads.length-1||!Array.isArray(carrier.seamIndexes)||carrier.seamIndexes.length<1||carrier.seamIndexes.length>inventory.seams.length||new Set(carrier.seamIndexes).size!==carrier.seamIndexes.length)return;
  const sourceTreads=receipt.treads.filter(t=>t.runElementId===inventory.nativeRunId);
  if(!equal(inventory.pointsFeet,receipt.pointsFeet)||sourceTreads.length!==inventory.treads.length||inventory.treads.some((t,i)=>t.runElementId!==inventory.nativeRunId||t.sourceFaceClassName!=='Face'||!integer(t.sourceFaceToken)||t.sourceFaceToken<1||!span(t.sourceFaceSpan)||!point(t.sourceOriginFeet,3)||t.sourceOriginFeet[2]!==t.elevationFeet||!Number.isFinite(t.elevationFeet)||!Array.isArray(t.ringFeet)||t.ringFeet.length<3||t.ringFeet.some(p=>!point(p,2))||t.elevationFeet!==sourceTreads[i]!.elevationFeet||!equal(t.ringFeet,sourceTreads[i]!.ringFeet)))return;
  if(new Set(inventory.treads.map(t=>t.sourceFaceToken)).size!==inventory.treads.length||new Set(inventory.seams.map(s=>s.index)).size!==inventory.seams.length)return;
  const result:NativeStairRiserProjection[]=[];
  for(const index of carrier.seamIndexes){
   const s=inventory.seams.find(s=>s.index===index);if(!s||!integer(s.index)||s.index<1||!integer(s.specifiedIndex)||s.specifiedIndex<1||s.sourceTypedClassName!=='StairsTreadInfo'||!span(s.lowerTypedInfoSpan)||!span(s.upperTypedInfoSpan)||!integer(s.lowerTreadIndex)||s.upperTreadIndex!==s.lowerTreadIndex+1||s.upperTreadIndex>=inventory.treads.length||!point(s.lowerEndParameters,2)||!equal(s.lowerEndParameters,s.upperStartParameters)||![s.endRiserCurve,s.nextStartRiserCurve,s.endLine,s.nextStartLine].every(curve)||!sameCurveControls(s.endRiserCurve,s.nextStartRiserCurve)||!sameCurveControls(s.endLine,s.nextStartLine)||s.endLine.direction[2]!==0||s.nextStartLine.direction[2]!==0||greater(new Rational(4n),lineWidthSquared(s.endLine)))return;
   const lo=inventory.treads[s.lowerTreadIndex]!,hi=inventory.treads[s.upperTreadIndex]!,a=edge(lo.ringFeet,s.lowerBoundaryIndices),b=edge(hi.ringFeet,s.upperBoundaryIndices),direction:P2=[hi.sourceOriginFeet[0]-lo.sourceOriginFeet[0],hi.sourceOriginFeet[1]-lo.sourceOriginFeet[1]];if(!a||!b||!direction.some(n=>n!==0)||!orderedBoundary(lo.ringFeet,a,direction,true)||!orderedBoundary(hi.ringFeet,b,direction,false)||hi.elevationFeet<=lo.elevationFeet||hi.elevationFeet-lo.elevationFeet>1.2)return;
   // Source exporter supplies ordered endpoint correspondence. Reordering by
   // distance, nearest face, hull or epsilon would create a new authority.
   const triangles:[[P2,P2,P2],[P2,P2,P2]]=[[a[0],a[1],b[1]],[a[0],b[1],b[0]]];
   const positive=triangles.filter(t=>positiveTriangle(...t));
   const parts=positive.length?nativeRationalOverlay('union',positive.map(t=>[[...t,t[0]]])):[];
   result.push({index:s.index,nativeRunId:inventory.nativeRunId,sourceHeightBand:[lo.elevationFeet,hi.elevationFeet],lowerBoundaryXYZ:a.map(p=>[...p,lo.elevationFeet]) as [P3,P3],upperBoundaryXYZ:b.map(p=>[...p,hi.elevationFeet]) as [P3,P3],parts});
  }
  return result;
 }catch{return;}
}

/** Width helper may add these only to the matching original tread-to-tread
 * transition. Nominal heights, unrelated rooms/landings and terminal slabs
 * cannot borrow their projection. */
export function nativeSourceStairRiserPartsForSegment(projections:readonly NativeStairRiserProjection[],a:P3,b:P3):NativeRationalParts{
 return projections.filter(p=>p.sourceHeightBand[0]===a[2]&&p.sourceHeightBand[1]===b[2]).flatMap(p=>p.parts);
}
