import type { ConvertResult } from './types.ts';
import type { IndoorDataset } from './indoor-contract.ts';
import { routingFloorPlateRecords } from './routing-floor-support.ts';

/** Physical planes may exist without a drawing room annotation. This inventory
 * certifies only original flat support and persisted stair membership, not
 * enclosure, public access, or equivalence of room identities. */
export type NativePhysicalLevels = {
  version: 1;
  sourceModelSha256: string;
  levels: {
    nativeLevelId: number;
    sourceName: string;
    elevationFeet: number;
    nativeFloorElementIds: number[];
    nativeStairElementIds: number[];
    annotationLevel: boolean;
  }[];
  displayAliases: {
    nativeLevelId: number;
    displayFloorId: string;
    sourceName: string;
    elevationFeet: number;
    evidence: 'original-fractional-level-name';
    provisional: true;
  }[];
};

export function prepareNativePhysicalLevels(
  model: Pick<ConvertResult, 'levels' | 'elementBounds' | 'nativeStairAssemblies'>,
  data: Pick<IndoorDataset, 'source' | 'nativeLevels' | 'records' | 'floors'>,
): NativePhysicalLevels {
  const annotated = new Set(data.records.map(r => r.levelId));
  const elements = new Map(model.elementBounds.map(r => [r.elementId, r]));
  const levels = data.nativeLevels.map(level => ({
    nativeLevelId: level.id,
    sourceName: level.name,
    elevationFeet: level.elevationFeet,
    nativeFloorElementIds: routingFloorPlateRecords(model, level.elevationFeet).map(r => r.elementId).sort((a,b) => a-b),
    nativeStairElementIds: (model.nativeStairAssemblies ?? []).filter(a => {
      const runs = a.runAndLandingIds.map(id => elements.get(id)).filter(r => r?.stairTreads?.length);
      return runs.some(r => Math.abs(r!.boundsFeet.min.z-level.elevationFeet)<.05 ||
        Math.abs(Math.max(...r!.stairTreads!.flat().map(p=>p[2]))-level.elevationFeet)<.05);
    }).map(a=>a.stairElementId).sort((a,b)=>a-b),
    annotationLevel: annotated.has(level.id),
  }));
  const visible = new Set(data.floors.flatMap(f=>f.levelIds));
  const heights = data.nativeLevels.filter(l=>visible.has(l.id)).map(l=>l.elevationFeet);
  const displayAliases: NativePhysicalLevels['displayAliases'] = [];
  // This reversible display convention never flattens coordinates. Extra
  // technical/roof planes above the current public storeys remain ungrouped.
  for (const level of levels) {
    if (visible.has(level.nativeLevelId) || !level.nativeFloorElementIds.length ||
        !level.nativeStairElementIds.length || !heights.length ||
        level.elevationFeet<Math.min(...heights) || level.elevationFeet>Math.max(...heights)) continue;
    const fraction = /^Floor\s+(\d+)\.(\d+)$/i.exec(level.sourceName.trim());
    if (!fraction || Number(fraction[2])===0) continue;
    const base = data.nativeLevels.find(l=>new RegExp(`^Floor\\s+${Number(fraction[1])}$`,'i').test(l.name.trim()));
    const targets = base ? data.floors.filter(f=>f.levelIds.includes(base.id)) : [];
    if (targets.length!==1) continue;
    displayAliases.push({nativeLevelId:level.nativeLevelId,displayFloorId:targets[0]!.id,
      sourceName:level.sourceName,elevationFeet:level.elevationFeet,
      evidence:'original-fractional-level-name',provisional:true});
  }
  return {version:1,sourceModelSha256:data.source.modelSha256,levels,displayAliases};
}

/** Additional working planes require an exact native slab and original flight
 * endpoint, within the existing display storeys. Aliasing is presentation only. */
export function nativePhysicalWorkingLevelIds(data: Pick<IndoorDataset,'records'|'nativePhysicalLevels'>) {
  return [...new Set([...data.records.map(r=>r.levelId), ...
    (data.nativePhysicalLevels?.displayAliases.map(a=>a.nativeLevelId)??[])])];
}
