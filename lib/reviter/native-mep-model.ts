/** Project pinned rvt-rs's explicit connector model onto native identities.
 * Its producer uses native_connectors.rs (RE-169/171), with RE-138/141 fallback
 * when the native record path cannot be read. No scene geometry is imported. */
import type { MepModelSource, NativeMepConnection, NativeMepDimensions, NativeMepEvidence, NativeMepPort } from "./native-mep.ts";

export const MEP_MODEL_READER_COMMIT = "1c3d337dbd2a6810e9dfad68fe99857843d67387";
export const MEP_MODEL_RELEASES = [2024, 2025, 2026] as const;
const MAX_ENTITIES = 500_000;
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | undefined { return value != null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : undefined; }
function uint32(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff; }
function identity(entity: ObjectValue | undefined): number | undefined {
  if (entity?.kind !== "BuildingElement" || typeof entity.type_guid !== "string" || !/^[1-9]\d{0,9}$/.test(entity.type_guid)) return undefined;
  const id = Number(entity.type_guid);
  return uint32(id) && id > 0 ? id : undefined;
}
const portKey = (elementId: number, index: number) => `${elementId}:${index}`;
const joinKey = (connection: NativeMepConnection) => [portKey(connection.elementId, connection.connectorIndex), portKey(connection.otherElementId, connection.otherConnectorIndex)].sort().join("/");
function normalizeJoin(a: number, ai: number, b: number, bi: number, source: MepModelSource): NativeMepConnection {
  if (a > b) [a, ai, b, bi] = [b, bi, a, ai];
  return { elementId: a, connectorIndex: ai, otherElementId: b, otherConnectorIndex: bi, sources: [source] };
}

export type NativeMepModelContext = { revitVersion: number; declaredElementIds: ReadonlySet<number>; readerCommit: string; readerMode: string; partial?: boolean };

/** Input must be the producer's model for these same bytes. Validating its
 * references binds a projection; it does not authenticate arbitrary JSON. */
export function decodeNativeMepModel(model: unknown, context: NativeMepModelContext): NativeMepEvidence {
  const limitations = ["Connector provenance is the pinned reader's explicit model entity, not an exposed binary byte span.", "The pinned producer reads RE-171 native joins with RE-138/141 fallback; model output does not identify an individual join's reader path.", "Native port indices do not establish flow direction, placement, or classification."];
  const empty = (): NativeMepEvidence => ({ revitVersion: context.revitVersion, systems: [], connections: [], ports: [], limitations });
  if (context.readerCommit !== MEP_MODEL_READER_COMMIT || !MEP_MODEL_RELEASES.some((v) => v === context.revitVersion)) { limitations.push("Native MEP model projection is not admitted for this reader commit/release."); return empty(); }
  const entities = object(model)?.entities;
  if (!Array.isArray(entities) || entities.length > MAX_ENTITIES) { limitations.push("Native MEP model has no bounded entity array."); return empty(); }
  if (context.partial) limitations.push("The upstream reader reported partial evidence; no complete topology claim is made.");
  const byIndex = new Map<number, number>(), seen = new Map<number, number>(), ambiguous = new Set<number>();
  for (let i = 0; i < entities.length; i++) {
    const id = identity(object(entities[i]));
    if (id == null || !context.declaredElementIds.has(id)) continue;
    if (seen.has(id)) ambiguous.add(id); else seen.set(id, i);
    byIndex.set(i, id);
  }
  const validOwner = (index: unknown, id: unknown) => uint32(index) && uint32(id) && id > 0 && byIndex.get(index) === id && !ambiguous.has(id);
  const source = (entityIndex: number, decoder: MepModelSource["decoder"]): MepModelSource => ({ stream: null, chunkIndex: null, byteOffset: null, revitVersion: context.revitVersion, decoder, readerCommit: context.readerCommit, readerMode: context.readerMode, entityIndex, sourceKind: "reader-model" });
  const connections = new Map<string, NativeMepConnection>(), ports = new Map<string, NativeMepPort>();
  let rejected = 0;
  for (let i = 0; i < entities.length; i++) {
    const e = object(entities[i]);
    if (e?.kind === "Port") {
      if (!validOwner(e.element, e.id) || !uint32(e.index)) { rejected++; continue; }
      const elementId = e.id as number, connectorIndex = e.index;
      const key = portKey(elementId, connectorIndex), previous = ports.get(key);
      if (previous) previous.sources.push(source(i, "rvt-rs-symbol-ports"));
      else ports.set(key, { elementId, connectorIndex, sources: [source(i, "rvt-rs-symbol-ports")] });
    } else if (e?.kind === "PortConnection") {
      if (!validOwner(e.a, e.a_id) || !validOwner(e.b, e.b_id) || e.a_id === e.b_id || !uint32(e.a_index) || !uint32(e.b_index)) { rejected++; continue; }
      const connection = normalizeJoin(e.a_id as number, e.a_index, e.b_id as number, e.b_index, source(i, "rvt-rs-connectors"));
      const key = joinKey(connection), previous = connections.get(key);
      if (previous) previous.sources.push(...connection.sources); else connections.set(key, connection);
    }
  }
  const destinations = new Map<string, Set<string>>();
  for (const [key, c] of connections) for (const own of [portKey(c.elementId, c.connectorIndex), portKey(c.otherElementId, c.otherConnectorIndex)]) {
    const set = destinations.get(own) ?? new Set<string>(); set.add(key); destinations.set(own, set);
  }
  const conflicts = new Set([...destinations].filter(([, joins]) => joins.size > 1).flatMap(([, joins]) => [...joins]));
  const suppressedConnectorKeys = new Set<string>();
  for (const key of conflicts) {
    const c = connections.get(key)!;
    suppressedConnectorKeys.add(portKey(c.elementId, c.connectorIndex)); suppressedConnectorKeys.add(portKey(c.otherElementId, c.otherConnectorIndex));
  }
  for (const key of conflicts) connections.delete(key);
  if (ambiguous.size) limitations.push(`${ambiguous.size} duplicated native product identities were suppressed.`);
  if (rejected) limitations.push(`${rejected} port/connection entries failed identity or index validation.`);
  if (conflicts.size) limitations.push(`${conflicts.size} ambiguous physical joins were suppressed.`);
  return { revitVersion: context.revitVersion, systems: [], connections: [...connections.values()], ports: [...ports.values()], suppressedConnectorKeys: [...suppressedConnectorKeys], limitations };
}

/** A native model connection overrides a contradictory legacy byte-list join
 * on the same connector. Unaddressed page findings remain visible. */
export function mergeNativeMepEvidence(page: NativeMepEvidence | undefined, projection: NativeMepEvidence): NativeMepEvidence {
  if (!page) return projection;
  if (page.revitVersion !== projection.revitVersion) return { ...page, limitations: [...page.limitations, "Native MEP model release disagrees with page evidence; model projection ignored."] };
  const authoritativePorts = new Set([...(projection.suppressedConnectorKeys ?? []), ...projection.connections.flatMap((c) => [portKey(c.elementId, c.connectorIndex), portKey(c.otherElementId, c.otherConnectorIndex)])]);
  const projected = new Map(projection.connections.map((c) => [joinKey(c), c]));
  const merged = new Map(projected);
  let replaced = 0;
  for (const c of page.connections) {
    const key = joinKey(c), held = merged.get(key);
    if (held) { merged.set(key, { ...held, sources: [...held.sources, ...c.sources] }); continue; }
    if (authoritativePorts.has(portKey(c.elementId, c.connectorIndex)) || authoritativePorts.has(portKey(c.otherElementId, c.otherConnectorIndex))) { replaced++; continue; }
    merged.set(key, c);
  }
  const ports = new Map((page.ports ?? []).map((p) => [portKey(p.elementId, p.connectorIndex), p]));
  for (const p of projection.ports ?? []) ports.set(portKey(p.elementId, p.connectorIndex), p);
  const limitations = [...new Set([...page.limitations.filter((l) => !(projection.ports?.length && l.startsWith("Only joined ports are recovered"))), ...projection.limitations])];
  if (replaced) limitations.push(`${replaced} contradictory legacy joins were replaced by explicit native-model connector evidence.`);
  const dimensions = new Map<number, NativeMepDimensions>(), blocked = new Map<number, Set<string>>();
  let conflicts = 0;
  for (const d of [...(page.dimensions ?? []), ...(projection.dimensions ?? [])]) {
    const held = dimensions.get(d.elementId);
    if (!held) { dimensions.set(d.elementId, { ...d, sources: [...d.sources] }); continue; }
    const rejected = blocked.get(d.elementId) ?? new Set<string>();
    for (const [key, value] of Object.entries(d)) {
      if (key === "elementId" || key === "sources" || rejected.has(key)) continue;
      const old = (held as unknown as Record<string, unknown>)[key];
      if (old !== undefined && JSON.stringify(old) !== JSON.stringify(value)) { delete (held as unknown as Record<string, unknown>)[key]; rejected.add(key); conflicts++; }
      else (held as unknown as Record<string, unknown>)[key] = value;
    }
    held.sources.push(...d.sources); blocked.set(d.elementId, rejected);
  }
  if (conflicts) limitations.push(`${conflicts} conflicting dimensional fields were suppressed during MEP evidence merging.`);
  return { ...page, connections: [...merged.values()], ports: [...ports.values()], dimensions: [...dimensions.values()], suppressedConnectorKeys: [...new Set([...(page.suppressedConnectorKeys ?? []), ...(projection.suppressedConnectorKeys ?? [])])], limitations };
}
