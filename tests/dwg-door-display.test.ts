import {test} from 'node:test';import assert from 'node:assert/strict';
import {cadDoorDisplayStrokes,type CadDoorDisplayFloor} from '../lib/reviter/dwg-door-display.ts';
test('abstract display removes only registered swings and leaf strokes without mutating source',()=>{
 const f:CadDoorDisplayFloor={primitives:[{sourceHandle:'arc',type:'ARC',pointsMetres:[[0,0],[1,1],[2,0]]},{sourceHandle:'unknown',type:'ARC',pointsMetres:[[4,0],[5,1],[6,0]]},{sourceHandle:'leaf',type:'LINE',pointsMetres:[[0,0],[0,1]]},{sourceHandle:'wall',type:'LINE',pointsMetres:[[2,0],[2,5]]}],doors:[{arcHandles:['arc'],leafHandles:['leaf']}]};
 const original=JSON.stringify(f);assert.deepEqual(cadDoorDisplayStrokes(f,false),[f.primitives[1]!.pointsMetres,f.primitives[3]!.pointsMetres]);assert.deepEqual(cadDoorDisplayStrokes(f,true),f.primitives.map(p=>p.pointsMetres));assert.equal(JSON.stringify(f),original);
});
test('compound leaf polylines retain neighbouring wall and frame segments',()=>{
 const f:CadDoorDisplayFloor={primitives:[{sourceHandle:'compound',type:'LWPOLYLINE',pointsMetres:[[0,0],[1,0],[1,1],[2,1]]}],doors:[{leafHandles:['compound'],leafSegmentsMetres:[[[1,1],[1,0]]]}]};
 assert.deepEqual(cadDoorDisplayStrokes(f,false),[[[0,0],[1,0]],[[1,1],[2,1]]]);
});
