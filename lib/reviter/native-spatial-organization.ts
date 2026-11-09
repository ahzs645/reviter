/** Source spatial/organization records; no geometry or navigation promotion.
 * Pinned native graph/schema contracts from rvt-rs (Apache-2.0), supplemented
 * by exact ElementHeader categories and owned GeoLocation/InstanceInfo fields.
 */
import * as DMath from "./deterministic-math.ts";
import type { NativeEvidenceReport } from "./native-evidence-reader.ts";
import { scheduleCsvCell } from "./export-schedules.ts";

export const NATIVE_SPATIAL_ORGANIZATION_CLASSES = ["RoomElem", "AreaMeasureElem", "BasePoint", "ActiveGeoLocationTrackingElement", "GeoLocation", "GeoSite", "ProjectRevision", "AllProjectRevisions", "WorksetVisibilitySettingsElem"] as const;
type Obj = Record<string, unknown>;
type Point = [number, number, number];
export type NativeStoredTransform = { matrixRows: [Point, Point, Point]; originFeet: Point };
export type SpatialCategoryEvidence = {
  sourceSha256: string; schemaSha256: string; status: "complete" | "partial" | "unsupported";
  records: { elementId: string; categoryId: number; familyId: string | null; ownerViewId: string | null; stream: string; inflatedOffset: number }[];
  inflatedBytes: number; diagnostics: string[];
};
export type NativeSpatialOrganization = {
  kind: "native-spatial-organization"; sourceSha256: string | null; schemaSha256: string | null;
  readerCommit: string; readerPatch: "native-evidence"; revitVersion: number | null;
  status: NativeEvidenceReport["source"]["status"];
  spatialElements: { elementId: string; kind: "room" | "area" | "mep-space" | "unresolved"; categoryId: number | null; name: string | null; number: string | null; levelId: string | null; phaseId: string | null; areaSchemeId: string | null; zoneId: string | null; rawRecordIndex: number; certifiedForRouting: false }[];
  areaSchemes: { elementId: string; name: string | null; description: string | null; rawRecordIndex: number }[];
  revisions: { elementId: string; number: string | null; description: string | null; date: string | null; issued: boolean | null; sequence: number | null; inProjectCatalog: boolean; rawRecordIndex: number }[];
  revisionCatalog: { elementId: string; revisionIds: string[]; rawRecordIndex: number }[];
  worksetVisibility: { elementId: string; invisibleWorksetIds: string[]; rawRecordIndex: number }[];
  sites: { locationId: string; siteId: string | null; name: string | null; active: boolean; project: boolean; storedSiteToInternal: NativeStoredTransform | null; latitudeRadians: number | null; longitudeRadians: number | null; coordinateSystemText: string | null; rawRecordIndex: number }[];
  coordinates: { status: "proven" | "unresolved"; activeLocationId: string | null; projectLocationId: string | null; storedSiteToInternal: NativeStoredTransform | null; internalToShared: NativeStoredTransform | null; trueNorthInInternal: Point | null; basePointWitnesses: { elementId: string; errorFeet: number }[]; reason: string };
  diagnostics: string[]; limitations: string[];
};
const obj = (v: unknown): Obj => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const nat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): string | null => typeof v === "string" && v.length <= 16384 ? v : null;
const sha = (v: unknown): string | null => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) ? v : null;
function id(v: unknown): string | null {
  for (let i = 0; i < 5; i++) {
    if (typeof v === "number") return Number.isSafeInteger(v) ? String(v) : null;
    if (typeof v === "string" && /^-?(0|[1-9][0-9]{0,19})$/.test(v)) return v;
    const o = obj(v); v = o.m_id64 ?? o.m_id;
  }
  return null;
}
const positive = (v: unknown): string | null => { const n = id(v); return n && BigInt(n) > 0n ? n : null; };
function point(v: unknown): Point | null {
  const a = obj(v).m_xyz ?? v;
  return Array.isArray(a) && a.length === 3 && a.every(n => finite(n) !== null) ? [...a] as Point : null;
}
export function applyNativeStoredTransform(t: NativeStoredTransform, p: Point): Point {
  return t.matrixRows.map((row, i) => row.reduce((s, n, j) => s + n * p[j], t.originFeet[i])) as Point;
}
/** Only rigid, proper, upright transforms are used for shared coordinates. */
function transform(v: unknown): NativeStoredTransform | null {
  const o = obj(v), rows = arr(o.m_3x3).map(point), originFeet = point(o.m_or);
  if (rows.length !== 3 || !rows.every((r): r is Point => r !== null) || !originFeet) return null;
  const dot = (a: Point, b: Point) => a.reduce((s, n, i) => s + n * b[i], 0);
  if (rows.some((a, i) => rows.some((b, j) => Math.abs(dot(a, b) - (i === j ? 1 : 0)) > 1e-9))) return null;
  if (Math.abs(rows[0][2]) > 1e-9 || Math.abs(rows[1][2]) > 1e-9 || Math.abs(rows[2][0]) > 1e-9 || Math.abs(rows[2][1]) > 1e-9 || Math.abs(rows[2][2] - 1) > 1e-9 || Math.abs(rows[0][0] * rows[1][1] - rows[0][1] * rows[1][0] - 1) > 1e-9) return null;
  return { matrixRows: rows as [Point, Point, Point], originFeet };
}
function inverse(t: NativeStoredTransform): NativeStoredTransform {
  const rows = t.matrixRows[0].map((_, i) => t.matrixRows.map(r => r[i])) as [Point, Point, Point];
  return { matrixRows: rows, originFeet: rows.map(r => -r.reduce((s, n, i) => s + n * t.originFeet[i], 0)) as Point };
}
type RecordGraph = { raw: Obj; root: Obj; fields: Obj; graph: Obj; rawRecordIndex: number; elementId: string; className: string };
function owned(r: RecordGraph, field: string, targetClass: string): Obj | null {
  const p = obj(r.fields[field]), nodes = arr(r.graph.objects).map(obj);
  if (!nat(p.offset) || !nat(p.pointer_token) || p.pointer_token === 0 || !nat(r.root.start) || !nat(r.root.fields_end) || p.offset < r.root.start || p.offset >= r.root.fields_end) return null;
  const edges = arr(r.graph.edges).map(obj).filter(e => e.source_object_index === 0 && e.pointer_offset === p.offset);
  if (edges.length !== 1 || !nat(edges[0].target_object_index) || edges[0].pointer_token !== p.pointer_token || edges[0].target_class_tag !== p.class_tag) return null;
  const n = nodes[edges[0].target_object_index];
  return n && n.class_name === targetClass && n.class_tag === p.class_tag && n.token === p.pointer_token && nat(n.start) && nat(n.fields_end) && n.start < n.fields_end && nat(r.graph.consumed_bytes) && n.fields_end <= r.graph.consumed_bytes ? obj(n.fields) : null;
}
function savedParameter(r: RecordGraph, parameterId: string): string | null {
  const set = owned(r, "m_pParamValueSetAString", "ParamValueSetAString");
  const values = arr(set?.m_paramSet).map(obj).filter(x => id(x.m_paramId) === parameterId).map(x => text(x.m_value));
  return values.length && values.every(v => v === values[0]) ? values[0] : null;
}
export function buildNativeSpatialOrganization(report: NativeEvidenceReport, categories?: SpatialCategoryEvidence): NativeSpatialOrganization {
  const summary = obj(report.source.summary), schemaSha256 = sha(summary.schema_sha256);
  const out: NativeSpatialOrganization = {
    kind: "native-spatial-organization", sourceSha256: sha(report.sourceSha256), schemaSha256, readerCommit: report.readerCommit, readerPatch: report.readerPatch, revitVersion: finite(summary.revit_version), status: report.source.status,
    spatialElements: [], areaSchemes: [], revisions: [], revisionCatalog: [], worksetVisibility: [], sites: [],
    coordinates: { status: "unresolved", activeLocationId: null, projectLocationId: null, storedSiteToInternal: null, internalToShared: null, trueNorthInInternal: null, basePointWitnesses: [], reason: "Current active site, owned rigid transform and base-point direction proof are required." },
    diagnostics: [], limitations: ["Spatial identities do not certify boundaries, occupiable volume or navigation.", "Partition names/IDs do not establish workset names or element workset ownership.", "Stored geodetic coordinates and CRS text do not establish an EPSG code or map-conversion scale.", "Values are source records, not evaluated Revit API results."],
  };
  if (!out.sourceSha256 || !schemaSha256 || report.readerCommit !== "1c3d337dbd2a6810e9dfad68fe99857843d67387" || report.readerPatch !== "native-evidence" || ![2024, 2025, 2026, 2027].includes(Number(summary.revit_version)) || ["unsupported", "budget-blocked"].includes(report.source.status)) { out.status = report.source.status === "budget-blocked" ? "budget-blocked" : "unsupported"; return out; }
  const records = new Map<string, RecordGraph>(), conflicts = new Set<string>();
  report.source.records.slice(0, 4096).forEach((v, rawRecordIndex) => {
    const raw = obj(v), graph = obj(raw.graph), root = obj(arr(graph.objects)[0]), fields = obj(root.fields), elementId = positive(obj(raw.identity).element_id), source = obj(raw.source);
    if (!elementId || raw.status !== "complete_bounded_graph" || raw.diagnostic !== null || root.class_name !== raw.class_name || id(fields.m_id) !== elementId || !sha(source.body_sha256) || typeof source.stream !== "string" || !/^Partitions\/\d+$/.test(source.stream) || !nat(source.group_record_offset) || !nat(source.body_bytes) || source.body_bytes === 0 || graph.consumed_bytes !== source.body_bytes || !nat(root.start) || !nat(root.fields_end) || root.start >= root.fields_end || root.fields_end > source.body_bytes || !Array.isArray(graph.edges) || id(fields.m_famId) !== "-1") return;
    const previous = records.get(elementId);
    if (previous && (previous.className !== raw.class_name || obj(previous.raw.source).body_sha256 !== source.body_sha256)) conflicts.add(elementId);
    else records.set(elementId, { raw, root, fields, graph, rawRecordIndex, elementId, className: String(raw.class_name) });
  });
  for (const key of conflicts) { records.delete(key); out.diagnostics.push(`Conflicting current source records for ${key}.`); }
  const categoryMap = new Map<string, SpatialCategoryEvidence["records"][number]>(), categoryConflicts = new Set<string>();
  if (categories?.sourceSha256 === out.sourceSha256 && categories.schemaSha256 === schemaSha256 && categories.status === "complete") for (const c of categories.records) {
    const prior = categoryMap.get(c.elementId);
    if (prior && (prior.categoryId !== c.categoryId || prior.familyId !== c.familyId || prior.ownerViewId !== c.ownerViewId)) categoryConflicts.add(c.elementId);
    else categoryMap.set(c.elementId, c);
  }
  for (const key of categoryConflicts) categoryMap.delete(key);
  for (const r of records.values()) {
    const f = r.fields;
    if (r.className === "RoomElem") {
      const c = categoryMap.get(r.elementId), cat = c && c.familyId === null && c.ownerViewId === null && c.stream === obj(r.raw.source).stream ? c.categoryId : null;
      const kind = cat === -2000160 ? "room" : cat === -2003200 ? "area" : cat === -2003600 ? "mep-space" : "unresolved";
      out.spatialElements.push({ elementId: r.elementId, kind, categoryId: cat, name: savedParameter(r, "-1006900"), number: savedParameter(r, "-1006901"), levelId: positive(f.m_levelId), phaseId: positive(f.m_phaseId), areaSchemeId: positive(f.m_areaSchemeId), zoneId: positive(f.m_zoneElementId), rawRecordIndex: r.rawRecordIndex, certifiedForRouting: false });
    }
    if (r.className === "AreaMeasureElem") out.areaSchemes.push({ elementId: r.elementId, name: text(f.m_areaElemName), description: text(f.m_areaElemDescription), rawRecordIndex: r.rawRecordIndex });
    if (r.className === "AllProjectRevisions" && arr(f.m_revisionIds).length <= 2048 && arr(f.m_revisionIds).every(v => positive(v))) out.revisionCatalog.push({ elementId: r.elementId, revisionIds: arr(f.m_revisionIds).map(v => positive(v)!), rawRecordIndex: r.rawRecordIndex });
    if (r.className === "ProjectRevision") out.revisions.push({ elementId: r.elementId, number: text(f.m_numberStr), description: text(f.m_description), date: text(f.m_date), issued: typeof f.m_issued === "boolean" ? f.m_issued : null, sequence: Number.isSafeInteger(f.m_sequenceNumber) ? Number(f.m_sequenceNumber) : null, inProjectCatalog: false, rawRecordIndex: r.rawRecordIndex });
    if (r.className === "WorksetVisibilitySettingsElem" && Array.isArray(f.m_invisibleWorksets) && f.m_invisibleWorksets.length <= 2048 && f.m_invisibleWorksets.every(v => id(v) !== null)) out.worksetVisibility.push({ elementId: r.elementId, invisibleWorksetIds: f.m_invisibleWorksets.map(v => id(v)!), rawRecordIndex: r.rawRecordIndex });
  }
  const catalogs = out.revisionCatalog;
  if (catalogs.length === 1) for (const r of out.revisions) r.inProjectCatalog = catalogs[0].revisionIds.includes(r.elementId);
  const trackers = [...records.values()].filter(r => r.className === "ActiveGeoLocationTrackingElement");
  if (trackers.length === 1) { out.coordinates.activeLocationId = positive(trackers[0].fields.m_activeGeoLocationId); out.coordinates.projectLocationId = positive(trackers[0].fields.m_projectGeoLocationId); }
  for (const r of records.values()) if (r.className === "GeoLocation") {
    const info = owned(r, "m_pInstanceInfo", "InstanceInfo"), siteId = positive(info?.m_symbolId), site = siteId ? records.get(siteId) : null;
    const sf = site?.className === "GeoSite" ? site.fields : {};
    out.sites.push({ locationId: r.elementId, siteId, name: text(r.fields.m_name), active: r.elementId === out.coordinates.activeLocationId, project: r.elementId === out.coordinates.projectLocationId, storedSiteToInternal: transform(info?.m_Trf), latitudeRadians: finite(sf.m_dLatitude), longitudeRadians: finite(sf.m_dLongitude), coordinateSystemText: text(sf.m_geoCoordinateSystem), rawRecordIndex: r.rawRecordIndex });
  }
  const active = out.sites.find(s => s.active), t = active?.storedSiteToInternal;
  if (t && active.siteId && records.get(active.siteId)?.className === "GeoSite") {
    out.coordinates.storedSiteToInternal = t;
    for (const r of records.values()) if (r.className === "BasePoint" && r.fields.m_locationType === 1) {
      const geometry = point(owned(r, "m_oGPoint", "GPoint")?.m_coord), shared = point(r.fields.m_transformedPosition);
      if (!geometry || !shared) continue;
      const projected = applyNativeStoredTransform(t, shared), errorFeet = DMath.hypot(...projected.map((n, i) => n - geometry[i]));
      out.coordinates.basePointWitnesses.push({ elementId: r.elementId, errorFeet });
    }
    if (out.coordinates.basePointWitnesses.length && out.coordinates.basePointWitnesses.every(w => w.errorFeet <= 1e-6)) {
      out.coordinates.status = "proven"; out.coordinates.internalToShared = inverse(t);
      out.coordinates.trueNorthInInternal = t.matrixRows.map(row => row[1]) as Point;
      out.coordinates.reason = "Explicit active location -> owned InstanceInfo -> source GeoSite; stored transform direction verified against survey BasePoint owned GPoint and stored transformed position.";
    } else out.coordinates.reason = "Active site transform retained; survey BasePoint direction proof is absent or disagrees.";
  }
  if (out.spatialElements.some(r => r.kind === "unresolved") || out.diagnostics.length) out.status = "partial";
  return out;
}
export function makeNativeSpatialOrganizationCsv(out: NativeSpatialOrganization): string {
  const rows: unknown[][] = [["Source SHA256", "Kind", "Element ID", "Field", "Source or derived value", "Raw record index"]];
  for (const [kind, records] of Object.entries({ spatial: out.spatialElements, "area-scheme": out.areaSchemes, revision: out.revisions, "revision-catalog": out.revisionCatalog, "workset-visibility": out.worksetVisibility, site: out.sites })) for (const record of records) for (const [field, value] of Object.entries(record)) rows.push([out.sourceSha256, kind, "elementId" in record ? record.elementId : record.locationId, field, value !== null && typeof value === "object" ? JSON.stringify(value) : value, record.rawRecordIndex]);
  for (const [field, value] of Object.entries(out.coordinates)) rows.push([out.sourceSha256, "coordinate-evidence", out.coordinates.activeLocationId, field, value !== null && typeof value === "object" ? JSON.stringify(value) : value, null]);
  rows.push([out.sourceSha256, "scope", null, "status", out.status, null]);
  rows.push([out.sourceSha256, "scope", null, "limitations", JSON.stringify(out.limitations), null]);
  return rows.map(row => row.map(v => scheduleCsvCell(v as string | number | boolean | null)).join(",")).join("\r\n") + "\r\n";
}
