// UNTESTED sketch (written from the code, not run). Runs only the landing stage from the
// two snapshots a previous run left in run/checkpoints/inputs, so one trial costs minutes,
// not the 34-minute front matter. It never touches the real run's checkpoint directory.
//
//   cd /content/unbc/openindoormaps
//   IN=/content/unbc/run/checkpoints/inputs      # ls -ltr: use the OLDER native-model-*.bin
//   node --max-old-space-size=8192 --trace-gc --import tsx \
//     --import /content/unbc/reviter/scripts/register-local-typescript.mjs \
//     /content/perf/landing-worker-probe.mts /content/unbc/reviter \
//     $IN/native-model-XXXX.bin $IN/landing-dataset-XXXX.bin /content/perf/probe-7 7 2>&1 \
//     | grep -v Scavenge | tee /content/perf/probe-7.log
//
// Use a new, empty output folder per trial (argument 4); argument 5 is the worker count.
import { deserialize } from "node:v8";
import { readFileSync } from "node:fs";

const [reviter, modelBin, datasetBin, outDir, workers] = process.argv.slice(2);
if (!reviter || !modelBin || !datasetBin || !outDir || !workers)
  throw Error("usage: landing-worker-probe.mts REVITER MODEL.bin LANDING-DATASET.bin NEW-OUT-DIR WORKERS");
const { initializeNativeExactGeosOverlay } = await import(`${reviter}/lib/reviter/native-exact-geos-overlay.ts`);
const { attachNativeCirculationResumable } = await import(`${reviter}/scripts/indoor/native-landing-approaches.ts`);

const model = deserialize(readFileSync(modelBin));
const dataset = deserialize(readFileSync(datasetBin));
await initializeNativeExactGeosOverlay();

const started = Date.now();
let mapLimit = "?";
try { mapLimit = readFileSync("/proc/sys/vm/max_map_count", "utf8").trim(); } catch {}
const sample = () => {
  let maps = -1;
  try { maps = readFileSync("/proc/self/maps", "utf8").split("\n").length; } catch {}
  const m = process.memoryUsage();
  console.log(`[probe] t=${Math.round((Date.now() - started) / 1000)}s rss=${(m.rss / 2 ** 30).toFixed(2)}GiB ` +
    `mainHeapUsed=${(m.heapUsed / 2 ** 30).toFixed(2)}GiB mappings=${maps}/${mapLimit}`);
};
setInterval(sample, 2000).unref();

try {
  const result = await attachNativeCirculationResumable(model, dataset, {
    checkpointDir: outDir,
    workers: Number(workers),
    workerHeapMiB: 8192, // has no effect while the process has --max-old-space-size
    onProgress: (checked: number, total: number, edges: number) => console.log(`[probe] ${checked}/${total} pairs, ${edges} edges`),
    onEvent: (message: string) => console.log("[probe] " + message),
  });
  console.log("[probe] finished " + JSON.stringify(result.receipt));
} catch (error) {
  sample();
  console.log("[probe] FAILED code=" + (error as { code?: string })?.code, error);
  process.exitCode = 1;
}
