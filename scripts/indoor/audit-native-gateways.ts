/** Read-only complete-source gateway diagnostic. Never creates or enables edges. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { IndoorDataset } from "../../lib/reviter/indoor-contract.ts";
import {
  auditNativeGateways,
  validateNativeGatewayAuditRequest,
} from "../../lib/reviter/native-gateway-audit.ts";

const args = process.argv.slice(2);
const requireLocal = args.includes("--require-local-topology");
const positional = args.filter((arg) => arg !== "--require-local-topology");
if (positional.length !== 3 || positional.some((arg) => arg.startsWith("--"))) {
  throw new Error(
    "Usage: audit-native-gateways.ts COMPLETE-SOURCE.json REQUEST.json NEW-REPORT.json [--require-local-topology]",
  );
}
const [input, requestPath, output] = positional;
const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const implementationFiles = [
  "scripts/indoor/audit-native-gateways.ts",
  "lib/reviter/native-gateway-audit.ts",
  "lib/reviter/indoor-contract.ts",
];
const implementation = await Promise.all(
  implementationFiles.map(async (path) => ({
    path,
    sha256: sha(await readFile(new URL(`../../${path}`, import.meta.url))),
  })),
);
const raw = await readFile(input);
const requestRaw = await readFile(requestPath);
const request: unknown = JSON.parse(requestRaw.toString());
validateNativeGatewayAuditRequest(request);
const data = JSON.parse(raw.toString()) as IndoorDataset;
const parsedBefore = sha(JSON.stringify(data));
const started = performance.now();
const result = auditNativeGateways(data, request, sha(raw));
const auditSeconds = (performance.now() - started) / 1000;
const parsedAfter = sha(JSON.stringify(data));
if (parsedBefore !== parsedAfter || sha(await readFile(input)) !== sha(raw)) {
  throw new Error("The source changed during the read-only gateway audit.");
}
if (sha(await readFile(requestPath)) !== sha(requestRaw)) {
  throw new Error("The gateway request changed during the audit.");
}
for (const file of implementation) {
  if (
    sha(await readFile(new URL(`../../${file.path}`, import.meta.url))) !==
    file.sha256
  ) {
    throw new Error(`The gateway audit implementation changed: ${file.path}`);
  }
}
const report = {
  ...result,
  requestSha256: sha(requestRaw),
  sourceParsedValueSha256: parsedBefore,
  sourceFileUnchanged: true,
  sourceParsedValueUnchanged: true,
  requestUnchanged: true,
  implementation: {
    sha256: sha(JSON.stringify(implementation)),
    files: implementation,
    unchanged: true,
  },
  auditSeconds,
  createdAt: new Date().toISOString(),
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({
    ...report.counts,
    sourceIndoorSha256: report.sourceIndoorSha256,
    sourceUnchanged: true,
    auditSeconds,
    authorityGranted: false,
  }),
);
if (requireLocal && report.counts.incomplete > 0) process.exitCode = 2;
