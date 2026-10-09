import {createCheckpointBinding,runBoundedCheckpointTasks} from '../../scripts/indoor/bounded-worker-checkpoints.ts';
const [directory,input]=process.argv.slice(2),worker=new URL('./bounded-checkpoint-worker.mjs',import.meta.url);
const binding=await createCheckpointBinding({immutableInputs:[{name:'dataset',path:input}],algorithmFiles:[worker.pathname],algorithmVersion:'test-v1'});
await runBoundedCheckpointTasks({workerModule:worker,checkpointDir:directory,binding,maxWorkers:2,maxInFlightBytes:8192,
 tasks:[{id:'first',input:{value:1,delay:5},estimatedMemoryBytes:4096},{id:'second',input:{value:2,delay:60000},estimatedMemoryBytes:4096}],
 onProgress:event=>{if(event.id==='first')process.stdout.write('FIRST_DURABLE\n');}});
