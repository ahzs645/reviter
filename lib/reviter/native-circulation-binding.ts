import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
/** Hash actual complete geometry and policy fields, never declared descriptor
 * digests alone. Legacy wire bindings remain unchanged. Strict bindings avoid
 * duplicating the entire physical descriptor in every packet and worker copy. */
export function nativeCirculationBinding(values: unknown[], strict: boolean) {
  const serialized = JSON.stringify(values);
  return strict
    ? "native-circulation-sha256-v1:" +
        bytesToHex(sha256(new TextEncoder().encode(serialized)))
    : serialized;
}
