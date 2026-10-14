/** IFC override parameter framing adapted from rvt-rs RE-45, Apache-2.0,
 * https://github.com/helenkwok/rvt-rs/blob/1c3d337/src/partition_ifc_export_overrides.rs
 * Copyright the rvt-rs contributors. Supported measured headers: 2024–2026.
 * Ownership remains constrained to declared native ids and a bounded element
 * data window. Conflicting values remain rejected across all scanned pages.
 */
import { parameterDisplayName } from "./built-in-parameters.ts";
import type { ElementParameter } from "./element-parameters.ts";
import { IFC_EXPORT_PARAMETER_IDS } from "./ifc-export-semantics.ts";

export function createIfcExportParameterCollector(revitVersion: number | null | undefined, declared: ReadonlySet<number>) {
  const classTag = revitVersion === 2024 ? 0x02d3 : revitVersion === 2025 ? 0x02ef : revitVersion === 2026 ? 0x02fd : undefined;
  // Retain two distinct conflict witnesses so downstream instance/type
  // precedence can distinguish ambiguity from a missing instance value.
  // Further distinct values cannot resolve that ambiguity and need no storage.
  const collected = new Map<number, Map<number, Set<string>>>();
  return {
    pushPage(bytes: Uint8Array) {
      if (classTag == null || !declared.size || bytes.length < 18) return;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let owner: number | undefined;
      let ownerAt = -Infinity;
      for (let at = 0; at + 12 <= bytes.length; at++) {
        if (view.getUint32(at, true) === 0xffffffff && view.getUint16(at + 4, true) === classTag && view.getUint32(at + 6, true) === 1 && at + 18 <= bytes.length) {
          const id = view.getBigUint64(at + 10, true);
          owner = id > 0n && id <= 0xffffffffn && declared.has(Number(id)) ? Number(id) : undefined;
          ownerAt = at;
        }
        if (owner == null || at - ownerAt > 0x800) continue;
        const low = view.getInt32(at, true);
        if (low < -1019017 || low > -1019014) continue;
        const raw = view.getBigInt64(at, true);
        if (raw < -1019017n || raw > -1019014n) continue;
        const key = Number(raw);
        if (!(IFC_EXPORT_PARAMETER_IDS as readonly number[]).includes(key)) continue;
        const units = view.getUint32(at + 8, true);
        if (units < 1 || units > 64 || at + 12 + units * 2 > bytes.length) continue;
        let value = "";
        for (let index = 0; index < units; index++) value += String.fromCharCode(view.getUint16(at + 12 + index * 2, true));
        const isEntity = key === -1019014 || key === -1019015;
        if (isEntity ? !/^(?:Ifc[A-Za-z0-9]+|NotExported)$/i.test(value) : !/^[A-Za-z0-9_]+$/.test(value)) continue;
        let values = collected.get(owner);
        if (!values) collected.set(owner, values = new Map());
        let witnesses = values.get(key);
        if (!witnesses) values.set(key, witnesses = new Set());
        if (witnesses.size < 2) witnesses.add(value);
      }
    },
    snapshot(): Map<number, ElementParameter[]> {
      const result = new Map<number, ElementParameter[]>();
      for (const [id, values] of collected) {
        const parameters = [...values].flatMap(([parameterId, witnesses]) => [...witnesses].map(value => ({ parameterId, name: parameterDisplayName(parameterId), value })));
        if (parameters.length) result.set(id, parameters);
      }
      return result;
    },
  };
}
