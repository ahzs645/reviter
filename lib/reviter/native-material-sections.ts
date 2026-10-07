/** Independently recovered original native material at a stated horizontal cut.
 * Plan sections and ankle-height sections are distinct; neither is an envelope. */
export type NativeMaterialSections = {
  version: 1;
  sourceModelSha256: string;
  geometrySha256: string;
  levels: {
    levelId: number;
    elevationFeet: number;
    cutElevationFeet: number;
    evidenceSha256: string;
    /** Original owners whose presence/absence was independently checked here. */
    sourceElementIds: number[];
    sections: {
      nativeElementId: number;
      categoryId: number;
      kind: 'wall' | 'window' | 'column';
      baseElevationFeet: number;
      topElevationFeet: number;
      partsFeet: [number, number][][][];
    }[];
  }[];
};
const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function validateNativeMaterialSections(value: NativeMaterialSections | undefined, model?: string) {
  if(value === undefined) return;
  if(!value || value.version !== 1 || !digest(value.sourceModelSha256) || !digest(value.geometrySha256) || model && model !== value.sourceModelSha256 || !Array.isArray(value.levels) || !value.levels.length || value.levels.length > 1000) throw new Error('Invalid original native material source binding.');
  const seen = new Set<string>();
  for(const row of value.levels) {
    const id = `${row?.levelId}:${row?.elevationFeet}:${row?.cutElevationFeet}`;
    if(!row || !Number.isSafeInteger(row.levelId) || !Number.isFinite(row.elevationFeet) || !Number.isFinite(row.cutElevationFeet) || row.cutElevationFeet <= row.elevationFeet || row.cutElevationFeet > row.elevationFeet + 20 || seen.has(id) || !digest(row.evidenceSha256) || !Array.isArray(row.sourceElementIds) || !row.sourceElementIds.length || row.sourceElementIds.length > 100000 || row.sourceElementIds.some(n=>!Number.isSafeInteger(n)||n<=0) || new Set(row.sourceElementIds).size !== row.sourceElementIds.length || !Array.isArray(row.sections) || row.sections.length > 100000) throw new Error('Invalid original native material cut evidence.');
    seen.add(id);const owners = new Set(row.sourceElementIds), parts = new Set<number>();
    for(const section of row.sections) {
      if(!section || !owners.has(section.nativeElementId) || parts.has(section.nativeElementId) || !Number.isSafeInteger(section.categoryId) || !['wall','window','column'].includes(section.kind) || !Number.isFinite(section.baseElevationFeet) || !Number.isFinite(section.topElevationFeet) || section.baseElevationFeet > row.cutElevationFeet + 1e-7 || section.topElevationFeet < row.cutElevationFeet - 1e-7 || !Array.isArray(section.partsFeet) || !section.partsFeet.length || section.partsFeet.length > 10000 || section.partsFeet.some(part=>!Array.isArray(part)||!part.length||part.some(ring=>!Array.isArray(ring)||ring.length<3||ring.length>100000||ring.some(point=>!Array.isArray(point)||point.length!==2||point.some(n=>!Number.isFinite(n)||Math.abs(n)>1e7))))) throw new Error('Invalid original native material footprint or finite body height.');
      parts.add(section.nativeElementId);
    }
  }
}
export async function nativeMaterialSectionsHash(value: Omit<NativeMaterialSections,'geometrySha256'> | NativeMaterialSections) {
  const bytes = new TextEncoder().encode(JSON.stringify([value.version,value.sourceModelSha256,value.levels]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function verifyNativeMaterialSections(value: NativeMaterialSections | undefined, model?: string) {
  validateNativeMaterialSections(value,model);
  if(value && value.geometrySha256 !== await nativeMaterialSectionsHash(value)) throw new Error('Original native material checksum changed; regenerate its source evidence.');
}
/** Call once for each verified immutable calculation, never globally on mutable authoring. */
export function createNativeMaterialSectionIndex(value: NativeMaterialSections | undefined, model: string) {
  validateNativeMaterialSections(value,model);
  return {at: (elevation: number, cut: number, levelId?: number) => value?.levels.filter(row => Math.abs(row.elevationFeet-elevation)<.05 && Math.abs(row.cutElevationFeet-cut)<1e-6 && (levelId === undefined || row.levelId === levelId)) ?? []};
}
export type NativeMaterialSectionIndex = ReturnType<typeof createNativeMaterialSectionIndex>;
