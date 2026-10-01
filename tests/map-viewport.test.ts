import test from 'node:test';import assert from 'node:assert/strict';
import {zoomMapViewBox,type MapViewBox}from '../lib/reviter/map-viewport.ts';
test('zoom preserves the cursor position, aspect ratio and model coordinates at its limits',()=>{
  const fitted:MapViewBox=[100,-800,200,100],anchor:[number,number]=[150,-770];let view=fitted;
  const fractions=(v:MapViewBox)=>[(anchor[0]-v[0])/v[2],(anchor[1]-v[1])/v[3]];
  for(const factor of [.8,.8,1.25,.00001,100000]){view=zoomMapViewBox(view,factor,anchor,fitted);assert.ok(fractions(view).every((v,i)=>Math.abs(v-fractions(fitted)[i]!)<1e-10));assert.equal(view[2]/view[3],2);assert.ok(view[2]>=5&&view[2]<=1600);}
  assert.deepEqual(zoomMapViewBox(zoomMapViewBox(fitted,.8,anchor,fitted),1.25,anchor,fitted),fitted);
});

test('rapid wheel events accumulate before paint and reverse without moving the cursor anchor',async()=>{
 const {zoomPendingMapView,wheelZoomFactor}=await import('../lib/reviter/map-viewport.ts');
 const fitted:MapViewBox=[100,-800,200,100],cursor:[number,number]=[150,-770];let live=fitted;
 for(let i=0;i<20;i++)live=zoomPendingMapView(live,fitted,cursor,wheelZoomFactor(-10,0,600),fitted);
 assert.ok(Math.abs(live[2]-200*Math.exp(-.3))<1e-9);
 assert.ok(Math.abs((cursor[0]-live[0])/live[2]-.25)<1e-9);
 assert.ok(Math.abs((cursor[1]-live[1])/live[3]-.3)<1e-9);
 for(let i=0;i<20;i++)live=zoomPendingMapView(live,fitted,cursor,wheelZoomFactor(10,0,600),fitted);
 assert.ok(live.every((v,i)=>Math.abs(v-fitted[i]!)<1e-9));
 assert.equal(wheelZoomFactor(-1,1,600),wheelZoomFactor(-16,0,600));
 assert.equal(wheelZoomFactor(1,2,600),wheelZoomFactor(600,0,600));
});
