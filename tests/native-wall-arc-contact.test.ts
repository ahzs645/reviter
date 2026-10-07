import assert from 'node:assert/strict';
import test from 'node:test';
import pc from 'polygon-clipping';
import {nativeWallArcPolygon} from '../lib/reviter/architectural-plan.ts';
import type {WallArc} from '../lib/reviter/types.ts';
const arc=(extra:Partial<WallArc>={}):WallArc=>({elementId:1,centre:{x:0,y:0},radius:5,thickness:.2,startAngle:0,endAngle:Math.PI,baseElevation:0,topElevation:10,xDir:{x:1,y:0},yDir:{x:0,y:1},...extra});
const old=(a:WallArc)=>{const sweep=a.endAngle-a.startAngle,steps=Math.max(16,Math.ceil(Math.abs(sweep*a.radius)/.25)),side=(r:number)=>Array.from({length:steps+1},(_,i)=>{const t=a.startAngle+sweep*i/steps;return[a.centre.x+r*(Math.cos(t)*a.xDir.x+Math.sin(t)*a.yDir.x),a.centre.y+r*(Math.cos(t)*a.xDir.y+Math.sin(t)*a.yDir.y)]as[number,number]});return[...side(a.radius+a.thickness/2),...side(a.radius-a.thickness/2).reverse()];};
const near=(p:number[],q:number[])=>Math.hypot(p[0]!-q[0]!,p[1]!-q[1]!)<1e-10;

test('exact analytic extrema retain all original chord points and both radii',()=>{
 const a=arc(),ring=nativeWallArcPolygon(a),before=old(a);assert(before.every(p=>ring.some(q=>near(p,q))));
 assert(ring.some(p=>near(p,[0,5.1])));assert(ring.some(p=>near(p,[0,4.9])));
 for(const p of ring){const r=Math.hypot(p[0],p[1]);assert(Math.abs(r-5.1)<1e-10||Math.abs(r-4.9)<1e-10)}
 assert.equal(ring.length,before.length+2);
});

test('persisted arc tangent meets a flat native member instead of exporting a chord gap',()=>{
 const a=arc(),rectangle=(x0:number,y0:number,x1:number,y1:number)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]as[number,number][],floor=[rectangle(-7,-1,7,7)],base=[rectangle(-7,-.2,7,.2)],mullion=[rectangle(-.2,5.1,.2,7)];
 const before=pc.difference(floor,[old(a)],base,mullion),after=pc.difference(floor,[nativeWallArcPolygon(a)],base,mullion);
 assert.equal(before.length,3);assert.equal(after.length,4);
 assert.equal(Math.max(...old(a).map(p=>p[1]))<5.1,true);assert.equal(Math.max(...nativeWallArcPolygon(a).map(p=>p[1])),5.1);
});

test('rotated axes and reversed sweep preserve extrema, endpoints and original samples',()=>{
 const rotation=.37,c=Math.cos(rotation),s=Math.sin(rotation),a=arc({centre:{x:12,y:-8},xDir:{x:c,y:s},yDir:{x:-s,y:c},startAngle:3.24,endAngle:-.03}),ring=nativeWallArcPolygon(a),before=old(a);
 assert(before.every(p=>ring.some(q=>near(p,q))));assert(near(ring[0]!,before[0]!));assert(near(ring.at(-1)!,before.at(-1)!));
 // World north/south and east extrema within the retained sweep, for both faces.
 for(const r of[5.1,4.9])for(const t of[Math.PI/2-rotation,Math.PI-rotation,-rotation]){
  if(t<Math.min(a.startAngle,a.endAngle)||t>Math.max(a.startAngle,a.endAngle))continue;
  const p=[a.centre.x+r*(Math.cos(t)*c-Math.sin(t)*s),a.centre.y+r*(Math.cos(t)*s+Math.sin(t)*c)];assert(ring.some(q=>near(p,q)));
 }
});

test('extrema outside a short arc span are never inserted and native parameters remain untouched',()=>{
 const a=arc({startAngle:.2,endAngle:.4}),saved=JSON.stringify(a);assert.deepEqual(nativeWallArcPolygon(a),old(a));assert.equal(JSON.stringify(a),saved);
});
