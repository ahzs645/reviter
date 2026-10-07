import pc from "polygon-clipping";
export type NativeDisplayScopes = {
  version: 1;
  sourceModelSha256: string;
  scopes: {
    id: string;
    levelId: number;
    regionId: string;
    regionRingsSha256: string;
    partsFeet: [number, number][][][];
    evidence: "reviewed-source-enclosure";
  }[];
};
export function validateNativeDisplayScopes(v: NativeDisplayScopes | undefined, model?: string) {
  if (v === undefined) return;
  const hash = (s: unknown) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
  const ids = new Set<string>();
  if (!v || v.version !== 1 || !hash(v.sourceModelSha256) || (model && v.sourceModelSha256 !== model) || !Array.isArray(v.scopes) || v.scopes.length > 1000)
    throw new Error("Invalid native display scope source binding.");
  for (const s of v.scopes) {
    if (!s || typeof s.id !== "string" || !s.id || ids.has(s.id) || !Number.isSafeInteger(s.levelId) || typeof s.regionId !== "string" || !hash(s.regionRingsSha256) || s.evidence !== "reviewed-source-enclosure" || !Array.isArray(s.partsFeet) || !s.partsFeet.length || s.partsFeet.length > 1000 || s.partsFeet.some(p => !Array.isArray(p) || !p.length || p.some(r => !Array.isArray(r) || r.length < 3 || r.length > 100000 || r.some(x => !Array.isArray(x) || x.length !== 2 || x.some(n => !Number.isFinite(n) || Math.abs(n) > 1e7)))))
      throw new Error("Invalid native display scope footprint.");
    ids.add(s.id);
  }
}
export async function nativeDisplayRegionHash(rings: [number, number][][]) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rings))))].map(n => n.toString(16).padStart(2, "0")).join("");
}
/** An explicit reviewed display scope cannot widen a native selection, fill a
 * native opening, change access, or survive a changed native region. */
export async function nativeDisplayScopeParts(v: NativeDisplayScopes | undefined, model: string, level: number, id: string, rings: [number, number][][]) {
  validateNativeDisplayScopes(v, model);
  const scopes = v?.scopes.filter(s => s.levelId === level && s.regionId === id) ?? [];
  if (!scopes.length) return { parts: [], stale: [] };
  const hash = await nativeDisplayRegionHash(rings);
  const matched = scopes.filter(s => s.regionRingsSha256 === hash);
  return {
    parts: matched.length ? pc.intersection(rings, matched.flatMap(s => s.partsFeet)) : [],
    stale: scopes.filter(s => s.regionRingsSha256 !== hash).map(s => s.id),
  };
}
