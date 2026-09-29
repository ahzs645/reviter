import { readFileSync } from "node:fs";
import CFB from "cfb";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { inflateRevitChunk, gzipOffsets, stripRevitPageChecksums } from "../lib/reviter/revit-container.ts";
// Usage: node --experimental-strip-types scripts/probe-release-schema-drift.ts <2027-reference.rvt> <other.rvt>...
// Measured 2026-09-11 on the UNBC 2027 project against three Autodesk sample models (2024, 2025, 2025):
// all 57 hard-coded class markers/slots exist by name in every file and every one sits at a different index.
const args = process.argv.slice(2);
if (args.length < 2) { console.error("usage: probe-release-schema-drift.ts <reference-2027.rvt> <other.rvt>..."); process.exit(1); }
const files: Record<string,string> = Object.fromEntries(args.map((p, i) => [i === 0 ? "unbc2027" : `file${i}`, p]));
function loadSchema(p: string) {
  const cfb = CFB.read(readFileSync(p), { type: "buffer" });
  const i = cfb.FullPaths.findIndex((s) => /\/Formats\/Latest$/i.test(s));
  let data = new Uint8Array(cfb.FileIndex[i]!.content as ArrayLike<number>);
  // stream may be gzip-chunked like partitions
  if (data[0] === 0x1f && data[1] === 0x8b) { const s = stripRevitPageChecksums(data); const o = gzipOffsets(s); const parts: Uint8Array[] = []; for (let k = 0; k < o.length; k++) { const c = inflateRevitChunk(s, o[k]!, o[k+1]); if (c) parts.push(c); } const n = parts.reduce((a,b)=>a+b.length,0); data = new Uint8Array(n); let off=0; for (const c of parts){data.set(c,off); off+=c.length;} }
  const r = readSchema(data);
  if (!r.ok) throw new Error(`${p}: ${r.error} at ${r.offset}`);
  const byName = new Map<string, number>(); const byIndex = new Map<number, string>();
  for (const c of r.schema.classes) { byName.set(c.name, c.index); byIndex.set(c.index, c.name); }
  return { byName, byIndex, count: r.schema.classes.length, props: r.schema.propertyCount, classes: r.schema.classes };
}
const schemas: Record<string, ReturnType<typeof loadSchema>> = {};
for (const [k, p] of Object.entries(files)) { schemas[k] = loadSchema(p); console.log(k, "classes", schemas[k].count, "properties", schemas[k].props); }
const consts: [string, number][] = [
  ["BASIC_WALL_TYPE_MARKER",0x0270],["FAMILY_SYMBOL_MARKER",0x0810],["INSERTABLE_INSTANCE_MARKER",0x07ef],["MATERIAL_ELEMENT_MARKER",0x0ad3],
  ["FOOTPRINT_ROOF_MARKER",3392],["FLOOR_SKETCH_OWNER_MARKER",0x0869],["RAMP_SYMBOL_MARKER",3462],["BASE_RAILING_MARKER",598],["GEDGE_SLOT",1423],
  ["FILL_GRID_SLOT",2085],["GBI_FLIP_CONTROL_SLOT",2219],["GCYL_HELIX_SLOT",2244],["BASE_RAILING_SYMBOL_MARKER",605],["TOP_RAIL_TYPE_MARKER",967],
  ["RAILING_CURVE_LOOP_DATA_SLOT",3444],["CURVE_LOOP_SLOT",1087],["GFILTER_SLOT",2254],["LEVEL_MARKER",0x0a19],["FAMILY_MARKER",0x07d9],
  ["GINSTANCE/GARRAY_SLOT",2215],["INSTANCE_INFO_SLOT",2513],["GGROUP_SLOT",2248],["FACE_SLOT",1825],["HERMITE_SURFACE_SLOT",2414],["GARC_SLOT",2213],
  ["GCONDITION_INT_SLOT",2238],["GFILLING_SLOT",2253],["GHERMITE_SPLINE_SLOT",2259],["GPOLYLINE_SLOT",2276],["GELEMENT_SLOT/OBJECT_MARKER",2246],
  ["2026_GELEMENT_SLOT",2206],["2026_GREP_SLOT",2207],["STAIRS_ELEMENT_MARKER",4075],["STAIRS_LANDING_MARKER",4080],["STAIRS_RUN_MARKER",4102],
  ["CONTOUR_LABELING_MARKER",974],["GCONDITION_DIR_SLOT",2235],["GEOMETRY_SLOT",2343],["EDGE_LOOP_SLOT",1434],["GGTAG_SLOT",2256],["FILL_PATTERN_DATA_SLOT",2087],
  ["GPOINT_SLOT",2271],["GCONDITION_CUT_SLOT",2234],["GSTYLE_ELEMENT_MARKER",2292],["GSTYLE_SLOT",2288],["GLINE_SLOT",1973],["PLANE_SURFACE_SLOT",634],
  ["CONE_SURFACE_SLOT",900],["CYLINDER_SURFACE_SLOT",1144],["SURFACE_OF_REVOLUTION_SLOT",4283],["RULED_SURFACE_SLOT",3859],["DEFAULT_OBJECT_MARKER(0x08c6)",0x08c6],
  ["element-types 0x0c93",0x0c93],["element-types 0x116f",0x116f],["element-types 0x1104",0x1104],["cat-token discriminator 0x0383",0x0383],["cat frame 0x0604",0x0604],
];
const keys = Object.keys(files);
console.log("\nconstant (2027 value) -> class name in 2027 | index of that name in each file");
console.log("constant".padEnd(36), "2027idx".padEnd(8), "name".padEnd(32), keys.join("  "));
let same = 0, shifted = 0, missing = 0;
for (const [label, idx] of consts) {
  const name = schemas.unbc2027!.byIndex.get(idx) ?? "(no class at index)";
  const row = keys.map((k) => { const i = schemas[k]!.byName.get(name); return i == null ? "-" : String(i); });
  const others = row.slice(1).filter(x=>x!=="-"); if (name.startsWith("(")) {} else if (others.length<keys.length-1) missing++; else if (others.every(x=>x===String(idx))) same++; else shifted++;
  console.log(label.padEnd(36), String(idx).padEnd(8), name.padEnd(32), row.map(x=>x.padEnd(8)).join("  "));
}
console.log({ same, shifted, missing });
console.log("\n2025 category frame 0x05c7 =", keys.slice(1).map(k=>`${k}:${schemas[k]!.byIndex.get(0x05c7)}`).join(" "));
// class-set differences
const other = keys[1]!; const n27 = new Set(schemas.unbc2027!.byName.keys()), n25 = new Set(schemas[other]!.byName.keys()), n24 = new Set(schemas[keys[keys.length-1]!]!.byName.keys());
const only27 = [...n27].filter(x=>!n25.has(x)); const only25 = [...n25].filter(x=>!n27.has(x)); const only24v25=[...n24].filter(x=>!n25.has(x));
console.log(`\nclasses only in 2027 vs ${other}:`, only27.length, only27.slice(0,40).join(", "));
console.log(`classes only in ${other} vs 2027:`, only25.length, only25.slice(0,40).join(", "));
console.log(`classes only in last file vs ${other}:`, only24v25.length, only24v25.slice(0,20).join(", "));
// how many shared classes keep the same index between 2025 and 2027?
let sameIdx=0, tot=0; for (const [nm,i] of schemas[other]!.byName){ const j=schemas.unbc2027!.byName.get(nm); if (j!=null){tot++; if(i===j) sameIdx++;} }
console.log(`shared classes ${other}/2027:`, tot, "same index:", sameIdx);
if (keys.length > 2) { let s2=0,t2=0; for (const [nm,i] of schemas[keys[2]!]!.byName){ const j=schemas[other]!.byName.get(nm); if (j!=null){t2++; if(i===j) s2++;} }
console.log(`shared classes ${keys[2]}/${other}:`, t2, "same index:", s2); }
// field declaration comparison for key classes
function fieldsOf(s: ReturnType<typeof loadSchema> | undefined, name: string) { const c = s?.classes.find((x) => x.name === name); return c ? c.properties.map((f) => `${f.name}:${f.fieldType}`) : null; }
for (const nm of ["Element","MaterialElem","BasicWallType","GElement","GRep","Face","Level","InsertableInst","StairsRun","GStyleElem","FamilySymbol","BaseRailingSym"]) {
  const a = fieldsOf(schemas.unbc2027, nm), b = fieldsOf(schemas[other], nm), c = fieldsOf(schemas[keys[keys.length-1]!], nm);
  const eq = JSON.stringify(a) === JSON.stringify(b);
  console.log(`\n${nm}: 2027 fields=${a?.length} 2025 fields=${b?.length} 2024 fields=${c?.length} 2027==2025 ${eq}`);
  if (!eq && a && b) { console.log("  2027:", a.join(", ").slice(0,400)); console.log("  2025:", b.join(", ").slice(0,400)); }
}
