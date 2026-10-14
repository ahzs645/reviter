/**
 * Revit's default element IFC identity, derived from validated native history.
 *
 * The episode GUID is in canonical text order; XOR the original creation id
 * into its low bits, then encode the 128-bit result with IFC's alphabet.
 * Independently implemented from the documented formula and measured vectors
 * in helenkwok/rvt-rs, Apache-2.0, commit 1c3d337,
 * src/revit_global_ids.rs and src/native_metadata.rs. These are derived default
 * identifiers, not stored IfcGUID overrides or synthesized sub-element ids.
 */
import type { NativeElementIdentity } from "./native-identity.ts";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const EPISODE_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function nativeIfcGlobalId(identity: NativeElementIdentity): string | null {
  if (
    identity.provenance !== "Global/ElemTable.ElementHistory+Global/History.Episode" ||
    !Number.isSafeInteger(identity.elementId) || identity.elementId < 1 ||
    !Number.isSafeInteger(identity.originalElementId) || identity.originalElementId < 1 ||
    !EPISODE_GUID.test(identity.episodeGuid) ||
    /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(identity.episodeGuid) ||
    identity.uniqueId.toLowerCase() !==
      `${identity.episodeGuid.toLowerCase()}-${identity.originalElementId.toString(16).padStart(8, "0")}`
  ) return null;

  let value = BigInt(`0x${identity.episodeGuid.replaceAll("-", "")}`) ^
    BigInt(identity.originalElementId);
  let encoded = "";
  for (let index = 0; index < 22; index += 1) {
    encoded = ALPHABET[Number(value & 63n)]! + encoded;
    value >>= 6n;
  }
  return encoded;
}

/** Ambiguous joins and colliding native identities fall back to Reviter ids. */
export function nativeIfcGlobalIds(identities: readonly NativeElementIdentity[]): Map<number, string> {
  const countsByElement = new Map<number, number>();
  const countsByGuid = new Map<string, number>();
  const candidates: Array<[number, string]> = [];
  for (const identity of identities) {
    countsByElement.set(identity.elementId, (countsByElement.get(identity.elementId) ?? 0) + 1);
    const globalId = nativeIfcGlobalId(identity);
    if (!globalId) continue;
    countsByGuid.set(globalId, (countsByGuid.get(globalId) ?? 0) + 1);
    candidates.push([identity.elementId, globalId]);
  }
  return new Map(candidates.filter(([id, globalId]) =>
    countsByElement.get(id) === 1 && countsByGuid.get(globalId) === 1));
}
