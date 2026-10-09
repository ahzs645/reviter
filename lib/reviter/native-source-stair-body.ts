import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  validateNativeSourceStairWidth,
  type NativeSourceStairReceipt,
  type NativeSourceStairFloor,
  type NativeSourceStairRiserOptions,
} from "./native-source-stair-width.ts";
/** Original owner-tagged walking top profiles, independently recovered from
 * complete source bodies. A prepared sketch/profile inventory cannot fill a
 * missing nested native symbol or claim that body coverage is complete. */
export type NativeSourceStairBody = {
  version: 1;
  sourceModelSha256: string;
  geometrySha256: string;
  evidenceSha256: string;
  nativeStairId: number;
  nativeRunIds: number[];
  completeOriginalBody: true;
  unclassifiedSourceElementIds: number[];
  treads: NativeSourceStairReceipt["treads"];
  landings: NativeSourceStairReceipt["landings"];
};
export function nativeSourceStairBodyHash(
  value: Omit<NativeSourceStairBody, "geometrySha256"> | NativeSourceStairBody,
): string {
  const { geometrySha256: _, ...raw } = value as NativeSourceStairBody;
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(raw))));
}
export function validNativeSourceStairBody(
  value: NativeSourceStairBody | undefined,
  receipt: NativeSourceStairReceipt,
  floors: readonly NativeSourceStairFloor[],
  exactNative = false,
  riserOptions?: NativeSourceStairRiserOptions,
): boolean {
  try {
    if (
      !value ||
      value.version !== 1 ||
      value.sourceModelSha256 !== receipt.sourceModelSha256 ||
      value.nativeStairId !== receipt.nativeStairId ||
      value.completeOriginalBody !== true ||
      !/^[a-f0-9]{64}$/.test(value.evidenceSha256) ||
      value.geometrySha256 !== nativeSourceStairBodyHash(value) ||
      !Array.isArray(value.unclassifiedSourceElementIds) ||
      value.unclassifiedSourceElementIds.length ||
      !Array.isArray(value.nativeRunIds) ||
      JSON.stringify([...value.nativeRunIds].sort((a, b) => a - b)) !==
        JSON.stringify([...receipt.nativeRunIds].sort((a, b) => a - b)) ||
      !Array.isArray(value.treads) ||
      !value.treads.length ||
      !Array.isArray(value.landings)
    )
      return false;
    return validateNativeSourceStairWidth(
      { ...receipt, treads: value.treads, landings: value.landings },
      floors,
      exactNative,
      riserOptions,
    );
  } catch {
    return false;
  }
}
