import { capabilitySnapshot, REVITER_CAPABILITY_CONTRACTS } from "../lib/reviter/capabilities.ts";
import type { ElementIdBytes } from "../lib/reviter/element-id-width.ts";

let revitVersion: number | null = null;
let schemaElementIdBytes: ElementIdBytes | null = null;
const evidence = new Set<string>();
for (let at = 2; at < process.argv.length; at += 2) {
  const flag = process.argv[at];
  const value = process.argv[at + 1];
  if (value == null) throw new Error(`Missing value for ${flag}`);
  if (flag === "--release") {
    revitVersion = Number(value);
    if (!Number.isInteger(revitVersion)) throw new Error("release must be an integer");
  } else if (flag === "--id-width") {
    const width = Number(value);
    if (width !== 4 && width !== 8) throw new Error("id-width must be 4 or 8 bytes");
    schemaElementIdBytes = width;
  } else if (flag === "--evidence") {
    for (const item of value.split(",")) if (item.trim()) evidence.add(item.trim());
  } else throw new Error(`Unknown option ${flag}`);
}
process.stdout.write(`${JSON.stringify({
  contracts: REVITER_CAPABILITY_CONTRACTS,
  snapshot: capabilitySnapshot({ revitVersion, schemaElementIdBytes, evidence }),
}, null, 2)}\n`);
