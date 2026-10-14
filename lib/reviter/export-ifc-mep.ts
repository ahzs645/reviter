import type { NativeMepEvidence } from "./native-mep.ts";

type Writer = { add(expression: string): number };
type Context = {
  ownerHistory: number;
  /** Only identities that actually became exported products. */
  elementEntities: ReadonlyMap<number, number>;
  guid: (kind: string, key: string | number) => string;
  quoted: (text: string) => string;
};

/** Emit semantic MEP facts independently of geometry recovery. Port locations,
 * directions, and system type remain unset without native evidence. */
export function emitNativeMepIfc(writer: Writer, evidence: NativeMepEvidence, context: Context) {
  const { ownerHistory, elementEntities, guid, quoted } = context;
  const refs = (ids: number[]) => `(${ids.map((id) => `#${id}`).join(",")})`;
  let systemCount = 0, portCount = 0, connectionCount = 0;
  for (const system of evidence.systems) {
    const members = [...new Set(system.members.map((id) => elementEntities.get(id)).filter((id): id is number => id != null))];
    if (!members.length) continue;
    const entity = writer.add(`IFCSYSTEM(${quoted(guid("mep-system", system.elementId))},#${ownerHistory},${system.name ? quoted(system.name) : "$"},${quoted(`Native ${system.className}; ElementId ${system.elementId}; RE-162`)},$)`);
    writer.add(`IFCRELASSIGNSTOGROUP(${quoted(guid("mep-membership", system.elementId))},#${ownerHistory},$,$,${refs(members)},$,#${entity})`);
    systemCount++;
  }
  const ports = new Map<string, number>();
  const portsByElement = new Map<number, number[]>();
  function port(elementId: number, index: number): number {
    const key = `${elementId}:${index}`;
    const existing = ports.get(key);
    if (existing != null) return existing;
    const id = writer.add(`IFCDISTRIBUTIONPORT(${quoted(guid("mep-port", key))},#${ownerHistory},${quoted(`Port_${elementId}_${index}`)},${quoted("Native counted connector reference; placement and direction unknown")},$,$,$,.NOTDEFINED.,.NOTDEFINED.,.NOTDEFINED.)`);
    ports.set(key, id);
    const list = portsByElement.get(elementId) ?? [];
    list.push(id); portsByElement.set(elementId, list); portCount++;
    return id;
  }
  const emitted = new Set<string>();
  // Require proven decoder provenance even when accepting a serialized result.
  if (evidence.revitVersion === 2025) for (const connection of evidence.connections) {
    const { elementId, connectorIndex, otherElementId, otherConnectorIndex } = connection;
    if (!connection.sources.some((s) => s.revitVersion === 2025 && (s.decoder === "RE-138" || s.decoder === "RE-141")) || !elementEntities.has(elementId) || !elementEntities.has(otherElementId) || elementId === otherElementId) continue;
    if (![connectorIndex, otherConnectorIndex].every((i) => Number.isInteger(i) && i >= 0 && i <= 0xffff_ffff)) continue;
    const endpoints = [`${elementId}:${connectorIndex}`, `${otherElementId}:${otherConnectorIndex}`].sort();
    const key = endpoints.join("/");
    if (emitted.has(key)) continue;
    emitted.add(key);
    const a = port(elementId, connectorIndex), b = port(otherElementId, otherConnectorIndex);
    writer.add(`IFCRELCONNECTSPORTS(${quoted(guid("mep-connection", key))},#${ownerHistory},$,$,#${a},#${b},$)`);
    connectionCount++;
  }
  for (const [elementId, nested] of portsByElement) writer.add(`IFCRELNESTS(${quoted(guid("mep-ports", elementId))},#${ownerHistory},$,$,#${elementEntities.get(elementId)},${refs(nested)})`);
  return { systemCount, portCount, connectionCount };
}
