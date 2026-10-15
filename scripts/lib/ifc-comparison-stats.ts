/** A lexical STEP inventory, not a shape validator or an IFC schema validator. */
export type StepRecord = { id: number; entity: string; body: string };

function skipQuoted(text: string, at: number, quote: string): number {
  for (let end = at + 1; end < text.length; end += 1) {
    if (text[end] !== quote) continue;
    if (quote === "'" && text[end + 1] === quote) { end += 1; continue; }
    return end + 1;
  }
  throw new Error(`Unterminated STEP string at ${at}`);
}

/** Strings/comments cannot introduce fake entity records or semicolons. */
export function* stepRecords(text: string): Generator<StepRecord> {
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (character === "'" || character === '"') { at = skipQuoted(text, at, character) - 1; continue; }
    if (character === "/" && text[at + 1] === "*") {
      const end = text.indexOf("*/", at + 2);
      if (end < 0) throw new Error(`Unterminated STEP comment at ${at}`);
      at = end + 1; continue;
    }
    if (character !== "#") continue;
    let cursor = at + 1;
    while (/\d/.test(text[cursor] ?? "")) cursor += 1;
    const idText = text.slice(at + 1, cursor);
    if (!idText) continue;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] !== "=") continue;
    cursor += 1;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    const nameAt = cursor;
    while (/[A-Za-z0-9_]/.test(text[cursor] ?? "")) cursor += 1;
    const entity = text.slice(nameAt, cursor).toUpperCase();
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (!entity.startsWith("IFC") || text[cursor] !== "(") throw new Error(`Unsupported STEP instance at ${at}`);
    const bodyAt = cursor + 1;
    let depth = 1;
    for (cursor += 1; cursor < text.length; cursor += 1) {
      const value = text[cursor];
      if (value === "'" || value === '"') { cursor = skipQuoted(text, cursor, value) - 1; continue; }
      if (value === "/" && text[cursor + 1] === "*") {
        const end = text.indexOf("*/", cursor + 2);
        if (end < 0) throw new Error(`Unterminated STEP comment at ${cursor}`);
        cursor = end + 1; continue;
      }
      if (value === "(") depth += 1;
      if (value !== ")") continue;
      depth -= 1;
      if (depth !== 0) continue;
      const bodyEnd = cursor;
      do { cursor += 1; } while (/\s/.test(text[cursor] ?? ""));
      if (text[cursor] !== ";") throw new Error(`Missing STEP instance terminator at ${cursor}`);
      const id = Number(idText);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid STEP id ${idText}`);
      yield { id, entity, body: text.slice(bodyAt, bodyEnd) };
      at = cursor;
      break;
    }
    if (depth !== 0) throw new Error(`Unterminated STEP instance at ${at}`);
  }
}

/** Limit splits so large triangle/coordinate arrays do not become object trees. */
export function stepArguments(body: string, maximum = 16): string[] {
  const result: string[] = [];
  let depth = 0, start = 0;
  for (let at = 0; at < body.length; at += 1) {
    const character = body[at];
    if (character === "'" || character === '"') { at = skipQuoted(body, at, character) - 1; continue; }
    if (character === "/" && body[at + 1] === "*") {
      const end = body.indexOf("*/", at + 2);
      if (end < 0) throw new Error(`Unterminated STEP argument comment at ${at}`);
      at = end + 1; continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character !== "," || depth !== 0) continue;
    result.push(body.slice(start, at).trim());
    if (result.length === maximum) return result;
    start = at + 1;
  }
  if (result.length < maximum) result.push(body.slice(start).trim());
  return result;
}

function stringValue(value: string | undefined): string | undefined {
  return value?.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : undefined;
}
const GUID = /^[0-3][0-9A-Za-z_$]{21}$/;
const NON_PRODUCT_ROOTS = new Set(["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCPROPERTYSET", "IFCELEMENTQUANTITY", "IFCGROUP", "IFCSYSTEM", "IFCDISTRIBUTIONSYSTEM", "IFCZONE"]);
const GEOMETRY_ENTITIES = new Set(["IFCEXTRUDEDAREASOLID", "IFCREVOLVEDAREASOLID", "IFCFACETEDBREP", "IFCADVANCEDBREP", "IFCTRIANGULATEDFACESET", "IFCPOLYGONALFACESET", "IFCMAPPEDITEM", "IFCBOOLEANRESULT", "IFCBOOLEANCLIPPINGRESULT", "IFCSWEPTDISKSOLID"]);

export type IfcInventory = {
  totalInstances: number;
  classes: Record<string, number>;
  rootClasses: Record<string, number>;
  productClasses: Record<string, number>;
  geometryEntities: Record<string, number>;
  representationTypes: Record<string, number>;
  propertySets: Record<string, number>;
  bodySources: Record<string, number>;
  roots: number;
  products: number;
  productsWithRepresentation: number;
  /** Common IfcElement.Tag decimal IDs only; excludes source IDs kept only in properties. */
  taggedElements: number;
  rootGlobalIds: string[];
  productGlobalIds: string[];
  elementIds: string[];
  duplicateRootGlobalIds: string[];
  limitations: string[];
};

export function inventoryIfc(text: string): IfcInventory {
  if (!/^\s*ISO-10303-21;/i.test(text)) throw new Error("Input is not an ISO-10303-21 document");
  const stats: IfcInventory = {
    totalInstances: 0, classes: {}, rootClasses: {}, productClasses: {}, geometryEntities: {}, representationTypes: {}, propertySets: {}, bodySources: {},
    roots: 0, products: 0, productsWithRepresentation: 0, taggedElements: 0,
    rootGlobalIds: [], productGlobalIds: [], elementIds: [], duplicateRootGlobalIds: [],
    limitations: [
      "Lexical STEP inventory; no independent schema, topology, placement, area or volume validation.",
      "Product root classification excludes spatial containers, relations, property sets, groups and type objects; IfcSpace/ports/openings are included.",
      "ElementId joins use decimal common IfcElement.Tag only; source IDs stored exclusively in property sets are not joined.",
      "A representation reference or geometry entity count is not proof of a correct, complete or native-authored shape.",
    ],
  };
  const rootIds = new Set<string>(), productIds = new Set<string>(), elementIds = new Set<string>(), duplicates = new Set<string>();
  const count = (table: Record<string, number>, key: string) => { table[key] = (table[key] ?? 0) + 1; };
  for (const record of stepRecords(text)) {
    stats.totalInstances += 1;
    count(stats.classes, record.entity);
    if (GEOMETRY_ENTITIES.has(record.entity)) count(stats.geometryEntities, record.entity);
    // Most coordinate/triangle records have no interesting string attributes.
    if (!/^\s*'/.test(record.body) && record.entity !== "IFCSHAPEREPRESENTATION") continue;
    const args = stepArguments(record.body);
    if (record.entity === "IFCSHAPEREPRESENTATION") {
      const kind = stringValue(args[2]);
      if (kind) count(stats.representationTypes, kind);
    }
    if (record.entity === "IFCPROPERTYSINGLEVALUE" && stringValue(args[0]) === "BodySource") {
      const raw = args[2]?.match(/^(?:IFCLABEL|IFCTEXT)\('((?:[^']|'')*)'\)$/i)?.[1];
      if (raw != null) count(stats.bodySources, raw.replaceAll("''", "'"));
    }
    const globalId = stringValue(args[0]);
    if (!globalId || !GUID.test(globalId)) continue;
    stats.roots += 1;
    count(stats.rootClasses, record.entity);
    if (rootIds.has(globalId)) duplicates.add(globalId);
    rootIds.add(globalId);
    if (record.entity === "IFCPROPERTYSET") {
      const name = stringValue(args[2]);
      if (name) count(stats.propertySets, name);
    }
    const isProduct = !record.entity.startsWith("IFCREL") && !record.entity.endsWith("TYPE") && !NON_PRODUCT_ROOTS.has(record.entity) && args.length >= 7;
    if (!isProduct) continue;
    stats.products += 1;
    count(stats.productClasses, record.entity);
    productIds.add(globalId);
    if (/^#[1-9]\d*$/.test(args[6] ?? "")) stats.productsWithRepresentation += 1;
    // IfcSpace.LongName and IfcPort.FlowDirection do not carry element Tags.
    if (record.entity === "IFCSPACE" || record.entity === "IFCDISTRIBUTIONPORT") continue;
    const elementId = stringValue(args[7]);
    if (elementId && /^[1-9]\d*$/.test(elementId)) { stats.taggedElements += 1; elementIds.add(elementId); }
  }
  stats.rootGlobalIds = [...rootIds].sort();
  stats.productGlobalIds = [...productIds].sort();
  stats.elementIds = [...elementIds].sort();
  stats.duplicateRootGlobalIds = [...duplicates].sort();
  return stats;
}

export function compareIfcIdentities(a: IfcInventory, b: IfcInventory) {
  const shared = (left: string[], right: string[]) => {
    const rightSet = new Set(right);
    return left.filter(value => rightSet.has(value));
  };
  const root = shared(a.rootGlobalIds, b.rootGlobalIds);
  const products = shared(a.productGlobalIds, b.productGlobalIds);
  const tags = shared(a.elementIds, b.elementIds);
  return {
    sharedRootGlobalIds: root.length,
    sharedProductGlobalIds: products.length,
    sharedTaggedElementIds: tags.length,
    sharedProductGlobalIdSample: products.slice(0, 50),
    sharedTaggedElementIdSample: tags.slice(0, 50),
    interpretation: "Identity intersection only; counts and overlapping IDs do not establish semantic or shape accuracy.",
  };
}
