import type { PartitionObjectRecord } from "./partition-records.ts";
import type { InstancePlacement } from "./instanced-geometry.ts";
import type { Bounds3 } from "./types.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
import { collectRevit2027NestedInstances } from "./revit-2027-nested-instance.ts";
import { REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT } from "./revit-2027-ginstance.ts";
import { REVIT_2027_GGROUP_SOURCE_CLASS_SLOT } from "./revit-2027-grep-prefixes.ts";

/** Read the placement from its queued InstanceInfo, independent of record
 * size. A leading GGroup is allowed only when it introduces no additional
 * instance; the root must describe one unscaled, direct model occurrence.
 */
export function readOwnedInstancePlacement(record: PartitionObjectRecord, release: number): { placement: InstancePlacement; bounds: Bounds3 } | null {
  if (record.classIndex == null || record.objectLength < 18) return null;
  const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength);
  const root = decodeRevit2027FramedGRepRoot(record.data, {
    elementId: record.elementId, marker: record.classIndex, offset: 0, objectLength: record.objectLength, typeCode: view.getUint32(18, true),
  }, release);
  if (!root.ok || root.value.flags !== 0 || root.value.objectType !== 3 || !root.value.worldExtents.valid || Number(root.value.ownerElementId) !== record.elementId) return null;
  const slots = root.value.children.map(c => c.sourceClassSlot);
  if (!(slots.length === 1 && slots[0] === REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT) &&
      !(slots.length === 2 && slots[0] === REVIT_2027_GGROUP_SOURCE_CLASS_SLOT && slots[1] === REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT)) return null;
  const replay = replayRevit2027GRepFifo(record.data, root.value);
  if (!replay.ok || replay.value.endOffset !== root.value.dynamicPayloadEndOffset) return null;
  const instances = collectRevit2027NestedInstances(replay.value);
  if (!instances.ok || instances.value.length !== 1) return null;
  const instance = instances.value[0]!;
  if (instance.path.length !== 1 || instance.hasScale || instance.resolveSymbolInView || instance.forbiddenTarget !== 0 || instance.gRepId !== 0 || instance.cda !== 1) return null;
  const id = Number(instance.symbolElementId), m = instance.transform.matrix;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const e = root.value.worldExtents;
  return { placement: {
    elementId: record.elementId, geometryId: id, symbolId: id,
    // InstancePlacement consumes the nine serialized basis scalars in row
    // order, as readInstancePlacement does. The replay adapter exposes those
    // triples through a column-major matrix; transposing them here reverses
    // non-axis-aligned occurrence rotations (notably RAC's solar panels).
    basis: [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]],
    origin: [m[12], m[13], m[14]],
  }, bounds: { min: { x: e.minimum[0], y: e.minimum[1], z: e.minimum[2] }, max: { x: e.maximum[0], y: e.maximum[1], z: e.maximum[2] } } };
}
