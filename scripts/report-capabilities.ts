import { capabilityManifest } from "../lib/reviter/capabilities.ts";

const args = process.argv.slice(2);
const rawRelease = args.find((arg) => /^\d+$/.test(arg));
if (args.some((arg) => arg !== rawRelease && arg !== "--narrow-ids") ||
    (rawRelease != null && (!Number.isSafeInteger(Number(rawRelease)) || Number(rawRelease) <= 0))) {
  throw new Error("Usage: node --experimental-strip-types scripts/report-capabilities.ts [RELEASE] [--narrow-ids]");
}
console.log(JSON.stringify(capabilityManifest(rawRelease ? Number(rawRelease) : null, args.includes("--narrow-ids")), null, 2));
