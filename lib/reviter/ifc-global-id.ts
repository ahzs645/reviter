/**
 * Revit's default element IFC identity, derived from validated native history.
 *
 * The episode GUID is in canonical text order; XOR the original creation id
 * into its low bits, then encode the 128-bit result with IFC's alphabet.
 * Independently implemented from the documented formula and measured vectors
 * in helenkwok/rvt-rs, Apache-2.0, commit 1c3d337,
 * src/revit_global_ids.rs and src/native_metadata.rs. These are derived default
 * identifiers. Stored overrides remain separate and require explicit export
 * configuration. Hash/sub-element formulas below follow upstream RE-167 and
 * Autodesk revit-ifc GUIDUtil (AllowGUIDParameterOverride/CreateInternal).
 */
import { md5 } from "@noble/hashes/legacy.js";
import type { NativeElementIdentity } from "./native-identity.ts";
import type { ElementParameter } from "./element-parameters.ts";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const EPISODE_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const IFC_GUID_PARAMETER = -1_019_000;
export const IFC_TYPE_GUID_PARAMETER = -1_019_001;

export function isIfcGlobalId(value: unknown): value is string {
  return typeof value === "string" && /^[0-3][0-9A-Za-z_$]{21}$/.test(value);
}

function compress(value: bigint): string {
  let encoded = "";
  for (let index = 0; index < 22; index += 1) {
    encoded = ALPHABET[Number(value & 63n)]! + encoded;
    value >>= 6n;
  }
  return encoded;
}

function expand(globalId: string): bigint | null {
  if (!isIfcGlobalId(globalId)) return null;
  let value = 0n;
  for (const digit of globalId) value = value * 64n + BigInt(ALPHABET.indexOf(digit));
  return value;
}

/** Revit interprets MD5 bytes as a .NET GUID before IFC compression (RE-167). */
export function revitHashedIfcGlobalId(key: string): string {
  const bytes = md5(new TextEncoder().encode(key));
  for (const [start, end] of [[0, 4], [4, 6], [6, 8]] as const) {
    bytes.subarray(start, end).reverse();
  }
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return compress(value);
}

/** Native sub-element indices affect canonical GUID bytes 10 and 11. */
export function revitIfcSubElementGlobalId(globalId: string, index: number): string | null {
  const value = expand(globalId);
  if (value == null || !Number.isInteger(index) || index < 0 || index > 0xffff) return null;
  return compress(value ^ (BigInt(index) << 32n));
}

/** Multiple stored values remain ambiguous even when one appears valid. */
export function storedIfcGlobalId(parameters: readonly ElementParameter[] | undefined, parameterId: number): string | null {
  const stored = (parameters ?? []).filter(parameter => parameter.parameterId === parameterId);
  return stored.length === 1 && isIfcGlobalId(stored[0]!.value) ? stored[0]!.value : null;
}

/** The suffix is an explicit exporter contract, not inferred from a model year. */
export function revitDoorWindowTypeGlobalId(symbolGlobalId: string, flipped: boolean, inAssembly: boolean, exporterVersion: number): string | null {
  if (!isIfcGlobalId(symbolGlobalId) || typeof flipped !== "boolean" || typeof inAssembly !== "boolean" ||
    !Number.isInteger(exporterVersion) || exporterVersion < 2024 || exporterVersion > 2027) return null;
  if (exporterVersion < 2025 && inAssembly) return null;
  const suffix = exporterVersion >= 2025 ? ` InAssembly: ${inAssembly ? "True" : "False"}` : "";
  return revitHashedIfcGlobalId(`${symbolGlobalId}Sub-element:Flipped: ${flipped ? "True" : "False"}${suffix}`);
}

/** Alternate type projections use the IFC schema's canonical case (B73). */
export function revitProjectedTypeGlobalId(typeGlobalId: string, entity: string, predefinedType: string, exporterVersion: number): string | null {
  if (!isIfcGlobalId(typeGlobalId) || !Number.isInteger(exporterVersion) || exporterVersion < 2024 || exporterVersion > 2027) return null;
  const names = ["Door", "Window", "Furniture", "Wall", "Slab", "Beam", "Column", "Member", "Plate", "Railing", "Covering", "CurtainWall", "Footing", "Ramp", "Roof", "Stair", "StairFlight", "ShadingDevice", "BuildingElementProxy", "AirTerminal", "Alarm", "DuctFitting", "DuctSegment", "ElectricAppliance", "LightFixture", "PipeFitting", "PipeSegment", "SanitaryTerminal", "TransportElement", "CableCarrierSegment", "CableCarrierFitting", "FireSuppressionTerminal"];
  const canonical = names.map(name => `Ifc${name}Type`).find(name => name.toUpperCase() === entity);
  const predefined = /^\.([A-Z0-9_]+)\.$/.exec(predefinedType)?.[1] ?? predefinedType;
  if (!canonical || !/^[A-Z0-9_]+$/.test(predefined)) return null;
  const suffix = exporterVersion >= 2025 ? " InAssembly: False" : "";
  return revitHashedIfcGlobalId(`${typeGlobalId}Sub-element: Entity: ${canonical}:${predefined}${suffix}`);
}

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

  const value = BigInt(`0x${identity.episodeGuid.replaceAll("-", "")}`) ^
    BigInt(identity.originalElementId);
  return compress(value);
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
