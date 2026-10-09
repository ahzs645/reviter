import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePlaneJsonCarrier} from '../scripts/indoor/native-circulation-plane-worker.ts';
import {strictJson} from '../scripts/indoor/bounded-worker-checkpoints.ts';

test('native presentation carrier only normalizes negative zero; exact topology strings survive',()=>{
 const value={point:[-0,1],exact:[['9007199254740993','7'],['0','1']]};
 const carrier=nativePlaneJsonCarrier(value);
 assert.equal(strictJson(carrier),'{"point":[0,1],"exact":[["9007199254740993","7"],["0","1"]]}');
 assert(Object.is(value.point[0],-0));
});
test('native carriers reject unsupported prototypes, hooks, sparse arrays and numeric non-index keys',()=>{
 let called=false;
 class ArraySubclass extends Array<number>{toJSON(){called=true;return [99];}}
 class RationalLike{n=1n;d=3n;toJSON(){called=true;return 0.333;}}
 for(const value of [undefined,1n,NaN,Infinity,new RationalLike(),new ArraySubclass(1),new Date(),new Map(),[,,]])assert.throws(()=>nativePlaneJsonCarrier(value));
 for(const key of ['4294967295','9007199254740993','01','1.0','-0','-1']){const value=[1];Object.defineProperty(value,key,{value:2,enumerable:true});assert.throws(()=>nativePlaneJsonCarrier(value));}
 const getter=[1];Object.defineProperty(getter,'0',{enumerable:true,get(){called=true;return 99;}});assert.throws(()=>nativePlaneJsonCarrier(getter));
 const own=[1];Object.defineProperty(own,'toJSON',{enumerable:true,value:()=>{called=true;return [99];}});assert.throws(()=>nativePlaneJsonCarrier(own));
 const symbol=[1];Object.defineProperty(symbol,Symbol('extra'),{value:2});assert.throws(()=>nativePlaneJsonCarrier(symbol));
 const object={};Object.defineProperty(object,'value',{get(){called=true;return 99;},enumerable:true});assert.throws(()=>nativePlaneJsonCarrier(object));
 assert.equal(called,false);
});
