import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,open,readFile,rename,rm,link,type FileHandle} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Worker,type ResourceLimits} from 'node:worker_threads';

export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type FileBinding={name:string;path:string;sha256:string};
export type CheckpointBinding={version:1;algorithmVersion:string;immutableInputs:FileBinding[];algorithmFiles:FileBinding[];sha256:string};
export type CheckpointTask={id:string;input:JsonValue;estimatedMemoryBytes:number};
export type CheckpointResult={id:string;path:string;resultSha256:string;resultBytes:number;reused:boolean};
export type CheckpointWorkerContext={binding:CheckpointBinding;readVerifiedInput:(name:string)=>Promise<Uint8Array>};
export type CheckpointWorkerModule<State=unknown>={initialize?:(context:CheckpointWorkerContext)=>Promise<State>|State;runTask:(input:JsonValue,state:State,context:CheckpointWorkerContext)=>Promise<JsonValue>|JsonValue};
export const sha256=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
/** Preserve the parent's explicit TS resolver/loader. Packaged Node runtimes
 * can inject process-only V8/TLS/snapshot flags that Worker rejects; memory
 * settings belong to resourceLimits rather than inherited heap overrides. */
export function workerTypeScriptExecArgv(args:readonly string[]):string[] {
 const result:string[]=[];
 for(let i=0;i<args.length;i++){
  const arg=args[i]!;
  if(/^--(?:import|loader|experimental-loader|require)(?:=|$)/.test(arg)||arg==='-r'){
   result.push(arg);if(!arg.includes('=')){const value=args[++i];if(!value)throw Error('Missing Node loader argument');result.push(value);}
  }else if(['--experimental-strip-types','--experimental-transform-types','--enable-source-maps','--no-warnings'].includes(arg))result.push(arg);
 }
 return result;
}
const hashPattern=/^[a-f0-9]{64}$/;
const positive=(v:number)=>Number.isSafeInteger(v)&&v>0;

/** Require an explicit lossless JSON carrier. Never invoke a prototype's
 * toJSON or silently clone Rational, BigInt, Date, Map or nonfinite values. */
export function strictJson(value:unknown):string {
 const seen=new Set<object>();
 function visit(v:unknown):void {
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))throw Error('Explicit lossless JSON carrier required for nonfinite numbers or -0');return;}
  if(typeof v!=='object')throw Error('Explicit lossless JSON carrier required');
  if(seen.has(v))throw Error('Cyclic JSON carrier');seen.add(v);
  if(Array.isArray(v)){
   if(Object.getPrototypeOf(v)!==Array.prototype||Object.getOwnPropertyDescriptor(Array.prototype,'toJSON')||Object.getOwnPropertyDescriptor(Object.prototype,'toJSON')||Reflect.ownKeys(v).some(k=>k!=='length'&&(typeof k!=='string'||String(Number(k))!==k||!Number.isInteger(Number(k))||Number(k)<0||Number(k)>=v.length)))throw Error('Explicit plain array JSON carrier required');
   const descriptors=Object.getOwnPropertyDescriptors(v);
   for(let i=0;i<v.length;i++){const d=descriptors[i];if(!d)throw Error('Sparse JSON carrier');if(!d.enumerable||!('value'in d))throw Error('Array JSON carrier cannot contain accessors');visit(d.value);}
  }
  else {
   if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw Error('Explicit lossless JSON carrier required for object prototypes');
   if(Object.getPrototypeOf(v)===Object.prototype&&Object.getOwnPropertyDescriptor(Object.prototype,'toJSON'))throw Error('JSON carrier cannot inherit toJSON');
   if(Reflect.ownKeys(v).some(k=>typeof k!=='string'))throw Error('Symbol JSON carrier');
   for(const [key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(v))){if(!descriptor.enumerable||!('value'in descriptor)||key==='toJSON')throw Error('JSON carrier cannot contain accessors or toJSON');visit(descriptor.value);}
  }
  seen.delete(v);
 }
 visit(value);return JSON.stringify(value);
}

export async function hashFile(path:string):Promise<string> {
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');
}
const bindingBytes=(b:Omit<CheckpointBinding,'sha256'>|CheckpointBinding)=>JSON.stringify({version:b.version,algorithmVersion:b.algorithmVersion,immutableInputs:b.immutableInputs,algorithmFiles:b.algorithmFiles});
export async function createCheckpointBinding(options:{immutableInputs:{name:string;path:string}[];algorithmFiles:string[];algorithmVersion:string}):Promise<CheckpointBinding> {
 if(!options.algorithmVersion||!options.immutableInputs.length||!options.algorithmFiles.length)throw Error('Full immutable input and transitive algorithm bindings required');
 if(new Set(options.immutableInputs.map(f=>f.name)).size!==options.immutableInputs.length)throw Error('Duplicate immutable input names');
 const inputs=options.immutableInputs.toSorted((a,b)=>a.name.localeCompare(b.name));
 const algorithm=[...new Set([...options.algorithmFiles, fileURLToPath(new URL('./bounded-worker-checkpoints.ts',import.meta.url)),fileURLToPath(new URL('./bounded-checkpoint-worker.ts',import.meta.url))].map(p=>resolve(p)))].sort();
 const b:Omit<CheckpointBinding,'sha256'>={version:1,algorithmVersion:options.algorithmVersion,
  immutableInputs:await Promise.all(inputs.map(async f=>({name:f.name,path:resolve(f.path),sha256:await hashFile(resolve(f.path))}))),
  algorithmFiles:await Promise.all(algorithm.map(async path=>({name:path,path,sha256:await hashFile(path)})))};
 return {...b,sha256:sha256(bindingBytes(b))};
}
export async function verifyCheckpointBinding(binding:CheckpointBinding):Promise<void> {
 if(binding.version!==1||!binding.algorithmVersion||!binding.immutableInputs.length||!binding.algorithmFiles.length||!hashPattern.test(binding.sha256)||sha256(bindingBytes(binding))!==binding.sha256)throw Error('Invalid checkpoint binding');
 for(const f of [...binding.immutableInputs,...binding.algorithmFiles])if(!hashPattern.test(f.sha256)||await hashFile(f.path)!==f.sha256)throw Error('Stale checkpoint input or algorithm: '+f.name);
}

type Header={format:'reviter-bounded-checkpoint';version:1;bindingSha256:string;taskId:string;taskInputSha256:string;resultSha256:string;resultBytes:number};
async function inspect(path:string):Promise<{header:Header;payloadOffset:number}|undefined> {
 let file;try {
  file=await open(path,'r');const prefix=Buffer.alloc(65536);const {bytesRead}=await file.read(prefix,0,prefix.length,0),newline=prefix.subarray(0,bytesRead).indexOf(10);if(newline<0)return;
  const header:Header=JSON.parse(prefix.subarray(0,newline).toString('utf8'));
  if(header.format!=='reviter-bounded-checkpoint'||header.version!==1||!hashPattern.test(header.bindingSha256)||!hashPattern.test(header.taskInputSha256)||!hashPattern.test(header.resultSha256)||!positive(header.resultBytes))return;
  const stat=await file.stat();if(stat.size!==newline+1+header.resultBytes)return;
  const digest=createHash('sha256');for await(const chunk of createReadStream(path,{start:newline+1}))digest.update(chunk);
  if(digest.digest('hex')!==header.resultSha256)return;
  return {header,payloadOffset:newline+1};
 }catch{return;}finally{await file?.close();}
}
/** Read one verified result at a time. The pool retains references rather than
 * every large plane payload; callers can deterministically merge in task order. */
export async function readCheckpointResult(result:CheckpointResult,maxBytes=512*1024*1024):Promise<JsonValue> {
 if(!positive(maxBytes)||!positive(result.resultBytes)||result.resultBytes>maxBytes)throw Error('Checkpoint read exceeds memory/result budget: '+result.id);
 const checked=await inspect(result.path);if(!checked||checked.header.taskId!==result.id||checked.header.resultSha256!==result.resultSha256||checked.header.resultBytes!==result.resultBytes)throw Error('Corrupt checkpoint result: '+result.id);
 const file=await open(result.path,'r');try{const bytes=Buffer.alloc(result.resultBytes);let offset=0;while(offset<bytes.length){const q=await file.read(bytes,offset,bytes.length-offset,checked.payloadOffset+offset);if(!q.bytesRead)throw Error('Truncated checkpoint result');offset+=q.bytesRead;}if(sha256(bytes)!==result.resultSha256)throw Error('Changed checkpoint result');const value:unknown=JSON.parse(bytes.toString('utf8'));strictJson(value);return value as JsonValue;}finally{await file.close();}
}
async function atomicCheckpoint(path:string,header:Header,result:string):Promise<void> {
 const temporary=path+'.tmp-'+process.pid+'-'+randomUUID();let file;
 try{file=await open(temporary,'wx');await file.writeFile(JSON.stringify(header)+'\n');await file.writeFile(result);await file.sync();await file.close();file=undefined;await rename(temporary,path);
  const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
 }finally{await file?.close();await rm(temporary,{force:true});}
}
function processAlive(pid:number):boolean {
 if(!positive(pid))throw Error('Malformed checkpoint lock PID');
 try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}
}
/** A fully written/fsynced proposal is linked atomically, so a killed process
 * cannot leave an empty lock whose owner is impossible to identify. */
async function linkLock(path:string,bindingSha256:string):Promise<FileHandle> {
 const proposed=path+'.proposal-'+randomUUID(),file=await open(proposed,'wx');
 try{await file.writeFile(JSON.stringify({pid:process.pid,bindingSha256}));await file.sync();await link(proposed,path);return file;}
 catch(error){await file.close();throw error;}finally{await rm(proposed,{force:true});}
}
async function acquireDirectoryLock(path:string,bindingSha256:string):Promise<FileHandle> {
 try{return await linkLock(path,bindingSha256);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const recovery=path+'.recovery';let gate:FileHandle;
 try{gate=await linkLock(recovery,bindingSha256);}catch{throw Error('Another checkpoint lock recovery is active: '+recovery);}
 try{
  // Only one recovery holder may remove the old lock. A normal new runner may
  // win the subsequent link race; EEXIST then preserves that live owner.
  const old=JSON.parse(await readFile(path,'utf8')) as {pid:number};
  if(processAlive(old.pid))throw Error('Checkpoint directory has a live runner: '+old.pid);
  await rm(path);return await linkLock(path,bindingSha256);
 }finally{await gate.close();await rm(recovery,{force:true});}
}

export async function runBoundedCheckpointTasks(options:{workerModule:URL;checkpointDir:string;binding:CheckpointBinding;tasks:CheckpointTask[];maxWorkers:number;maxInFlightBytes:number;workerMemoryBytes?:number;workerResourceLimits?:ResourceLimits;maxResultBytes?:number;beforeCheckpointCommit?:(id:string)=>Promise<void>;onProgress?:(event:{id:string;reused:boolean;completed:number;total:number})=>void}):Promise<{results:CheckpointResult[];bindingSha256:string;peakWorkers:number;peakInFlightBytes:number}> {
 const {binding}=options;await verifyCheckpointBinding(binding);
 if(options.workerModule.protocol!=='file:'||!binding.algorithmFiles.some(f=>f.path===resolve(fileURLToPath(options.workerModule))))throw Error('Worker module must belong to bound algorithm files');
 if(!positive(options.maxWorkers)||options.maxWorkers>64||!positive(options.maxInFlightBytes))throw Error('Invalid bounded worker limits');
 const base=options.workerMemoryBytes??0,maximumResult=options.maxResultBytes??512*1024*1024;
 if(!Number.isSafeInteger(base)||base<0||!positive(maximumResult))throw Error('Invalid worker memory/result budget');
 if(new Set(options.tasks.map(t=>t.id)).size!==options.tasks.length||options.tasks.some(t=>!t.id||!positive(t.estimatedMemoryBytes)||t.estimatedMemoryBytes+base>options.maxInFlightBytes))throw Error('Duplicate tasks or task exceeds memory budget');
 const pending=options.tasks.map((t,index)=>({id:t.id,index,estimatedMemoryBytes:t.estimatedMemoryBytes,inputJson:strictJson(t.input),inputSha256:sha256(strictJson(t.input))}));
 if(pending.some(t=>Buffer.byteLength(t.inputJson)>t.estimatedMemoryBytes))throw Error('Task input exceeds declared memory budget');
 const results:CheckpointResult[]=new Array(pending.length),directory=resolve(options.checkpointDir);await mkdir(directory,{recursive:true});
 const lockPath=resolve(directory,'.runner-lock'),lock=await acquireDirectoryLock(lockPath,binding.sha256);
 const workers:Worker[]=[],slots:{worker:Worker;busy:boolean}[]=[],active=new Map<number,Promise<{slot:number;task:typeof pending[number];message:{resultJson:string}|{error:string}}>>();
 let completed=0,inFlight=0,peakInFlightBytes=0,peakWorkers=0;
 try{
  for(let i=pending.length-1;i>=0;i--){const t=pending[i]!,path=resolve(directory,sha256(t.id)+'.checkpoint'),old=await inspect(path);
   if(old&&old.header.resultBytes<=maximumResult&&old.header.resultBytes<=t.estimatedMemoryBytes&&old.header.bindingSha256===binding.sha256&&old.header.taskId===t.id&&old.header.taskInputSha256===t.inputSha256){results[t.index]={id:t.id,path,resultSha256:old.header.resultSha256,resultBytes:old.header.resultBytes,reused:true};pending.splice(i,1);completed++;options.onProgress?.({id:t.id,reused:true,completed,total:options.tasks.length});}}
  if(!pending.length){await verifyCheckpointBinding(binding);return {results,bindingSha256:binding.sha256,peakWorkers:0,peakInFlightBytes:0};}
  const largest=Math.max(...pending.map(t=>t.estimatedMemoryBytes)),count=Math.min(options.maxWorkers,pending.length,base?Math.floor((options.maxInFlightBytes-largest)/base):options.maxWorkers);
  if(count<1)throw Error('Worker base memory plus task exceeds budget');
  inFlight=base*count;peakInFlightBytes=inFlight;
  await Promise.all(Array.from({length:count},async()=>{
   const worker=new Worker(new URL('./bounded-checkpoint-worker.ts',import.meta.url),{workerData:{moduleURL:options.workerModule.href,binding},resourceLimits:{maxOldGenerationSizeMb:512,...options.workerResourceLimits},execArgv:workerTypeScriptExecArgv(process.execArgv)});workers.push(worker);
   await new Promise<void>((done,fail)=>{const message=(m:{ready?:boolean;error?:string})=>{if(m.ready){cleanup();done();}else if(m.error){cleanup();fail(Error(m.error));}};const error=(e:Error)=>{cleanup();fail(e);};const exit=(code:number)=>{cleanup();fail(Error('Worker exited before initialization: '+code));};const cleanup=()=>{worker.off('message',message);worker.off('error',error);worker.off('exit',exit);};worker.on('message',message);worker.on('error',error);worker.on('exit',exit);});slots.push({worker,busy:false});
  }));
  while(pending.length||active.size){
   for(let si=0;si<slots.length;si++){
    const slot=slots[si]!;if(slot.busy)continue;if(slot.worker.threadId===-1)throw Error('Worker exited between tasks');const index=pending.findIndex(t=>inFlight+t.estimatedMemoryBytes<=options.maxInFlightBytes);if(index<0)continue;
    const task=pending.splice(index,1)[0]!;slot.busy=true;inFlight+=task.estimatedMemoryBytes;peakInFlightBytes=Math.max(peakInFlightBytes,inFlight);peakWorkers=Math.max(peakWorkers,slots.filter(s=>s.busy).length);
    let work:Promise<{slot:number;task:typeof task;message:{resultJson:string}|{error:string}}>;
    work=new Promise(done=>{const message=(m:{taskId:string;resultJson?:string;error?:string})=>{if(m.taskId!==task.id)return;cleanup();done({slot:si,task,message:m.error?{error:m.error}:{resultJson:m.resultJson!}});};const error=(e:Error)=>{cleanup();done({slot:si,task,message:{error:e.message}});};const exit=(code:number)=>{cleanup();done({slot:si,task,message:{error:'Worker exited during task: '+code}});};const cleanup=()=>{slot.worker.off('message',message);slot.worker.off('error',error);slot.worker.off('exit',exit);};slot.worker.on('message',message);slot.worker.on('error',error);slot.worker.on('exit',exit);slot.worker.postMessage({taskId:task.id,inputJson:task.inputJson,inputSha256:task.inputSha256});});
    active.set(si,work);
   }
   if(!active.size)throw Error('Worker scheduler cannot fit next task');
   const finished=await Promise.race(active.values()),{task,message}=finished;active.delete(finished.slot);slots[finished.slot]!.busy=false;inFlight-=task.estimatedMemoryBytes;
   if('error'in message)throw Error('Task '+task.id+' failed: '+message.error);
   const bytes=Buffer.byteLength(message.resultJson);if(!positive(bytes)||bytes>maximumResult||bytes>task.estimatedMemoryBytes)throw Error('Task result exceeds declared memory/result budget: '+task.id);
   const header:Header={format:'reviter-bounded-checkpoint',version:1,bindingSha256:binding.sha256,taskId:task.id,taskInputSha256:task.inputSha256,resultSha256:sha256(message.resultJson),resultBytes:bytes},path=resolve(directory,sha256(task.id)+'.checkpoint');
   await options.beforeCheckpointCommit?.(task.id);await atomicCheckpoint(path,header,message.resultJson);results[task.index]={id:task.id,path,resultSha256:header.resultSha256,resultBytes:bytes,reused:false};completed++;options.onProgress?.({id:task.id,reused:false,completed,total:options.tasks.length});
  }
  await verifyCheckpointBinding(binding);return {results,bindingSha256:binding.sha256,peakWorkers,peakInFlightBytes};
 }finally{await Promise.allSettled(workers.map(w=>w.terminate()));await lock.close();await rm(lockPath,{force:true});}
}
