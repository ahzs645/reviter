import type { IndoorDataset, IndoorRecord } from "./indoor-contract.ts";
/** Identity association with an existing original native slab hole. This does
 * not create a hole, alter a floor, or grant access to any neighbouring face. */
export type NativeFloorOpeningOwnership = {
  version: 1;
  sourceModelSha256: string;
  nativeFloorElementId: number;
  elevationFeet: number;
  holeFeet: [number, number][];
};
export function validateNativeFloorOpeningOwnershipShape(
  value: unknown,
): asserts value is NativeFloorOpeningOwnership | undefined {
  if (value === undefined) return;
  const p = value as NativeFloorOpeningOwnership;
  if (
    !p ||
    p.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(p.sourceModelSha256) ||
    !Number.isSafeInteger(p.nativeFloorElementId) ||
    p.nativeFloorElementId <= 0 ||
    !Number.isFinite(p.elevationFeet) ||
    !Array.isArray(p.holeFeet) ||
    p.holeFeet.length < 3 ||
    p.holeFeet.length > 60000 ||
    p.holeFeet.some(
      (q) =>
        !Array.isArray(q) ||
        q.length !== 2 ||
        q.some((v) => !Number.isFinite(v) || Math.abs(v) >= 1e7),
    )
  )
    throw new Error("Invalid native floor opening identity proof.");
}
const samePoint = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
function ringWithoutClosure(r: [number, number][]) {
  return r.length > 1 && samePoint(r[0]!, r.at(-1)!) ? r.slice(0, -1) : r;
}
/** Cyclic start and winding are serialization choices; all coordinates must be
 * exactly equal. No proximity tolerance can substitute a different hole. */
function sameRing(a: [number, number][], b: [number, number][]) {
  a = ringWithoutClosure(a);
  b = ringWithoutClosure(b);
  return (
    a.length === b.length &&
    b.some(
      (p, i) =>
        samePoint(a[0]!, p) &&
        [1, -1].some((d) =>
          a.every((q, j) =>
            samePoint(q, b[(i + d * j + b.length) % b.length]!),
          ),
        ),
    )
  );
}
function boundHole(data: IndoorDataset, record: IndoorRecord) {
  const p = record.properties.nativeFloorOpeningOwnership as
    | NativeFloorOpeningOwnership
    | undefined;
  if (!p) return;
  try {
    validateNativeFloorOpeningOwnershipShape(p);
  } catch {
    return;
  }
  if (
    record.walkable ||
    p.sourceModelSha256 !== data.source.modelSha256 ||
    data.walkingSupport?.sourceModelSha256 !== data.source.modelSha256 ||
    p.elevationFeet !== record.elevationFeet
  )
    return;
  const floor = data.walkingSupport.floors.find(
    (f) =>
      f.nativeElementId === p.nativeFloorElementId &&
      f.elevationFeet === p.elevationFeet,
  );
  return (floor?.partsFeet ?? (floor ? [floor.ringsFeet] : []))
    .flatMap((part) => part.slice(1))
    .find((h) => sameRing(p.holeFeet, h));
}
/** Ordinary old contours remain majority metadata hints. A checked void uses
 * the original native hole as its identity footprint, with access unchanged. */
export function nativeRoomIdentityRings(
  data: IndoorDataset,
  record: IndoorRecord,
): IndoorRecord["ringsFeet"] {
  const hole = boundHole(data, record);
  return hole ? [hole] : record.ringsFeet;
}
export function validateNativeFloorOpeningOwnership(data: IndoorDataset) {
  for (const record of data.records)
    if (record.properties.nativeFloorOpeningOwnership !== undefined) {
      validateNativeFloorOpeningOwnershipShape(
        record.properties.nativeFloorOpeningOwnership,
      );
      if (!boundHole(data, record))
        throw new Error(
          `Native floor opening identity for ${record.key} no longer matches its original non-traversable slab hole.`,
        );
    }
}

export function validateNativeFloorOpeningOwnershipBinding(
  data: IndoorDataset,
  annotations: readonly {
    key: string;
    nativeFloorOpeningOwnership?: unknown;
    walkability?: unknown;
    access?: unknown;
  }[],
) {
  validateNativeFloorOpeningOwnership(data);
  const source = new Map(annotations.map((a) => [a.key, a])),
    records = new Map(data.records.map((r) => [r.key, r]));
  for (const key of new Set([
    ...annotations
      .filter((a) => a.nativeFloorOpeningOwnership !== undefined)
      .map((a) => a.key),
    ...data.records
      .filter((r) => r.properties.nativeFloorOpeningOwnership !== undefined)
      .map((r) => r.key),
  ])) {
    const a = source.get(key),
      r = records.get(key),
      access = (a?.access as { kind?: unknown } | undefined)?.kind ?? "unknown";
    if (
      !a ||
      !r ||
      JSON.stringify(a.nativeFloorOpeningOwnership) !==
        JSON.stringify(r.properties.nativeFloorOpeningOwnership) ||
      a.walkability !== "void" ||
      access !== r.access
    )
      throw new Error(
        `Source and prepared native floor opening identity/access for ${key} differ. Regenerate the reviewed master.`,
      );
  }
}
