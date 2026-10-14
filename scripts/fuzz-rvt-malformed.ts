import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runMalformedFuzz, type FuzzOptions, type FuzzReport } from "./lib/rvt-malformed-fuzz.ts";

function argumentsOf(args: string[]): { options: FuzzOptions; output?: string; worker: boolean } {
  const options: FuzzOptions = {};
  let output: string | undefined;
  let worker = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--worker") { worker = true; continue; }
    const value = args[++index];
    if (value == null) throw new Error(`Missing value for ${arg}`);
    if (arg === "--seed") options.seed = Number(value);
    else if (arg === "--cases") options.cases = Number(value);
    else if (arg === "--max-input-bytes") options.maxInputBytes = Number(value);
    else if (arg === "--output") output = value;
    else throw new Error(`Unknown option ${arg}`);
  }
  return { options, output, worker };
}

const args = argumentsOf(process.argv.slice(2));
if (args.worker) {
  process.stdout.write(JSON.stringify(runMalformedFuzz(args.options)));
} else {
  // A stalled synchronous parser cannot obey node:test's cooperative timeout.
  // Running the CLI corpus in a child gives this command a real wall-clock cap.
  const child = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--import", fileURLToPath(new URL("./register-test-typescript.mjs", import.meta.url)),
    fileURLToPath(import.meta.url),
    ...process.argv.slice(2),
    "--worker",
  ], { encoding: "utf8", timeout: 60_000, maxBuffer: 32 << 20 });
  if (child.error || child.status !== 0) {
    throw new Error(`Malformed-input worker failed: ${child.error?.message ?? child.stderr}`);
  }
  const report = JSON.parse(child.stdout) as FuzzReport;
  if (args.output) writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
  const runs = report.targets.reduce((sum, row) => sum + row.runs, 0);
  process.stdout.write(`Seed ${report.seed}: ${report.cases} bounded inputs, ${runs} target runs, ${report.failureCount} failures\n`);
  process.stdout.write(`Corpus SHA-256: ${report.corpusDigest}\n`);
  for (const row of report.targets) {
    process.stdout.write(`${row.target}: ${row.accepted} accepted, ${row.absent} absent, ${row.structuredRefusals} structured refusals\n`);
  }
  for (const failure of report.failures.slice(0, 10)) {
    process.stderr.write(`${failure.target} ${failure.caseId} ${failure.kind}: ${failure.message}\n`);
  }
  if (report.failureCount) process.exitCode = 1;
}
