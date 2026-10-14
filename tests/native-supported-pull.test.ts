import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSupportedPull} from '../lib/reviter/native-circulation-geometry.ts';
import {nativeRationalOverlay} from '../lib/reviter/native-rational-overlay.ts';
import {nativeRationalPathSupported} from '../lib/reviter/native-exact-planar-topology.ts';
const rect=(x0:number,y0:number,x1:number,y1:number):[number,number][]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];

test('a planned path pulls tight through exactly supported segments and skips an unsupported snap point',()=>{
 // An L-shaped corridor face; the planner snapped the start onto a point outside it.
 const face=nativeRationalOverlay('union',[[rect(0,0,10,2)],[rect(8,0,10,10)]]);
 const planned:[number,number][]=[[1,1],[1,2.5],[5,1],[9,1],[9,5],[9,9]];
 assert.equal(nativeRationalPathSupported(planned,face),false);
 const pulled=nativeSupportedPull(planned,face);
 assert.deepEqual(pulled,[[1,1],[9,1],[9,9]]);
 assert.equal(nativeRationalPathSupported(pulled!,face),true,'the pulled path is exactly supported');
});

test('a pull never shortcuts across material and refuses a step with no supported segment',()=>{
 const face=nativeRationalOverlay('union',[[rect(0,0,10,2)],[rect(8,0,10,10)]]);
 assert.equal(nativeSupportedPull([[1,1],[9,9]],face),undefined,'the inside corner is not cut');
 assert.equal(nativeSupportedPull([[1,1],[5,5],[9,9]],face),undefined,'an outside bend cannot be reached');
 assert.deepEqual(nativeSupportedPull([[1,1],[9,1.5],[9,9]],face),[[1,1],[9,1.5],[9,9]]);
});
