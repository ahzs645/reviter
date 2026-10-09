import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeParallelPhysicalSource} from './fixtures/native-parallel-physical-source.ts';
import {prepareNativeCirculationGeometry} from '../lib/reviter/native-circulation-geometry.ts';
import {createNativeParallelCompiler,prepareParallelNativeCirculation} from '../scripts/indoor/parallel-native-circulation.ts';
import {initializeNativeExactGeosOverlay} from '../lib/reviter/native-exact-geos-overlay.ts';

test('native promotion identity prepass keeps the original sequential legacy geometry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-legacy-prepass-'));
 try{
  await initializeNativeExactGeosOverlay();
  const {model,data}=await nativeParallelPhysicalSource(2,2);
  delete data.nativeIndoorEnvelopes;
  const checkpointDir=join(root,'unused'),before=JSON.stringify([model,data]);
  const expected=prepareNativeCirculationGeometry(model,data);
  const actual=await createNativeParallelCompiler({checkpointDir,maxWorkers:2})(model,data);
  assert.equal(JSON.stringify(actual),JSON.stringify(expected));
  assert.equal(JSON.stringify([model,data]),before);
  await assert.rejects(access(checkpointDir));
  await assert.rejects(prepareParallelNativeCirculation(model,data,{checkpointDir,maxWorkers:2}),/native source enclosures/);
 }finally{await rm(root,{recursive:true,force:true});}
});
