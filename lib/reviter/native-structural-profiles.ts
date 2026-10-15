/** RE-103 type-owned section parameters from rvt-rs partition_type_parameters.rs
 * at 1c3d337 (Apache-2.0). No section is derived from a name or bounds. */
import type { ElementParameterTable } from "./element-parameters.ts";

export const STRUCTURAL_SECTION_SHAPE_PARAMETER = -1005501;
export const STRUCTURAL_SECTION_PARAMETERS = {
  widthFeet: -1005502, depthFeet: -1005503, webFeet: -1005525,
  flangeFeet: -1005524, centroidXFeet: -1005508, centroidYFeet: -1005509,
} as const;
type Field = keyof typeof STRUCTURAL_SECTION_PARAMETERS;
export type NativeStructuralSection = {
  typeId: number; shape: "symmetric-I" | "unresolved"; shapeCode: number | null;
  shapeSource?: "owned-integer-STRUCTURAL_SECTION_SHAPE"; widthFeet: number; depthFeet: number; webFeet: number; flangeFeet: number;
  centroidXFeet: number; centroidYFeet: number; revitVersion: number;
  source: "declared-type-value-block-six-section-parameters";
  witnesses: Array<{ parameterId: number; stream: string; chunkIndex: number; rawOffset: number; valueOffset: number }>;
};
export function createNativeStructuralSectionCollector(options: { revitVersion: number | null; elementIds: ReadonlySet<number> }) {
  const held = new Map<number, Map<Field, { value: number | null; witnesses: NativeStructuralSection["witnesses"] }>>();
  const fields = new Map<number, Field>(Object.entries(STRUCTURAL_SECTION_PARAMETERS).map(([key, value]) => [value, key as Field]));
  const shapes = new Map<number, number | null>();
  type Segment = { from: number; to: number; chunkIndex: number; rawOffset: number; valueOffset: number };
  const tails = new Map<string, { chunkIndex: number; tail: Uint8Array; ownerBeforeTail: number | null; segments: Segment[] }>();
  let work = 0, capped = false;
  return {
    consumeOwnedParameters(table: ElementParameterTable): void {
      if (!options.elementIds.has(table.elementId) || ![2024, 2025, 2026, 2027].includes(options.revitVersion ?? 0)) return;
      for (const parameter of table.parameters) {
        if (parameter.parameterId !== STRUCTURAL_SECTION_SHAPE_PARAMETER || typeof parameter.value !== "number" || !Number.isSafeInteger(parameter.value)) continue;
        const previous = shapes.get(table.elementId);
        if (shapes.size >= 100_000 && previous === undefined) { capped = true; return; }
        shapes.set(table.elementId, previous === undefined || previous === parameter.value ? parameter.value : null);
      }
    },
    consume(data: Uint8Array, location: { stream: string; chunkIndex: number; rawOffset: number; complete: boolean }): void {
      if (capped || !/^Partitions\/\d+$/.test(location.stream) || ![2024, 2025, 2026, 2027].includes(options.revitVersion ?? 0)) return;
      if (!location.complete) { tails.delete(location.stream); return; }
      work += data.length;
      if (work > 512 * 1024 * 1024) { capped = true; return; }
      const previousTail = tails.get(location.stream);
      const previous = previousTail?.chunkIndex === location.chunkIndex - 1 ? previousTail : undefined;
      const tailLength = previous?.tail.length ?? 0;
      const segments: Segment[] = [...(previous?.segments ?? []), { from: tailLength, to: tailLength + data.length, chunkIndex: location.chunkIndex, rawOffset: location.rawOffset, valueOffset: 0 }];
      if (previous) { const joined = new Uint8Array(tailLength + data.length); joined.set(previous.tail); joined.set(data, tailLength); data = joined; }
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let owner: number | null = previous?.ownerBeforeTail ?? null;
      const cut = Math.max(0, data.length - 96); let ownerBeforeTail = owner, checkpointed = false;
      for (let at = 8; at + 8 <= data.length; at++) {
        if (!checkpointed && at >= cut) { ownerBeforeTail = owner; checkpointed = true; }
        // The block marker is 56 ff bytes and three zeros. Longer ff padding
        // is not a marker. ID zero explicitly terminates the preceding owner.
        if (at + 59 <= data.length && data[at] === 255 && data[at - 1] !== 255 && data[at + 56] === 0 && data[at + 57] === 0 && data[at + 58] === 0 && data.subarray(at, at + 56).every(byte => byte === 255)) {
          const id = view.getBigUint64(at - 8, true);
          if (id === 0n) owner = null;
          else owner = id <= 0xffff_ffffn && options.elementIds.has(Number(id)) ? Number(id) : null;
          at += 58; continue;
        }
        if (owner === null || at < 16 || at + 8 <= tailLength || view.getInt32(at + 4, true) !== -1) continue;
        const field = fields.get(view.getInt32(at, true));
        if (!field || !data.subarray(at - 8, at).every(byte => byte === 255)) continue;
        const value = view.getFloat64(at - 16, true);
        if (!Number.isFinite(value) || Math.abs(value) > 1000) continue;
        const row = held.get(owner) ?? new Map();
        if (held.size >= 100_000 && !held.has(owner)) { capped = true; return; }
        const retainedValue = row.get(field);
        const witnesses = retainedValue?.witnesses ?? [];
        const valueSegment = segments.find(segment => at - 16 >= segment.from && at - 16 < segment.to);
        if (witnesses.length < 16 && valueSegment) witnesses.push({ parameterId: STRUCTURAL_SECTION_PARAMETERS[field], stream: location.stream,
          chunkIndex: valueSegment.chunkIndex, rawOffset: valueSegment.rawOffset,
          valueOffset: valueSegment.valueOffset + at - 16 - valueSegment.from });
        row.set(field, { value: retainedValue && retainedValue.value !== value ? null : value, witnesses }); held.set(owner, row);
        at += 7;
      }
      if (!checkpointed) ownerBeforeTail = owner;
      tails.set(location.stream, { chunkIndex: location.chunkIndex, tail: data.slice(cut), ownerBeforeTail, segments: segments.filter(segment => segment.to > cut).map(segment => ({ ...segment, from: Math.max(0, segment.from - cut), to: segment.to - cut, valueOffset: segment.valueOffset + Math.max(0, cut - segment.from) })) });
    },
    finish(typeIds: ReadonlySet<number>): NativeStructuralSection[] {
      if (capped) return [];
      const result: NativeStructuralSection[] = [];
      for (const [typeId, row] of held) {
        if (!typeIds.has(typeId)) continue;
        const values = Object.fromEntries([...row].map(([key, entry]) => [key, entry.value])) as Record<Field, number | null>;
        const { widthFeet: w, depthFeet: d, webFeet: web, flangeFeet: flange, centroidXFeet: x, centroidYFeet: y } = values;
        if ([w, d, web, flange, x, y].some(value => value == null) || !(w! > 0 && d! > 0 && web! > 0 && web! < w! && flange! > 0 && 2 * flange! < d!)) continue;
        const shapeCode = shapes.get(typeId) ?? null;
        // Autodesk API defines parallel-flange I=6 and wide-flange I=8.
        // Centered metrics alone also fit other symmetric section families.
        const provenI = [6, 8].includes(shapeCode ?? 0) && Math.abs(x! - w! / 2) <= 1e-4 && Math.abs(y! - d! / 2) <= 1e-4;
        result.push({ typeId, shape: provenI ? "symmetric-I" : "unresolved", shapeCode, ...(provenI ? { shapeSource: "owned-integer-STRUCTURAL_SECTION_SHAPE" as const } : {}), widthFeet: w!, depthFeet: d!, webFeet: web!, flangeFeet: flange!, centroidXFeet: x!, centroidYFeet: y!, revitVersion: options.revitVersion!, source: "declared-type-value-block-six-section-parameters", witnesses: [...row.values()].flatMap(entry => entry.witnesses) });
      }
      return result.sort((a, b) => a.typeId - b.typeId);
    },
    get capped(): boolean { return capped; },
  };
}
