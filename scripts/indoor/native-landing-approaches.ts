/** Resumable, optionally parallel native landing-approach stage (CLI only).
 *
 * The browser/default compiler keeps the synchronous attachNativeCirculation.
 * This driver evaluates the SAME pure per-pair function and feeds the results
 * to the SAME ordered replay (union-find skip/join and first-seen diagnostic
 * de-duplication in the original distance order), so edges, ids, evidence and
 * diagnostics are reproduced exactly. Numeric -0 in a path is carried as 0,
 * which is the existing JSON wire form of every dataset.
 *
 * Checkpoints: one append-only JSONL file per complete binding (immutable
 * model/dataset snapshots + resolved algorithm bytes, as for native plane
 * checkpoints). Every line is keyed by the exact pair endpoints and region
 * query key. Lines with another binding, key or checksum are ignored; nothing
 * edits an identity. A crash loses at most the in-flight wave.
 */
import { serialize } from "node:v8";
import { mkdir, open, link, rm, readFile } from "node:fs/promises";
import { Worker, type ResourceLimits } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import {
  planNativeApproaches,
  createNativeApproachEvaluator,
  createNativeApproachReplay,
  nativeApproachPortal,
  attachNativeCirculation,
  type NativeApproachCandidate,
  type NativeApproachPair,
  type NativeApproachPlan,
} from "../../lib/reviter/native-circulation-links.ts";
import type { IndoorDataset, IndoorEdge } from "../../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../../lib/reviter/types.ts";
import {
  createCheckpointBinding,
  hashFile,
  sha256,
  strictJson,
  workerTypeScriptExecArgv,
  type CheckpointBinding,
  type JsonValue,
} from "./bounded-worker-checkpoints.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const localResolver = resolve(root, "scripts/register-local-typescript.mjs");
export const LANDING_APPROACH_ALGORITHM = "native-landing-approach-candidates-v1";

export type LandingApproachOptions = {
  /** Directory shared with --checkpoint-dir; candidates go to landing-approaches/. */
  checkpointDir?: string;
  /** 1 evaluates in-process (current behaviour); N>1 uses N worker threads. */
  workers?: number;
  /** Maximum speculative pairs per wave (default 2 × workers). */
  waveSize?: number;
  workerHeapMiB?: number;
  onProgress?: (checkedPairs: number, totalPairs: number, newEdges: number) => void;
  onEvent?: (message: string) => void;
  /** Test hook: evaluated after each committed wave; throwing simulates a crash. */
  afterWave?: (wave: number) => void | Promise<void>;
};
export type LandingApproachReceipt = {
  format: "reviter-native-landing-approach-checkpoints";
  version: 1;
  bindingSha256?: string;
  checkpointPath?: string;
  pairs: number;
  evaluated: number;
  reused: number;
  speculativeUnused: number;
  ignoredCheckpointLines: number;
  waves: number;
  workers: number;
  waveSize: number;
  elapsedMs: number;
  workerHeapUsedBytesAfterInit?: number[];
};

/** The walking-region query key for one pair (portal state or plain plane). */
export function nativeApproachRegionKey(dataset: IndoorDataset, p: NativeApproachPair): JsonValue {
  const portal = nativeApproachPortal(p);
  if (!portal) return [p.a.pointFeet[2], p.landing];
  const door = dataset.doors?.find((d) => portal.id === `${d.id}:0` || portal.id === `${d.id}:1`);
  return carrier([
    portal.pointFeet[2],
    true,
    portal.id,
    portal.pointFeet,
    door?.state ?? null,
    door?.footprintFeet ?? null,
    door?.normalFeet ?? null,
    dataset.edges.find((e) => e.id === door?.id)?.enabled ?? null,
  ]);
}
/** Exact endpoint identities and region query key; independent of pair index. */
export function nativeApproachPairKey(dataset: IndoorDataset, p: NativeApproachPair): string {
  return sha256(strictJson(carrier({ a: p.a, b: p.b, landing: p.landing, distance: p.distance, region: nativeApproachRegionKey(dataset, p) })));
}
/** Lossless JSON carrier (plain objects/arrays/finite numbers; -0 becomes 0). */
export function carrier(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw Error("Nonfinite landing approach carrier");
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined) throw Error("Undefined landing approach carrier value");
  if (Array.isArray(value)) return value.map(carrier);
  if (typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    throw Error("Landing approach carrier requires plain data");
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = carrier(v);
  return out;
}
export function candidateCarrier(c: NativeApproachCandidate): NativeApproachCandidate {
  return carrier(c) as unknown as NativeApproachCandidate;
}

type Entry = { format: "reviter-landing-approach-candidate"; version: 1; bindingSha256: string; pairKey: string; candidateSha256: string; candidate: NativeApproachCandidate };
/** Read every intact line; ignore torn, foreign-binding or checksum-failed lines. */
export async function readLandingApproachCheckpoint(path: string, bindingSha256: string) {
  const entries = new Map<string, NativeApproachCandidate>();
  let ignored = 0,
    text = "";
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line) as Entry;
      if (
        e.format !== "reviter-landing-approach-candidate" ||
        e.version !== 1 ||
        e.bindingSha256 !== bindingSha256 ||
        !/^[a-f0-9]{64}$/.test(e.pairKey) ||
        sha256(strictJson(e.candidate as unknown as JsonValue)) !== e.candidateSha256 ||
        !Array.isArray(e.candidate.regionDiagnostics)
      ) {
        ignored++;
        continue;
      }
      entries.set(e.pairKey, e.candidate);
    } catch {
      ignored++;
    }
  }
  return { entries, ignored };
}
async function appendEntries(path: string, bindingSha256: string, rows: [string, NativeApproachCandidate][]) {
  if (!rows.length) return;
  const text = rows
    .map(([pairKey, candidate]) => {
      const json = strictJson(candidate as unknown as JsonValue);
      return JSON.stringify({ format: "reviter-landing-approach-candidate", version: 1, bindingSha256, pairKey, candidateSha256: sha256(json), candidate });
    })
    .join("\n");
  const file = await open(path, "a");
  try {
    // A torn final line from a crash is ignored on read; start on a new line.
    await file.writeFile("\n" + text + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
}
async function snapshot(directory: string, name: string, value: unknown) {
  const bytes = serialize(value),
    digest = sha256(bytes),
    path = resolve(directory, name + "-" + digest + ".bin");
  const temporary = path + ".tmp-" + process.pid + "-" + randomUUID();
  let file;
  try {
    file = await open(temporary, "wx");
    await file.writeFile(bytes);
    await file.sync();
    await file.close();
    file = undefined;
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await hashFile(path)) !== digest) throw Error("Existing immutable native snapshot is damaged: " + path);
    }
  } finally {
    await file?.close();
    await rm(temporary, { force: true });
  }
  return { name, path, bytes: bytes.length };
}
export async function landingApproachBinding(model: ConvertResult, dataset: IndoorDataset, checkpointDir: string) {
  const inputDirectory = resolve(checkpointDir, "inputs");
  await mkdir(inputDirectory, { recursive: true });
  const inputs = [await snapshot(inputDirectory, "native-model", model), await snapshot(inputDirectory, "landing-dataset", dataset)];
  const workerModule = new URL("./native-landing-approach-worker.ts", import.meta.url);
  const graph = await build({ entryPoints: [fileURLToPath(workerModule)], absWorkingDir: root, bundle: true, platform: "node", format: "esm", write: false, metafile: true, logLevel: "silent" });
  const algorithmFiles = [
    ...Object.keys(graph.metafile!.inputs).map((p) => resolve(root, p)),
    fileURLToPath(import.meta.url),
    localResolver,
    resolve(root, "scripts/local-typescript-resolver.mjs"),
    resolve(root, "lib/reviter/vendor/native-exact-geos/native-exact-geos.wasm"),
    resolve(root, "package.json"),
    resolve(root, "package-lock.json"),
  ];
  const binding = await createCheckpointBinding({
    immutableInputs: inputs.map(({ name, path }) => ({ name, path })),
    algorithmFiles,
    algorithmVersion: LANDING_APPROACH_ALGORITHM + ":" + process.version,
  });
  return { binding, inputs, workerModule };
}

/** Persistent pool on the bounded checkpoint worker protocol. Workers inherit
 * loader flags plus reviter's own extension resolver (tsx hooks alone do not
 * resolve reviter's extensionless imports inside worker threads). */
async function createPool(binding: CheckpointBinding, workerModule: URL, count: number, limits: ResourceLimits) {
  const execArgv = workerTypeScriptExecArgv(process.execArgv);
  if (!execArgv.some((a, i) => a === localResolver || (execArgv[i - 1] === "--import" && resolve(a) === localResolver)))
    execArgv.push("--import", localResolver);
  const workers = await Promise.all(
    Array.from({ length: count }, async () => {
      const worker = new Worker(new URL("./bounded-checkpoint-worker.ts", import.meta.url), { workerData: { moduleURL: workerModule.href, binding }, resourceLimits: limits, execArgv });
      await new Promise<void>((done, fail) => {
        const message = (m: { ready?: boolean; error?: string }) => {
          cleanup();
          if (m.ready) done();
          else fail(Error(m.error ?? "Landing worker failed to initialize"));
        };
        const exit = (code: number) => {
          cleanup();
          fail(Error("Landing worker exited before initialization: " + code));
        };
        const cleanup = () => {
          worker.off("message", message);
          worker.off("error", fail);
          worker.off("exit", exit);
        };
        worker.on("message", message);
        worker.on("error", fail);
        worker.on("exit", exit);
      });
      return worker;
    }),
  );
  let task = 0;
  const run = (worker: Worker, input: JsonValue) =>
    new Promise<NativeApproachCandidate>((done, fail) => {
      const taskId = "landing:" + task++,
        inputJson = strictJson(input);
      const message = (m: { taskId: string; resultJson?: string; error?: string }) => {
        if (m.taskId !== taskId) return;
        cleanup();
        if (m.error) fail(Error(m.error));
        else done(JSON.parse(m.resultJson!) as NativeApproachCandidate);
      };
      const exit = (code: number) => {
        cleanup();
        fail(Error("Landing worker exited during task: " + code));
      };
      const cleanup = () => {
        worker.off("message", message);
        worker.off("error", fail);
        worker.off("exit", exit);
      };
      worker.on("message", message);
      worker.on("error", fail);
      worker.on("exit", exit);
      worker.postMessage({ taskId, inputJson, inputSha256: sha256(inputJson) });
    });
  return {
    /** Region affinity: pairs sharing a portal/plane region go to one worker so
     * its complete-operand region memo is reused. Tasks per worker run serially. */
    async evaluate(tasks: { index: number; pairKey: string; regionKey: string }[]) {
      const groups = new Map<string, typeof tasks>();
      for (const t of tasks) groups.set(t.regionKey, [...(groups.get(t.regionKey) ?? []), t]);
      const queues: (typeof tasks)[] = workers.map(() => []);
      for (const group of [...groups.values()].sort((a, b) => b.length - a.length))
        queues.reduce((min, q) => (q.length < min.length ? q : min)).push(...group);
      const results = new Map<number, NativeApproachCandidate>();
      await Promise.all(
        queues.map(async (queue, w) => {
          for (const t of queue) results.set(t.index, await run(workers[w]!, { index: t.index, pairKey: t.pairKey }));
        }),
      );
      return results;
    },
    /** Initialized per-worker V8 heap (bytes), for the receipt. */
    heapUsed: async () =>
      Promise.all(workers.map(async (w) => {
        const stats = await (w as Worker & { getHeapStatistics?: () => Promise<{ used_heap_size: number }> }).getHeapStatistics?.();
        return stats?.used_heap_size ?? -1;
      })),
    close: () => Promise.allSettled(workers.map((w) => w.terminate())),
  };
}

export async function attachNativeCirculationResumable(
  model: ConvertResult,
  dataset: IndoorDataset,
  options: LandingApproachOptions = {},
): Promise<{ edges: IndoorEdge[]; diagnostics: string[]; receipt: LandingApproachReceipt }> {
  const started = performance.now(),
    workers = options.workers ?? 1;
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 8) throw Error("--landing-workers must be 1–8");
  const waveSize = options.waveSize ?? 2 * workers;
  if (!Number.isSafeInteger(waveSize) || waveSize < 1) throw Error("Invalid landing wave size");
  const receipt: LandingApproachReceipt = { format: "reviter-native-landing-approach-checkpoints", version: 1, pairs: 0, evaluated: 0, reused: 0, speculativeUnused: 0, ignoredCheckpointLines: 0, waves: 0, workers, waveSize, elapsedMs: 0 };
  if (!options.checkpointDir && workers === 1) {
    // Unchanged synchronous behaviour.
    const result = attachNativeCirculation(model, dataset, options.onProgress);
    return { ...result, receipt: { ...receipt, elapsedMs: performance.now() - started } };
  }
  const plan: NativeApproachPlan = planNativeApproaches(model, dataset);
  receipt.pairs = plan.pairs.length;
  const keys = plan.pairs.map((p) => nativeApproachPairKey(dataset, p)),
    regions = plan.pairs.map((p) => sha256(strictJson(nativeApproachRegionKey(dataset, p))));
  let cache = new Map<string, NativeApproachCandidate>(),
    path: string | undefined,
    bindingSha256: string | undefined,
    pool: Awaited<ReturnType<typeof createPool>> | undefined,
    evaluateLocal: ((p: NativeApproachPair) => NativeApproachCandidate) | undefined;
  if (workers > 1 && !options.checkpointDir) throw Error("--landing-workers > 1 requires --checkpoint-dir for immutable worker inputs");
  {
    const dir = resolve(options.checkpointDir!);
    const { binding, workerModule } = await landingApproachBinding(model, dataset, dir);
    bindingSha256 = binding.sha256;
    if (options.checkpointDir) {
      await mkdir(resolve(dir, "landing-approaches"), { recursive: true });
      path = resolve(dir, "landing-approaches", binding.sha256 + ".jsonl");
      const read = await readLandingApproachCheckpoint(path, binding.sha256);
      cache = read.entries;
      receipt.ignoredCheckpointLines = read.ignored;
      options.onEvent?.(`Native landing approaches · ${cache.size} checked checkpoint candidates · ${read.ignored} ignored lines`);
    }
    if (workers > 1) {
      pool = await createPool(binding, workerModule, workers, { maxOldGenerationSizeMb: options.workerHeapMiB ?? 4096 });
      receipt.workerHeapUsedBytesAfterInit = await pool.heapUsed();
      options.onEvent?.(`Native landing approaches · ${workers} workers initialized · heap ${receipt.workerHeapUsedBytesAfterInit.map((b) => Math.round(b / 1048576) + " MiB").join(", ")}`);
    }
  }
  if (!pool) evaluateLocal = createNativeApproachEvaluator(model, dataset);
  const used = new Set<string>(),
    fresh = new Set<string>();
  try {
    const replay = createNativeApproachReplay(dataset, plan, options.onProgress);
    while (replay.advance() < plan.pairs.length) {
      const i = replay.next;
      if (!cache.has(keys[i]!)) {
        const wave: number[] = [i];
        // Speculate only with workers; in-process evaluation stays one pair at a time.
        for (let j = i + 1; pool && j < plan.pairs.length && wave.length < waveSize; j++)
          if (replay.open(j) && !cache.has(keys[j]!) && !wave.some((k) => keys[k] === keys[j])) wave.push(j);
        let results: Map<number, NativeApproachCandidate>;
        if (pool) results = await pool.evaluate(wave.map((j) => ({ index: j, pairKey: keys[j]!, regionKey: regions[j]! })));
        else results = new Map(wave.map((j) => [j, candidateCarrier(evaluateLocal!(plan.pairs[j]!))]));
        const rows: [string, NativeApproachCandidate][] = [];
        for (const j of wave) {
          const c = candidateCarrier(results.get(j)!);
          cache.set(keys[j]!, c);
          fresh.add(keys[j]!);
          rows.push([keys[j]!, c]);
        }
        receipt.evaluated += wave.length;
        receipt.waves++;
        if (path) await appendEntries(path, bindingSha256!, rows);
        await options.afterWave?.(receipt.waves);
      }
      used.add(keys[i]!);
      replay.accept(cache.get(keys[i]!)!);
    }
    receipt.reused = [...used].filter((k) => !fresh.has(k)).length;
    receipt.speculativeUnused = [...fresh].filter((k) => !used.has(k)).length;
    const result = replay.finish();
    receipt.bindingSha256 = bindingSha256;
    receipt.checkpointPath = path;
    receipt.elapsedMs = performance.now() - started;
    return { ...result, receipt };
  } finally {
    await pool?.close();
  }
}
