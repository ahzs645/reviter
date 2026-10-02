export const visitorCategories = ["study", "food", "washroom", "department", "entrance", "other"] as const;
export type VisitorCategory = typeof visitorCategories[number];
export type VisitorPlace = {
  displayName?: string;
  description?: string;
  category?: VisitorCategory;
  department?: string;
  color?: string;
  landmark?: boolean;
};
export type VisitorMetadata = {
  version: 1;
  buildings: Record<string, { name: string; shortName?: string }>;
  places: Record<string, VisitorPlace>;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !!v.trim();
/** Curated visitor information never changes a room boundary, entrance or access rule. */
export function validateVisitorMetadata(value: unknown, records: {key: string; building: string}[]): asserts value is VisitorMetadata {
  if (!object(value) || value.version !== 1 || !object(value.buildings) || !object(value.places)
    || Object.keys(value.buildings).length > 1000 || Object.keys(value.places).length > 60000)
    throw new Error("Visitor metadata needs version 1, buildings and places.");
  const buildings = new Set(records.map(r => r.building)), keys = new Set(records.map(r => r.key));
  for (const [id, b] of Object.entries(value.buildings)) {
    if (!buildings.has(id) || !object(b) || !text(b.name, 200) || b.shortName != null && !text(b.shortName, 12)
      || Object.keys(b).some(k => !["name", "shortName"].includes(k)))
      throw new Error(`Invalid visitor building metadata: ${id}`);
  }
  for (const [key, p] of Object.entries(value.places)) {
    if (!keys.has(key) || !object(p) || Object.keys(p).some(k => !["displayName", "description", "category", "department", "color", "landmark"].includes(k))
      || p.displayName != null && !text(p.displayName, 200)
      || p.description != null && !text(p.description, 4000)
      || p.department != null && !text(p.department, 200)
      || p.category != null && !visitorCategories.includes(p.category as VisitorCategory)
      || p.color != null && (typeof p.color !== "string" || !/^#[0-9a-f]{6}$/i.test(p.color))
      || p.landmark != null && typeof p.landmark !== "boolean")
      throw new Error(`Invalid visitor place metadata: ${key}`);
  }
}
