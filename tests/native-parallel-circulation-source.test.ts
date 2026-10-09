import assert from'node:assert/strict';import test from'node:test';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{nativeParallelPhysicalSource}from'./fixtures/native-parallel-physical-source.ts';
import{prepareNativeCirculationGeometry}from'../lib/reviter/native-circulation-geometry.ts';
import{initializeNativeExactGeosOverlay}from'../lib/reviter/native-exact-geos-overlay.ts';
import{prepareParallelNativeCirculation}from'../scripts/indoor/parallel-native-circulation.ts';
test('actual one and two native workers preserve source bytes and reuse every completed plane after restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'native-physical-plane-workers-'));
 try{
  await initializeNativeExactGeosOverlay();const{model,data}=await nativeParallelPhysicalSource(4,6),before=JSON.stringify([model,data]);assert.ok(Object.is(model.elementBounds[0]!.boundsFeet.min.x,-0));
  const sequential=prepareNativeCirculationGeometry(model,data),expected=JSON.stringify(sequential);assert.ok(sequential.geometry.cells.length>=4);assert.ok(sequential.geometry.exactTopology&&sequential.geometry.displayResidualTopology);
  for(const maxWorkers of[1,2]as const){
   const checkpointDir=join(directory,'pool-'+maxWorkers),options={checkpointDir,maxWorkers,workerHeapMiB:512,taskMemoryBytes:128*1024*1024,maxInFlightBytes:1024*1024*1024};
   const cold=await prepareParallelNativeCirculation(model,data,options);assert.equal(JSON.stringify(cold.result),expected);assert.equal(cold.receipt.peakWorkers,maxWorkers);assert.ok(cold.receipt.results.every(r=>!r.reused));
   const restarted=await prepareParallelNativeCirculation(model,data,options);assert.equal(JSON.stringify(restarted.result),expected);assert.equal(restarted.receipt.bindingSha256,cold.receipt.bindingSha256);assert.ok(restarted.receipt.results.every(r=>r.reused));assert.equal(restarted.receipt.peakWorkers,0);
  }
  assert.equal(JSON.stringify([model,data]),before);assert.ok(Object.is(model.elementBounds[0]!.boundsFeet.min.x,-0),'JSON worker wire canonicalization never mutates original source -0');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('native worker carrier canonicalizes only negative zero and rejects lossy values without running hooks',async()=>{
 const{nativePlaneJsonCarrier}=await import('../scripts/indoor/native-circulation-plane-worker.ts');
 const original={x:-0,nested:[-0,1,'exact rational',true,null]};assert.equal(JSON.stringify(nativePlaneJsonCarrier(original)),JSON.stringify(original));assert.ok(Object.is(original.x,-0));
 let hooks=0;const getter=Object.defineProperty({},'x',{enumerable:true,get(){hooks++;return 3;}}),arrayGetter=Object.defineProperty([],'0',{enumerable:true,get(){hooks++;return 3;}}),toJSON={toJSON(){hooks++;return{};}};
 const cyclic:any={};cyclic.self=cyclic;
 for(const bad of[NaN,Infinity,-Infinity,1n,undefined,new Date(),new Map(),getter,arrayGetter,toJSON,cyclic,[,],Object.assign([],{extra:3}),Object.assign([],{'4294967295':3}),Object.assign([],{'9007199254740991':3}),{[Symbol('opaque')]:1}])assert.throws(()=>nativePlaneJsonCarrier(bad));
 assert.equal(hooks,0);
 const prior=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');
 try{Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value(){hooks++;return{};}});assert.throws(()=>nativePlaneJsonCarrier({physical:true}));assert.equal(hooks,0);}finally{if(prior)Object.defineProperty(Object.prototype,'toJSON',prior);else delete(Object.prototype as any).toJSON;}
});
