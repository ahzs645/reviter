/** Evidence-backed IFC4 MEP emission. See native-mep.ts and its attribution. */
import type { NativeMepDecode, NativeMepPort } from "./native-mep.ts";

type Writer = { add(expression: string): number };
const DISTRIBUTION_ENTITIES = new Set([
  "IFCFLOWSEGMENT", "IFCFLOWFITTING", "IFCFLOWTERMINAL", "IFCFLOWCONTROLLER",
  "IFCFLOWMOVINGDEVICE", "IFCFLOWSTORAGEDEVICE", "IFCFLOWTREATMENTDEVICE",
  "IFCENERGYCONVERSIONDEVICE", "IFCDISTRIBUTIONCONTROLELEMENT",
  "IFCDUCTSEGMENT", "IFCDUCTFITTING", "IFCPIPESEGMENT", "IFCPIPEFITTING",
  "IFCAIRTERMINAL", "IFCSANITARYTERMINAL", "IFCLIGHTFIXTURE", "IFCELECTRICAPPLIANCE",
  "IFCELECTRICDISTRIBUTIONBOARD", "IFCPUMP", "IFCFAN", "IFCBOILER", "IFCCHILLER",
  "IFCCOIL", "IFCVALVE", "IFCDAMPER", "IFCFIRESUPPRESSIONTERMINAL",
  "IFCALARM", "IFCCABLECARRIERSEGMENT", "IFCCABLECARRIERFITTING",
]);

/**
 * Call after all products have been emitted. `entityByElement` must contain
 * the actual emitted class (including any export override). Ports are omitted
 * when either endpoint is absent or its exported class cannot own a port.
 * No position, direction, domain or flow direction is guessed.
 */
export function emitNativeMep(input: {
  writer: Writer;
  nativeMep?: NativeMepDecode;
  /** Upstream measured layouts and candidate membership need local parity review. */
  includeExperimentalMep?: boolean;
  ownerHistory: number;
  building: number;
  productByElement: ReadonlyMap<number, number>;
  entityByElement: ReadonlyMap<number, string>;
  guid: (kind: string, key: string | number) => string;
  quoted: (value: string) => string;
}): { systems: number; ports: number; connections: number; skippedConnections: number; skippedPorts: number } {
  const { writer, nativeMep, ownerHistory, building, productByElement, entityByElement, guid, quoted } = input;
  const counts = { systems: 0, ports: 0, connections: 0, skippedConnections: 0, skippedPorts: 0 };
  if (!nativeMep || !input.includeExperimentalMep) return counts;
  const refs = (ids: readonly number[]) => `(${ids.map((id) => `#${id}`).join(",")})`;
  const hasProduct = (elementId: number) => productByElement.has(elementId);
  const takesPort = (elementId: number) => hasProduct(elementId) && DISTRIBUTION_ENTITIES.has(entityByElement.get(elementId) ?? "");
  const validEnd = (end: { elementId: number; index: number }) => Number.isSafeInteger(end.elementId) && end.elementId > 0 && Number.isSafeInteger(end.index) && end.index >= 0 && end.index < 8;
  const portByKey = new Map<string, number>();
  const nested = new Map<number, number[]>();
  const port = (end: Pick<NativeMepPort, "elementId" | "index">): number => {
    const key = `${end.elementId}:${end.index}`;
    const existing = portByKey.get(key);
    if (existing) return existing;
    const id = writer.add(`IFCDISTRIBUTIONPORT(${quoted(guid("mep-port", key))},#${ownerHistory},${quoted(`Port_${end.elementId}_${end.index}`)},$,$,$,$,.NOTDEFINED.,$,$)`);
    const ids = nested.get(end.elementId) ?? []; ids.push(id); nested.set(end.elementId, ids);
    portByKey.set(key, id); counts.ports += 1;
    return id;
  };
  if (nativeMep.coverage.connectorLayout === "supported" && nativeMep.revitVersion === 2025) {
    const emittedPairs = new Set<string>();
    for (const connection of nativeMep.connections) {
      const { a, b } = connection;
      if (!validEnd(a) || !validEnd(b) || a.elementId === b.elementId || !takesPort(a.elementId) || !takesPort(b.elementId) || !connection.evidence.length) {
        counts.skippedConnections += 1; continue;
      }
      const key = [`${a.elementId}:${a.index}`, `${b.elementId}:${b.index}`].sort().join("-");
      if (emittedPairs.has(key)) continue;
      emittedPairs.add(key);
      const aid = port(a), bid = port(b);
      writer.add(`IFCRELCONNECTSPORTS(${quoted(guid("mep-connects", key))},#${ownerHistory},$,$,#${aid},#${bid},$)`);
      counts.connections += 1;
    }
    for (const end of nativeMep.ports) {
      if (!validEnd(end) || !takesPort(end.elementId)) { counts.skippedPorts += 1; continue; }
      port(end);
    }
  }
  for (const [elementId, ids] of nested) writer.add(`IFCRELNESTS(${quoted(guid("mep-nests", elementId))},#${ownerHistory},'NestedPorts',$,#${productByElement.get(elementId)},${refs(ids)})`);
  if (nativeMep.coverage.systemLayout === "supported") {
    const emitted = new Set<number>();
    for (const system of nativeMep.systems) {
      if (emitted.has(system.elementId) || !system.evidence.length || !system.membershipCandidates.length) continue;
      const candidates = new Set(system.membershipCandidates.map((e) => e.elementId));
      const members = [...new Set(system.candidateMembers)].filter((id) => hasProduct(id) && candidates.has(id)).map((id) => productByElement.get(id)!);
      if (!members.length) continue;
      emitted.add(system.elementId);
      const id = writer.add(`IFCSYSTEM(${quoted(guid("mep-system", system.elementId))},#${ownerHistory},${system.name == null ? "$" : quoted(system.name)},'Experimental membership candidates from native object id references',$)`);
      writer.add(`IFCRELASSIGNSTOGROUP(${quoted(guid("mep-members", system.elementId))},#${ownerHistory},$,$,${refs(members)},$,#${id})`);
      writer.add(`IFCRELSERVICESBUILDINGS(${quoted(guid("mep-services", system.elementId))},#${ownerHistory},$,$,#${id},(#${building}))`);
      counts.systems += 1;
    }
  }
  return counts;
}
