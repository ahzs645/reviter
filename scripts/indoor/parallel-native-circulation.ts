import {serialize} from 'node:v8';
import {mkdir,open,link,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {prepareNativeCirculationGeometry,nativeCirculationElevations,mergeNativeCirculationPlaneDrafts,type NativeCirculationPlaneDraft} from '../../lib/reviter/native-circulation-geometry.ts';
import type {IndoorDataset} from '../../lib/reviter/indoor-contract.ts';
import type {ConvertResult} from '../../lib/reviter/types.ts';
import {createCheckpointBinding,runBoundedCheckpointTasks,readCheckpointResult,hashFile,sha256} from './bounded-worker-checkpoints.ts';
const root=fileURLToPath(new URL('../../',import.meta.url));
export type NativeParallelOptions={checkpointDir:string;maxWorkers:1|2;maxInFlightBytes?:number;workerHeapMiB?:number;taskMemoryBytes?:number;onProgress?:(message:string)=>void};
async function snapshot(directory:string,name:string,value:unknown){
 const bytes=serialize(value),digest=sha256(bytes),path=resolve(directory,name+'-'+digest+'.bin');
 const temporary=path+'.tmp-'+process.pid+'-'+crypto.randomUUID();let file;
 try{file=await open(temporary,'wx');await file.writeFile(bytes);await file.sync();await file.close();file=undefined;
  try{await link(temporary,path);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(await hashFile(path)!==digest)throw Error('Existing immutable native snapshot is damaged: '+path);}
  const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
 }finally{await file?.close();await rm(temporary,{force:true});}
 return {name,path,bytes:bytes.length};
}
/** No Node dependency enters browser compilation. Each isolated worker reuses
 * its own exact geometry/WASM context; only complete plane drafts are merged.
 * Parent route/arrival decisions run afterward in their original order. */
export async function prepareParallelNativeCirculation(model:ConvertResult,data:IndoorDataset,options:NativeParallelOptions){
 if(!data.nativeIndoorEnvelopes)throw Error('Native worker compilation requires native source enclosures');
 if(![1,2].includes(options.maxWorkers))throw Error('Begin with one or two native workers');
 const checkpointDir=resolve(options.checkpointDir),inputDirectory=resolve(checkpointDir,'inputs');await mkdir(inputDirectory,{recursive:true});
 const inputs=[];for(const [name,value]of [['native-model',model],['native-dataset',data]] as const)inputs.push(await snapshot(inputDirectory,name,value));
 const workerModule=new URL('./native-circulation-plane-worker.ts',import.meta.url);
 // Use esbuild only to enumerate the complete resolved runtime dependency
 // graph. Workers execute original source, not this unused analysis output.
 const dependencyGraph=await build({entryPoints:[fileURLToPath(workerModule)],absWorkingDir:root,bundle:true,platform:'node',format:'esm',write:false,metafile:true,logLevel:'silent'});
 const algorithmFiles=[...Object.keys(dependencyGraph.metafile!.inputs).map(p=>resolve(root,p)),fileURLToPath(import.meta.url),resolve(root,'scripts/register-local-typescript.mjs'),resolve(root,'scripts/local-typescript-resolver.mjs'),resolve(root,'lib/reviter/vendor/native-exact-geos/native-exact-geos.wasm'),resolve(root,'package.json'),resolve(root,'package-lock.json')];
 const binding=await createCheckpointBinding({immutableInputs:inputs.map(({name,path})=>({name,path})),algorithmFiles,algorithmVersion:'native-independent-plane-drafts-v1:'+process.version});
 const planes=nativeCirculationElevations(data),taskMemoryBytes=options.taskMemoryBytes??512*1024*1024,workerMemoryBytes=Math.max(256*1024*1024,inputs.reduce((s,i)=>s+i.bytes,0)*8);
 const result=await runBoundedCheckpointTasks({workerModule,checkpointDir:resolve(checkpointDir,binding.sha256),binding,tasks:planes.map(elevationFeet=>({id:'native-plane:'+String(elevationFeet),input:{elevationFeet},estimatedMemoryBytes:taskMemoryBytes})),maxWorkers:options.maxWorkers,maxInFlightBytes:options.maxInFlightBytes??16*1024*1024*1024,workerMemoryBytes,workerResourceLimits:{maxOldGenerationSizeMb:options.workerHeapMiB??8192},maxResultBytes:taskMemoryBytes,onProgress:e=>options.onProgress?.(`Native physical planes · ${e.completed}/${e.total} · ${e.id} · ${e.reused?'checked checkpoint reused':'checkpoint saved'}`)});
 const drafts:NativeCirculationPlaneDraft[]=[];for(const row of result.results)drafts.push(await readCheckpointResult(row,taskMemoryBytes) as unknown as NativeCirculationPlaneDraft);
 const merged=mergeNativeCirculationPlaneDrafts(data,drafts);
 const receipt={format:'reviter-native-plane-compiler-checkpoints',version:1,bindingSha256:binding.sha256,algorithmVersion:binding.algorithmVersion,elevationsFeet:planes,workerLimit:options.maxWorkers,workerHeapMiB:options.workerHeapMiB??8192,maximumInFlightBytes:options.maxInFlightBytes??16*1024*1024*1024,workerBaseMemoryEstimate:workerMemoryBytes,peakWorkers:result.peakWorkers,peakInFlightEstimatedBytes:result.peakInFlightBytes,results:result.results,sourceMetadataMutated:false,routeDecisionsParallelized:false,finiteEnclosureCertified:false,limits:'Estimated in-flight budget plus per-worker JS heap cap; WASM/native allocations are not an OS hard RSS limit. Parent retains completed plane drafts for deterministic merge; parent/merge memory is outside the in-flight worker estimate. Complete input and resolved compiler bytes bind reuse; checkpoints are incomplete physical work, not geometry approval.'};
 const receiptPath=resolve(checkpointDir,binding.sha256,'plane-compiler-receipt.json');
 // This execution receipt changes reuse/timing metadata; retain prior runs.
 const receiptFile=await open(receiptPath+'.'+Date.now()+'.'+crypto.randomUUID(),'wx');try{await receiptFile.writeFile(JSON.stringify(receipt,null,2));await receiptFile.sync();}finally{await receiptFile.close();}
 return {result:merged,receipt};
}
export function createNativeParallelCompiler(options:NativeParallelOptions){return async(model:ConvertResult,data:IndoorDataset)=>{
 // Native-interior promotion may first compile the unchanged legacy source
 // as an identity prepass. Only complete native planes enter the worker pool.
 if(!data.nativeIndoorEnvelopes){options.onProgress?.('Native floor workers · source identity prepass remains sequential');return prepareNativeCirculationGeometry(model,data);}
 return(await prepareParallelNativeCirculation(model,data,options)).result;
};}
