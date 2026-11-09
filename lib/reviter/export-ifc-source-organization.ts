/** Optional IFC4 source organization semantics. Areas are nonhierarchical
 * IfcSpatialZones; MEP spaces are identity-only IfcSpaces. Canonical placements
 * and geometry are never changed by source-coordinate metadata.
 * IFC4 ADD2 TC1 contracts: docs/native-spatial-organization.md.
 */
import type { NativeSpatialOrganization, NativeStoredTransform } from "./native-spatial-organization.ts";
type Writer = { add(expression: string): number };
const PIN = "1c3d337dbd2a6810e9dfad68fe99857843d67387";
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): number | null => typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 16384;
const refs = (a: number[]) => `(${a.map(n => `#${n}`).join(",")})`;
const real = (v: number) => { const s = String(Number(v.toPrecision(15))); return /[eE]/.test(s) ? s.replace(/^(\d+|-\d+)([eE])/, "$1.$2").toUpperCase() : s.includes(".") ? s : `${s}.`; };
export function validIfcSourceOrganization(inventory: NativeSpatialOrganization | undefined, sourceSha256: string | undefined): inventory is NativeSpatialOrganization {
  return !!inventory && inventory.kind === "native-spatial-organization" && hash(sourceSha256) && inventory.sourceSha256 === sourceSha256 && hash(inventory.schemaSha256) && inventory.readerCommit === PIN && inventory.readerPatch === "native-evidence" && [2024, 2025, 2026, 2027].includes(inventory.revitVersion ?? 0) && ["complete", "partial"].includes(inventory.status);
}
/** IFC compound angles use consistent signs and normalized carry, including
 * when a sub-degree negative angle has a zero degree component. */
export function ifcSourceCompoundAngle(radians: number, latitude: boolean): string | null {
  if (!Number.isFinite(radians) || Math.abs(radians) > (latitude ? Math.PI / 2 : Math.PI)) return null;
  const sign = radians < 0 ? -1 : 1, total = Math.round(Math.abs(radians) * 180 / Math.PI * 3600 * 1e6);
  const degree = Math.floor(total / 3_600_000_000), rest = total % 3_600_000_000, minute = Math.floor(rest / 60_000_000), seconds = Math.floor(rest % 60_000_000 / 1_000_000), microseconds = rest % 1_000_000;
  return `(${[degree, minute, seconds, microseconds].map(n => n * sign).join(",")})`;
}
function rigid(t: NativeStoredTransform | null): t is NativeStoredTransform {
  if (!t || !Array.isArray(t.originFeet) || t.originFeet.length !== 3 || !t.originFeet.every(Number.isFinite) || !Array.isArray(t.matrixRows) || t.matrixRows.length !== 3 || t.matrixRows.some(r => !Array.isArray(r) || r.length !== 3 || !r.every(Number.isFinite))) return false;
  const r = t.matrixRows;
  if (r.some((a, i) => r.some((b, j) => Math.abs(a.reduce((s, n, k) => s + n * b[k], 0) - (i === j ? 1 : 0)) > 1e-9))) return false;
  return Math.abs(r[0][2]) <= 1e-9 && Math.abs(r[1][2]) <= 1e-9 && Math.abs(r[2][0]) <= 1e-9 && Math.abs(r[2][1]) <= 1e-9 && Math.abs(r[2][2] - 1) <= 1e-9 && Math.abs(r[0][0] * r[1][1] - r[0][1] * r[1][0] - 1) <= 1e-9;
}
export function sourceIfcCoordinateMetadata(inventory: NativeSpatialOrganization | undefined, sourceSha256: string | undefined) {
  if (!validIfcSourceOrganization(inventory, sourceSha256)) return null;
  const c = inventory.coordinates, active = inventory.sites.filter(s => s.active && s.locationId === c.activeLocationId);
  if (c.status !== "proven" || active.length !== 1 || !id(c.activeLocationId) || !id(active[0].siteId) || !rigid(c.storedSiteToInternal) || !rigid(c.internalToShared) || !Array.isArray(c.basePointWitnesses) || !c.basePointWitnesses.length || c.basePointWitnesses.some(w => !id(w.elementId) || !Number.isFinite(w.errorFeet) || w.errorFeet < 0 || w.errorFeet > 1e-6)) return null;
  const north = c.storedSiteToInternal.matrixRows.map(r => r[1]);
  if (!rigid(active[0].storedSiteToInternal) || JSON.stringify(active[0].storedSiteToInternal) !== JSON.stringify(c.storedSiteToInternal)) return null;
  if (!Array.isArray(c.trueNorthInInternal) || c.trueNorthInInternal.length !== 3 || c.trueNorthInInternal.some((v, i) => !Number.isFinite(v) || Math.abs(v - north[i]) > 1e-9)) return null;
  // Revalidate the inverse rather than trusting a caller-edited derived matrix.
  const a = c.storedSiteToInternal, b = c.internalToShared;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (Math.abs(b.matrixRows[i][j] - a.matrixRows[j][i]) > 1e-9) return null;
  for (let i = 0; i < 3; i++) if (Math.abs(b.originFeet[i] + b.matrixRows[i].reduce((s, n, j) => s + n * a.originFeet[j], 0)) > 1e-6) return null;
  return { northStep: `(${real(north[0])},${real(north[1])})`, latitudeStep: active[0].latitudeRadians === null ? null : ifcSourceCompoundAngle(active[0].latitudeRadians, true), longitudeStep: active[0].longitudeRadians === null ? null : ifcSourceCompoundAngle(active[0].longitudeRadians, false), activeLocationId: c.activeLocationId, activeSiteId: active[0].siteId, internalToShared: b };
}
export type SourceOrganizationIfcContext = {
  sourceSha256: string | undefined; ownerHistory: number; buildingEntity: number; projectEntity: number; siteEntity: number;
  storeyByLevelId: ReadonlyMap<number, number>; representedElementIds: ReadonlySet<number>; suppressedElementIds: ReadonlySet<number>;
  includeSpatial: boolean; includeCoordinates: boolean;
  nativeGlobalId: (elementId: number) => string | undefined;
  globalId: (elementId: number) => string;
  guid: (kind: string, key: string | number) => string; quoted: (text: string) => string;
};
export function emitSourceOrganizationIfc(writer: Writer, inventory: NativeSpatialOrganization | undefined, context: SourceOrganizationIfcContext) {
  const entityByElementId = new Map<number, number>();
  if (!validIfcSourceOrganization(inventory, context.sourceSha256)) return { entityByElementId, areaCount: 0, mepSpaceCount: 0 };
  const { quoted: q, ownerHistory, guid } = context;
  const property = (name: string, value: string) => writer.add(`IFCPROPERTYSINGLEVALUE(${q(name)},$,IFCTEXT(${q(value)}),$)`);
  const attach = (owner: number, name: string, key: string | number, properties: number[]) => {
    const set = writer.add(`IFCPROPERTYSET(${q(guid(`pset-${name}`, key))},#${ownerHistory},${q(name)},$,${refs(properties)})`);
    writer.add(`IFCRELDEFINESBYPROPERTIES(${q(guid(`rel-${name}`, key))},#${ownerHistory},$,$,(#${owner}),#${set})`);
  };
  const provenance = () => [property("SourceSha256", inventory.sourceSha256!), property("SchemaSha256", inventory.schemaSha256!), property("ReaderCommit", inventory.readerCommit), property("ValueSemantics", "stored-source-fields-not-evaluated")];
  let areaCount = 0, mepSpaceCount = 0;
  const seen = new Set(context.representedElementIds), duplicate = new Set<string>(), groupedAreas = new Map<number, number[]>(), groupedSpaces = new Map<number, number[]>();
  const sourceIds = new Set<string>(); for (const row of inventory.spatialElements) { if (sourceIds.has(row.elementId)) duplicate.add(row.elementId); sourceIds.add(row.elementId); }
  if (context.includeSpatial) for (const row of inventory.spatialElements.slice(0, 4096)) {
    const elementId = id(row.elementId);
    if (!elementId || duplicate.has(row.elementId) || row.certifiedForRouting !== false || seen.has(elementId) || context.suppressedElementIds.has(elementId) || !Number.isSafeInteger(row.rawRecordIndex) || row.rawRecordIndex < 0 || (row.name !== null && !text(row.name)) || (row.number !== null && !text(row.number))) continue;
    const area = row.kind === "area" && row.categoryId === -2003200, space = row.kind === "mep-space" && row.categoryId === -2003600;
    if (!area && !space) continue;
    const nativeGuid = context.nativeGlobalId(elementId); if (!nativeGuid || !/^[0-3][0-9A-Za-z_$]{21}$/.test(nativeGuid)) continue;
    const globalId = context.globalId(elementId); if (globalId !== nativeGuid) continue;
    seen.add(elementId);
    const name = row.number || row.name || `Source ${area ? "area" : "MEP space"} ${elementId}`, description = "Native source identity only; boundaries, location, quantities and access are unresolved";
    const entity = writer.add(area
      ? `IFCSPATIALZONE(${q(globalId)},#${ownerHistory},${q(name)},${q(description)},'RevitArea',$,$,${row.name ? q(row.name) : "$"},.USERDEFINED.)`
      : `IFCSPACE(${q(globalId)},#${ownerHistory},${q(name)},${q(description)},'RevitMEPSpace',$,$,${row.name ? q(row.name) : "$"},.ELEMENT.,.NOTDEFINED.,$)`);
    entityByElementId.set(elementId, entity);
    const properties = [...provenance(), property("NativeElementId", row.elementId), property("NativeKind", row.kind), property("NativeCategoryId", String(row.categoryId)), property("RawRecordIndex", String(row.rawRecordIndex)), property("GeometrySource", "identity-only"), writer.add("IFCPROPERTYSINGLEVALUE('CertifiedForRouting',$,IFCBOOLEAN(.F.),$)")];
    for (const [name, value] of Object.entries({ LevelId: row.levelId, PhaseId: row.phaseId, AreaSchemeId: row.areaSchemeId, ZoneId: row.zoneId, Number: row.number })) if (value !== null && text(value)) properties.push(property(name, value));
    attach(entity, "Reviter_SourceSpatial", elementId, properties);
    const parent = (row.levelId && context.storeyByLevelId.get(id(row.levelId) ?? -1)) || context.buildingEntity;
    const groups = area ? groupedAreas : groupedSpaces, values = groups.get(parent) ?? []; values.push(entity); groups.set(parent, values);
    if (area) areaCount++; else mepSpaceCount++;
  }
  for (const [parent, areas] of groupedAreas) writer.add(`IFCRELREFERENCEDINSPATIALSTRUCTURE(${q(guid("source-area-reference", parent))},#${ownerHistory},'Native Areas',$,${refs(areas)},#${parent})`);
  for (const [parent, spaces] of groupedSpaces) writer.add(`IFCRELAGGREGATES(${q(guid("source-mep-space-aggregate", parent))},#${ownerHistory},'Native MEP spaces',$,#${parent},${refs(spaces)})`);
  if (context.includeSpatial) {
    const fields = [...provenance()];
    for (const [name, values] of Object.entries({ Revisions: inventory.revisions, RevisionCatalogs: inventory.revisionCatalog, AreaSchemes: inventory.areaSchemes, WorksetVisibility: inventory.worksetVisibility })) {
      const json = JSON.stringify(values); if (json.length <= 262144) fields.push(property(name, json));
    }
    attach(context.projectEntity, "Reviter_SourceOrganization", "project", fields);
  }
  const coordinate = context.includeCoordinates ? sourceIfcCoordinateMetadata(inventory, context.sourceSha256) : null;
  if (coordinate) attach(context.siteEntity, "Reviter_SourceCoordinates", "site", [...provenance(), property("ActiveLocationId", coordinate.activeLocationId!), property("ActiveSiteId", coordinate.activeSiteId!), property("InternalToSharedAffineFeet", JSON.stringify(coordinate.internalToShared)), property("CoordinateApplication", "metadata-only; certified mesh placements unchanged; projected CRS unresolved")]);
  return { entityByElementId, areaCount, mepSpaceCount };
}
