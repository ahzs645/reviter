// Shows that a worker's resourceLimits.maxOldGenerationSizeMb is ignored when the
// process was started with --max-old-space-size. Tested on Node 22.22.0 (macOS arm64).
//   node worker-heap-limit-check.mjs                          -> worker dies near 64 MiB
//   node --max-old-space-size=1024 worker-heap-limit-check.mjs -> worker keeps ~390 MiB
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import v8 from "node:v8";
if (isMainThread) {
  console.log(process.version, process.execArgv.join(" ") || "(no heap flag)",
    "main limit MiB", Math.round(v8.getHeapStatistics().heap_size_limit / 1048576));
  await new Promise((done) => {
    const w = new Worker(new URL(import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 64 } });
    let last = "";
    w.on("message", (m) => (last = m));
    w.on("error", (e) => console.log(`worker asked for 64 MiB: ${e.code} after retaining ${last}`));
    w.on("exit", (c) => { console.log(`worker exit ${c}; last report: ${last}`); done(); });
  });
} else {
  const limit = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576);
  const keep = []; let mb = 0;
  while (mb < 300) {
    const a = []; for (let i = 0; i < 110000; i++) a.push({ i, x: [i, i + 1, i + 2] });
    keep.push(a); mb += 10; parentPort.postMessage(`~${mb} MiB (reported limit ${limit} MiB)`);
  }
  parentPort.postMessage(`~${mb} MiB kept, used ${Math.round(v8.getHeapStatistics().used_heap_size / 1048576)} MiB, reported limit ${limit} MiB`);
}
