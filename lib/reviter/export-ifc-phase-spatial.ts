import { nativePhaseLifecycle, type NativeExportPhaseEvidence, type NativePhaseSpatialEvidence } from "./native-phase-spatial.ts";

/** Custom provenance properties and Revit's source Phasing labels only.
 * Standard IFC Status requires separately proven export-phase context; this
 * emitter deliberately retains lifecycle in an explicit source-evidence set.
 */
export function emitNativePhaseSpatialIfc(
  writer: { add(expression: string): number },
  evidence: NativePhaseSpatialEvidence,
  context: {
    ownerHistory: number;
    elementEntities: ReadonlyMap<number, number>;
    levelNames: ReadonlyMap<number, string>;
    guid(kind: string, key: string | number): string;
    quoted(text: string): string;
    targetPhaseEvidence?: NativeExportPhaseEvidence;
  },
) {
  const { ownerHistory, elementEntities, levelNames, guid, quoted } = context;
  const phaseNames = new Map(evidence.phases.map((phase) => [phase.phaseId, phase.name]));
  const property = (name: string, value: string) => writer.add(`IFCPROPERTYSINGLEVALUE(${quoted(name)},$,IFCLABEL(${quoted(value)}),$)`);
  const set = (entity: number, elementId: number, kind: string, name: string, entries: readonly [string, string][]) => {
    if (!entries.length) return;
    const properties = entries.map(([name, value]) => property(name, value));
    const pset = writer.add(`IFCPROPERTYSET(${quoted(guid(kind, elementId))},#${ownerHistory},${quoted(name)},$ ,(${properties.map((id) => `#${id}`).join(",")}))`);
    writer.add(`IFCRELDEFINESBYPROPERTIES(${quoted(guid(`${kind}-rel`, elementId))},#${ownerHistory},$,$,(#${entity}),#${pset})`);
  };
  let phaseElementCount = 0, levelElementCount = 0;
  for (const element of evidence.elementPhases) {
    const entity = elementEntities.get(element.elementId);
    if (entity == null || (element.createdPhaseId == null && element.demolishedPhaseId == null)) continue;
    const labels: [string, string][] = [];
    const createdName = element.createdPhaseId == null ? undefined : phaseNames.get(element.createdPhaseId);
    const demolishedName = element.demolishedPhaseId == null ? undefined : phaseNames.get(element.demolishedPhaseId);
    if (createdName) labels.push(["Phase Created", createdName]);
    if (demolishedName) labels.push(["Phase Demolished", demolishedName]);
    set(entity, element.elementId, "pset-native-phasing-labels", "Phasing", labels);
    const values: [string, string][] = [["Source", element.source], ["Lifecycle", nativePhaseLifecycle(element, evidence.phases, context.targetPhaseEvidence)]];
    if (element.createdPhaseId != null) values.push(["CreatedPhaseElementId", String(element.createdPhaseId)]);
    if (element.demolishedPhaseId != null) values.push(["DemolishedPhaseElementId", String(element.demolishedPhaseId)]);
    values.push(["DemolitionKnown", element.demolitionKnown ? "true" : "false"]);
    set(entity, element.elementId, "pset-native-phase-evidence", "Reviter_PhaseEvidence", values);
    phaseElementCount++;
  }
  for (const element of evidence.levelParameters) {
    const entity = elementEntities.get(element.elementId);
    if (entity == null) continue;
    const values: [string, string][] = [];
    const add = (name: string, levelId: number | undefined) => {
      if (levelId == null || !levelNames.has(levelId)) return;
      values.push([`${name}ElementId`, String(levelId)], [name, levelNames.get(levelId)!]);
    };
    add("Level", element.levelId); add("TopConstraint", element.topLevelId);
    add("StairBaseLevel", element.stairBaseLevelId); add("StairTopLevel", element.stairTopLevelId);
    set(entity, element.elementId, "pset-native-level-parameters", "Reviter_LevelParameters", values);
    if (values.length) levelElementCount++;
  }
  return { phaseElementCount, levelElementCount };
}
