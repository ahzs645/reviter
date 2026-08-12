/**
 * Convert one real model with two checkouts of the pipeline and deep-compare
 * the whole ConvertOutcome.
 *
 * A refactor that keeps every test green has shown that the tests still pass,
 * which is not the same as showing the conversion is unchanged: the suite runs
 * on synthetic containers that reach none of the solid, instance, curved-wall
 * or door-leaf branches a real building exercises. This runs the real thing
 * through both and reports every field that differs, so an intended change can
 * be told apart from an accident.
 *
 * Set up a baseline with a worktree and share the installed dependencies:
 *
 *   git worktree add /tmp/baseline <commit>
 *   ln -s "$PWD/node_modules" /tmp/baseline/node_modules
 *   node --experimental-strip-types --max-old-space-size=8192 \
 *     scripts/differential-convert.mjs /tmp/baseline model.rvt
 *
 * A 70 MB model takes about eighty seconds per side, so allow three minutes.
 * No model is committed here; supply your own.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [baselineRoot, modelPath] = process.argv.slice(2);
if (!baselineRoot || !modelPath) {
  console.error("usage: differential-convert.mjs <baseline-checkout> <model.rvt> [--stats <path>]");
  process.exit(2);
}

const BASELINE = resolve(baselineRoot, "lib/reviter/convert.ts");
const REFACTORED = resolve(import.meta.dirname, "../lib/reviter/convert.ts");
const MODEL = resolve(modelPath);
const statsFlag = process.argv.indexOf("--stats");
const STATS_OUT = statsFlag > 0 ? process.argv[statsFlag + 1] : null;

// Legitimately non-deterministic: wall-clock only. Everything else must match.
const IGNORED = new Set(["durationMs"]);

const isTyped = (v) => ArrayBuffer.isView(v) && !(v instanceof DataView);

function diff(a, b, path, out, seen) {
  if (out.length >= 200000) return;
  if (a === b) return;

  if (isTyped(a) || isTyped(b)) {
    if (!isTyped(a) || !isTyped(b)) return void out.push(`${path}: typed/non-typed (${a?.constructor?.name} vs ${b?.constructor?.name})`);
    if (a.constructor !== b.constructor) return void out.push(`${path}: ${a.constructor.name} vs ${b.constructor.name}`);
    if (a.length !== b.length) return void out.push(`${path}.length: ${a.length} vs ${b.length}`);
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return void out.push(`${path}[${i}]: ${a[i]} vs ${b[i]}`);
    }
    return;
  }

  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set)) return void out.push(`${path}: Set/non-Set`);
    if (a.size !== b.size) return void out.push(`${path}.size: ${a.size} vs ${b.size}`);
    for (const v of a) if (!b.has(v)) return void out.push(`${path}: baseline has ${String(v)}, refactored does not`);
    return;
  }

  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return void out.push(`${path}: Map/non-Map`);
    if (a.size !== b.size) return void out.push(`${path}.size: ${a.size} vs ${b.size}`);
    for (const [k, v] of a) {
      if (!b.has(k)) return void out.push(`${path}: baseline has key ${String(k)}, refactored does not`);
      diff(v, b.get(k), `${path}.get(${String(k)})`, out, seen);
    }
    return;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return void out.push(`${path}: array/non-array`);
    if (a.length !== b.length) return void out.push(`${path}.length: ${a.length} vs ${b.length}`);
    for (let i = 0; i < a.length; i += 1) diff(a[i], b[i], `${path}[${i}]`, out, seen);
    return;
  }

  if (a && b && typeof a === "object" && typeof b === "object") {
    const key = a;
    if (seen.has(key)) return;
    seen.add(key);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (IGNORED.has(k)) continue;
      if (!(k in a)) { out.push(`${path}.${k}: missing in baseline`); continue; }
      if (!(k in b)) { out.push(`${path}.${k}: missing in refactored`); continue; }
      diff(a[k], b[k], `${path}.${k}`, out, seen);
    }
    return;
  }

  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return;
  out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}

const bytes = new Uint8Array(readFileSync(MODEL));
console.log(`model: ${bytes.byteLength.toLocaleString()} bytes`);

const run = async (spec, label) => {
  const { convertRvtBytes } = await import(spec);
  const started = process.hrtime.bigint();
  const outcome = convertRvtBytes(new Uint8Array(bytes), "UNBC.rvt");
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`${label}: ok=${outcome.ok} in ${ms.toFixed(0)} ms`);
  return outcome;
};

const before = await run(BASELINE, "baseline  ");
const after = await run(REFACTORED, "refactored");

const out = [];
diff(before, after, "outcome", out, new WeakSet());

// Group by top-level path so a whole class of change is one line.
const groups = new Map();
for (const line of out) {
  const key = line.replace(/\[\d+\]/g, "[]").split(":")[0];
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
console.log("\nDIVERGENCE CLASSES (" + out.length + " total):");
for (const [k, n] of [...groups].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(7)}  ${k}`);
console.log("");
if (out.length === 0) {
  console.log("IDENTICAL — no divergence in the whole ConvertOutcome (durationMs excluded)");
} else {
  console.log(`DIVERGENCES (${out.length}${out.length >= 40 ? "+, truncated" : ""}):`);
  for (const line of out) console.log("  " + line);
}

if (before.ok && STATS_OUT) {
  writeFileSync(STATS_OUT, JSON.stringify(before.stats, null, 2));
  console.log(`\nbaseline stats written to ${STATS_OUT}`);
}

process.exitCode = out.length === 0 ? 0 : 1;
