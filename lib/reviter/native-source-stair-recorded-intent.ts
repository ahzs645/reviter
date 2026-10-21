/** Original authoring metadata supplies identity demand only. It cannot prove
 * native Room ownership, floor support, clearance, access or route approval. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { directoryAreaKind } from "./directory-areas.ts";
import type { DirectoryRoom } from "./room-directory.ts";

type ObjectValue = Record<string, unknown>;
const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const isHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sourceId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Missing original recorded stair identity object");
  return value as ObjectValue;
}
function ids(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 1000 ||
    value.some((id) => !sourceId(id)) ||
    new Set(value).size !== value.length
  )
    throw new Error("Invalid original recorded native stair identities");
  return [...value];
}
const brand: unique symbol = Symbol("OriginalRecordedStairIntentDemand");
export type OriginalRecordedStairIntentDemand = {
  readonly [brand]: true;
  readonly sourceRoomsSha256: string;
  /** Declared model pairing, independently checked against the original graph
   * and fresh native source by the composing constructor. */
  readonly sourceModelSha256: string;
  readonly nativeStairId: number;
  readonly nativeRunId: number;
  readonly scope: "original-recorded-identity-demand-only";
};
type Selection = {
  lowerRoomKey: string;
  upperRoomKey: string;
  nativeStairId: number;
  nativeRunId: number;
};
const issued = new WeakMap<
  OriginalRecordedStairIntentDemand,
  ReturnType<typeof capture>
>();
function capture(
  originalSourceRoomsBytes: Uint8Array,
  expectedSourceRoomsSha256: string,
  expectedSourceModelSha256: string,
  selection: Selection,
) {
  if (
    !isHash(expectedSourceRoomsSha256) ||
    !isHash(expectedSourceModelSha256) ||
    !sourceId(selection.nativeStairId) ||
    !sourceId(selection.nativeRunId) ||
    selection.nativeStairId === selection.nativeRunId ||
    !selection.lowerRoomKey ||
    !selection.upperRoomKey ||
    selection.lowerRoomKey === selection.upperRoomKey
  )
    throw new Error("Invalid original recorded stair intent selection");
  const bytes = Uint8Array.from(originalSourceRoomsBytes);
  if (hash(bytes) !== expectedSourceRoomsSha256)
    throw new Error("Original recorded source-room checksum differs");
  const data = object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    ),
    model = object(data.model);
  if (
    data.format !== "reviter-room-annotations" ||
    data.version !== 1 ||
    data.coordinateSystem !== "revit-model-feet" ||
    typeof model.fileName !== "string" ||
    !model.fileName ||
    !Array.isArray(data.annotations) ||
    data.annotations.length > 50000
  )
    throw new Error("Unsupported original source-room identity format");
  const annotations = data.annotations;
  const annotation = (key: string) => {
    const matches = annotations.filter(
      (row: unknown) => object(row).key === key,
    );
    if (matches.length !== 1)
      throw new Error("Original stair intent annotation is not unique");
    const row = object(matches[0]);
    if (
      !sourceId(row.levelId) ||
      row.status === "deleted" ||
      !Array.isArray(row.labelPointFeet) ||
      row.labelPointFeet.length !== 2 ||
      !row.labelPointFeet.every(Number.isFinite) ||
      !ids(row.stairFlightIds).includes(selection.nativeStairId)
    )
      throw new Error(
        "Original annotation lacks explicit native flight intent",
      );
    return {
      key,
      levelId: row.levelId,
      originalAnnotation: structuredClone(row),
    };
  };
  const lowerRoom = annotation(selection.lowerRoomKey),
    upperRoom = annotation(selection.upperRoomKey),
    metadataKey = `room:${selection.lowerRoomKey}`,
    metadata = object(object(data.areaMetadata)[metadataKey]),
    elements = ids(metadata.elementIds);
  if (
    directoryAreaKind(
      lowerRoom.originalAnnotation as unknown as DirectoryRoom,
    ) !== "room" ||
    lowerRoom.levelId === upperRoom.levelId ||
    typeof metadata.notes !== "string" ||
    !metadata.notes.trim() ||
    !elements.includes(selection.nativeStairId) ||
    !elements.includes(selection.nativeRunId)
  )
    throw new Error(
      "Original recorded room/native stair identity is incomplete",
    );
  return {
    kind: "original-recorded-stair-identity-demand" as const,
    sourceRoomsSha256: expectedSourceRoomsSha256,
    sourceRoomsByteLength: bytes.length,
    declaredSourceModelSha256: expectedSourceModelSha256,
    nativeStairId: selection.nativeStairId,
    nativeRunId: selection.nativeRunId,
    originalSourceHeader: structuredClone({
      format: data.format,
      version: data.version,
      coordinateSystem: data.coordinateSystem,
      model,
    }),
    lowerRoom,
    upperRoom,
    originalAreaMetadataKey: metadataKey,
    originalRecordedAreaMetadata: structuredClone(metadata),
    recordedMetadataAuthorshipEstablished: false as const,
    rawDwgOrRegistrationIndependentlyVerified: false as const,
    nativeRoomOwnershipApproved: false as const,
    sourcePhysicsOrPermissionApproved: false as const,
    routeApproved: false as const,
  };
}
export function captureOriginalRecordedStairIntentDemand(
  originalSourceRoomsBytes: Uint8Array,
  expectedSourceRoomsSha256: string,
  expectedSourceModelSha256: string,
  selection: Selection,
): OriginalRecordedStairIntentDemand {
  const facts = capture(
      originalSourceRoomsBytes,
      expectedSourceRoomsSha256,
      expectedSourceModelSha256,
      selection,
    ),
    handle = Object.freeze({
      [brand]: true as const,
      sourceRoomsSha256: expectedSourceRoomsSha256,
      sourceModelSha256: expectedSourceModelSha256,
      nativeStairId: selection.nativeStairId,
      nativeRunId: selection.nativeRunId,
      scope: "original-recorded-identity-demand-only" as const,
    });
  issued.set(handle, facts);
  return handle;
}
export function originalRecordedStairIntentDemandFacts(
  handle: OriginalRecordedStairIntentDemand,
) {
  const facts = issued.get(handle);
  if (!facts)
    throw new Error("Untrusted original recorded stair intent demand");
  return structuredClone(facts);
}
