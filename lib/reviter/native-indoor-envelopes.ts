/** Native BRep enclosure sections intersected with exact physical slab support.
 * Explicit provisional corner corrections retain their separate binding;
 * old room contours identify ownership only, never this footprint. */
export type NativeIndoorEnvelopes = {
  version: 1;
  sourceModelSha256: string;
  geometrySha256: string;
  levels: {
    levelId: number;
    elevationFeet: number;
    partsFeet: [number, number][][][];
    sourceElementIds: number[];
    cutElevationsFeet: number[];
    evidenceSha256: string;
    /** Human-authorized construction assumptions, not original source bodies. */
    provisionalCornerGeometrySha256?: string;
    provisionalCornerIds?: string[];
  }[];
};
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validateNativeIndoorEnvelopes(value: NativeIndoorEnvelopes | undefined, model?: string) {
  if (value === undefined) return;
  if (!value || value.version !== 1 || !hash(value.sourceModelSha256) || !hash(value.geometrySha256) || model && value.sourceModelSha256 !== model || !Array.isArray(value.levels) || !value.levels.length || value.levels.length > 1000)
    throw new Error("Invalid native indoor enclosure source binding.");
  const scopes = new Set<string>();
  for (const level of value.levels) {
    const scope = `${level?.levelId}:${level?.elevationFeet}`;
    if (!level || !Number.isSafeInteger(level.levelId) || !Number.isFinite(level.elevationFeet) || scopes.has(scope) || !hash(level.evidenceSha256) || !Array.isArray(level.sourceElementIds) || !level.sourceElementIds.length || level.sourceElementIds.length > 100000 || level.sourceElementIds.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(level.sourceElementIds).size !== level.sourceElementIds.length || !Array.isArray(level.cutElevationsFeet) || !level.cutElevationsFeet.length || level.cutElevationsFeet.length > 16 || level.cutElevationsFeet.some(z => !Number.isFinite(z) || z <= level.elevationFeet || z > level.elevationFeet + 20) || !Array.isArray(level.partsFeet) || !level.partsFeet.length || level.partsFeet.length > 10000 || level.partsFeet.some(part => !Array.isArray(part) || !part.length || part.some(ring => !Array.isArray(ring) || ring.length < 3 || ring.length > 100000 || ring.some(point => !Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isFinite(n) || Math.abs(n) > 1e7)))))
      throw new Error("Invalid native indoor enclosure footprint or original evidence.");
    scopes.add(scope);
    if (level.provisionalCornerGeometrySha256 !== undefined || level.provisionalCornerIds !== undefined) {
      if (!hash(level.provisionalCornerGeometrySha256) || !Array.isArray(level.provisionalCornerIds) || !level.provisionalCornerIds.length || level.provisionalCornerIds.length > 1000 || level.provisionalCornerIds.some(id => typeof id !== "string" || !id.trim() || id.length > 500) || new Set(level.provisionalCornerIds).size !== level.provisionalCornerIds.length)
        throw new Error("Invalid provisional native corner enclosure binding.");
    }
  }
}
/** Evidence text/checksum is bound together with all exact geometry and IDs. */
export async function nativeIndoorEnvelopeHash(value: Omit<NativeIndoorEnvelopes, "geometrySha256"> | NativeIndoorEnvelopes) {
  const bytes = new TextEncoder().encode(JSON.stringify([value.version, value.sourceModelSha256, value.levels]));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
}
export async function verifyNativeIndoorEnvelopes(value: NativeIndoorEnvelopes | undefined, model?: string) {
  validateNativeIndoorEnvelopes(value, model);
  if (value && value.geometrySha256 !== await nativeIndoorEnvelopeHash(value))
    throw new Error("Native indoor enclosure geometry checksum changed; regenerate its source evidence.");
}
export function nativeIndoorEnvelopeParts(value: NativeIndoorEnvelopes | undefined, model: string, elevation: number) {
  validateNativeIndoorEnvelopes(value, model);
  return value?.levels.filter(level => Math.abs(level.elevationFeet - elevation) < 0.05).flatMap(level => level.partsFeet) ?? [];
}

/** One index per independently verified immutable compiler/worker snapshot.
 * Mutable authoring must construct a fresh index for each calculation. */
export function createNativeIndoorEnvelopeIndex(value:NativeIndoorEnvelopes|undefined,model:string) {
 validateNativeIndoorEnvelopes(value,model);
 const levels=value?.levels??[];
 return {parts:(elevation:number)=>levels.filter(level=>Math.abs(level.elevationFeet-elevation)<.05).flatMap(level=>level.partsFeet),levels};
}
export type NativeIndoorEnvelopeIndex=ReturnType<typeof createNativeIndoorEnvelopeIndex>;
