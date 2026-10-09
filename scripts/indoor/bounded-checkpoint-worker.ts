import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {sha256,strictJson,verifyCheckpointBinding,type CheckpointBinding,type CheckpointWorkerContext,type CheckpointWorkerModule} from './bounded-worker-checkpoints.ts';
const binding=workerData.binding as CheckpointBinding;
try {
 await verifyCheckpointBinding(binding);
 const context:CheckpointWorkerContext={binding,async readVerifiedInput(name){const file=binding.immutableInputs.find(f=>f.name===name);if(!file)throw Error('Unbound worker input: '+name);const bytes=await readFile(file.path);if(sha256(bytes)!==file.sha256)throw Error('Changed immutable worker input: '+name);return bytes;}};
 const module:CheckpointWorkerModule=await import(workerData.moduleURL);
 if(typeof module.runTask!=='function')throw Error('Worker module must export runTask');
 const state=await module.initialize?.(context);
 let busy=false;
 parentPort!.on('message',async(message:{taskId:string;inputJson:string;inputSha256:string})=>{
  try{if(busy)throw Error('Worker already has an active task');busy=true;if(sha256(message.inputJson)!==message.inputSha256)throw Error('Changed task input');const input:unknown=JSON.parse(message.inputJson);strictJson(input);const value=await module.runTask(input as Parameters<CheckpointWorkerModule['runTask']>[0],state,context);const resultJson=strictJson(value);parentPort!.postMessage({taskId:message.taskId,resultJson});}
  catch(error){parentPort!.postMessage({taskId:message.taskId,error:error instanceof Error?error.message:String(error)});}
  finally{busy=false;}
 });
 parentPort!.postMessage({ready:true});
}catch(error){parentPort!.postMessage({error:error instanceof Error?error.message:String(error)});process.exitCode=1;}
