import type { NativeMepEvidence } from "./native-mep.ts";
import { MEP_MODEL_READER_COMMIT } from "./native-mep-model.ts";

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
    const id = writer.add(`IFCDISTRIBUTIONPORT(${quoted(guid("mep-port", key))},#${ownerHistory},${quoted(`Port_${elementId}_${index}`)},${quoted("Native connector evidence; placement and direction unknown")},$,$,$,.NOTDEFINED.,.NOTDEFINED.,.NOTDEFINED.)`);
    ports.set(key, id);
    const list = portsByElement.get(elementId) ?? [];
    list.push(id); portsByElement.set(elementId, list); portCount++;
    return id;
  }
  const modelSource = (source: NonNullable<NativeMepEvidence["ports"]>[number]["sources"][number]) =>
    (source.decoder === "rvt-rs-connectors" || source.decoder === "rvt-rs-symbol-ports") && source.readerCommit === MEP_MODEL_READER_COMMIT && source.revitVersion === evidence.revitVersion && source.revitVersion >= 2024 && source.revitVersion <= 2026;
  for (const nativePort of evidence.ports ?? []) {
    if (!elementEntities.has(nativePort.elementId) || !nativePort.sources.some(modelSource) || !Number.isInteger(nativePort.connectorIndex) || nativePort.connectorIndex < 0 || nativePort.connectorIndex > 0xffff_ffff) continue;
    port(nativePort.elementId, nativePort.connectorIndex);
  }
  const emitted = new Set<string>();
  // Require proven decoder provenance even when accepting a serialized result.
  for (const connection of evidence.connections) {
    const { elementId, connectorIndex, otherElementId, otherConnectorIndex } = connection;
    if (!connection.sources.some((s) => (evidence.revitVersion === 2025 && s.revitVersion === 2025 && (s.decoder === "RE-138" || s.decoder === "RE-141")) || modelSource(s)) || !elementEntities.has(elementId) || !elementEntities.has(otherElementId) || elementId === otherElementId) continue;
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
  for (const dimensions of evidence.dimensions ?? []) {
    const element = elementEntities.get(dimensions.elementId);
    if (element == null || evidence.revitVersion !== 2025 || !dimensions.sources.some((s) => s.revitVersion === 2025 && ["RE-134", "RE-157", "RE-165", "RE-131"].includes(s.decoder))) continue;
    const properties: number[] = [];
    for (const [name, value] of [
      ["WidthOrDiameter", dimensions.widthFeet], ["Height", dimensions.heightFeet], ["Length", dimensions.lengthFeet],
      ["PipeInnerDiameter", dimensions.pipeInnerDiameterFeet], ["PipeOuterDiameter", dimensions.pipeOuterDiameterFeet], ["FittingNominalDiameter", dimensions.nominalDiameterFeet], ["PipeOutsideRadius", dimensions.pipeAxis?.radiusFeet],
    ] as const) {
      if (value == null || !Number.isFinite(value) || value <= 0 || value >= 1000) continue;
      const metric = value * .3048;
      const literal = Number.isInteger(metric) ? `${metric}.` : metric.toString().includes("e") ? metric.toExponential(12).replace("e", "E") : String(metric);
      properties.push(writer.add(`IFCPROPERTYSINGLEVALUE(${quoted(name)},$,IFCLENGTHMEASURE(${literal}),$)`));
    }
    if (!properties.length) continue;
    if (dimensions.typeId != null && Number.isInteger(dimensions.typeId) && dimensions.typeId > 0 && dimensions.typeId <= 0xffffffff) properties.push(writer.add(`IFCPROPERTYSINGLEVALUE('NativeTypeElementId',$,IFCINTEGER(${dimensions.typeId}),$)`));
    const source = dimensions.sources.map((s) => `${s.decoder}:${s.stream}:${s.chunkIndex}:${s.byteOffset}`).join(";");
    properties.push(writer.add(`IFCPROPERTYSINGLEVALUE('Source',$,IFCTEXT(${quoted(source)}),$)`));
    const pset = writer.add(`IFCPROPERTYSET(${quoted(guid("mep-dimensions", dimensions.elementId))},#${ownerHistory},'Reviter_NativeMepDimensions',$,${refs(properties)})`);
    writer.add(`IFCRELDEFINESBYPROPERTIES(${quoted(guid("mep-dimension-properties", dimensions.elementId))},#${ownerHistory},$,$,(#${element}),#${pset})`);
  }
  return { systemCount, portCount, connectionCount };
}
