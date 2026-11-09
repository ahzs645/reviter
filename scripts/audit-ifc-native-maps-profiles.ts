#!/usr/bin/env node
/** Local-only source model validation. Outputs statistics and digests, no RVT
 * bytes or section geometry are published. Source/reference files stay private. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { IfcAPI, IFCMAPPEDITEM, IFCREPRESENTATIONMAP, IFCMATERIALPROFILESETUSAGE, IFCISHAPEPROFILEDEF, IFCRELASSOCIATESMATERIAL } from "web-ifc";
import { IfcParser } from "@ifc-lite/parser";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { enrichConvertResultWithStandardsReader, type RvtWasmModule } from "../lib/reviter/standards-reader.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { planNativeMaterialProfiles } from "../lib/reviter/export-ifc-material-profiles.ts";
import { basename } from "node:path";
const [path, output] = process.argv.slice(2); if (!path || !output) throw new Error("Usage: audit-ifc-native-maps-profiles.ts model.rvt report.json");
const input = new Uint8Array(readFileSync(path)); const result = await convertRvtBytes(input, basename(path));
if (!result.ok) throw new Error(result.error);
await enrichConvertResultWithStandardsReader(result, input, async () => {
  const wasm = await import("../lib/rvt-wasm/rvt.js");
  await wasm.default({ module_or_path: readFileSync(new URL("../lib/rvt-wasm/rvt_bg.wasm", import.meta.url)) });
  return wasm as unknown as RvtWasmModule;
});
const profiles = planNativeMaterialProfiles(result);
const ordinary = makeIfc(result), mapped = makeIfc(result, { reuseMappedGeometry: true });
const unprofiled = makeIfc({ ...result, nativeStructuralSections: [] });
const api = new IfcAPI(); await api.Init();
const one = api.OpenModel(new TextEncoder().encode(ordinary), { COORDINATE_TO_ORIGIN: false });
const two = api.OpenModel(new TextEncoder().encode(mapped), { COORDINATE_TO_ORIGIN: false });
const three = api.OpenModel(new TextEncoder().encode(unprofiled), { COORDINATE_TO_ORIGIN: false });
type Part = { color: string; faces: number[][] };
function compareVector(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 1e-9) return a[i]! - b[i]!;
  return 0;
}
function geometry(model: number, express: number): Part[] {
  const mesh = api.GetFlatMesh(model, express); const parts: Part[] = [];
  for (let g = 0; g < mesh.geometries.size(); g++) {
    const placed = mesh.geometries.get(g), matrix = placed.flatTransformation;
    const geom = api.GetGeometry(model, placed.geometryExpressID), vertices = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize()), indices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
    const point = (index: number) => {
      const x = vertices[index * 6]!, y = vertices[index * 6 + 1]!, z = vertices[index * 6 + 2]!;
      return [matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!, matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!, matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!];
    };
    const faces: number[][] = []; for (let i = 0; i < indices.length; i += 3) faces.push([point(indices[i]!), point(indices[i+1]!), point(indices[i+2]!)].sort(compareVector).flat());
    parts.push({ color: JSON.stringify(placed.color), faces: faces.sort(compareVector) }); geom.delete();
  }
  return parts.sort((a, b) => a.color.localeCompare(b.color) || a.faces.length - b.faces.length || compareVector(a.faces[0] ?? [], b.faces[0] ?? []));
}
function compareGeometry(left: Part[], right: Part[]): { equal: boolean; maxCoordinateDifferenceMetres: number } {
  if (left.length !== right.length) return { equal: false, maxCoordinateDifferenceMetres: Infinity };
  let max = 0;
  for (let p = 0; p < left.length; p++) {
    const a = left[p]!, b = right[p]!;
    if (a.color !== b.color || a.faces.length !== b.faces.length) return { equal: false, maxCoordinateDifferenceMetres: Infinity };
    for (let f = 0; f < a.faces.length; f++) for (let c = 0; c < 9; c++) max = Math.max(max, Math.abs(a.faces[f]![c]! - b.faces[f]![c]!));
  }
  return { equal: max <= 1e-6, maxCoordinateDifferenceMetres: max };
}
// IFC attributes retain double precision independently of web-ifc's Float32
// render geometry cache. Compare these too, so cache recentering cannot hide
// an actual mapping placement error or produce a false geometry failure.
const valueOf = (value: number | { value: number }): number => typeof value === "number" ? value : value.value;
function rawGeometry(model: number, express: number): Part[] {
  const product = api.GetLine(model, express), shape = api.GetLine(model, product.Representation.value); const parts: Part[] = [];
  const append = (representation: { Items: Array<{ value: number }> }, transform: (p: number[]) => number[]) => {
    for (const ref of representation.Items) {
      const faceSet = api.GetLine(model, ref.value), coordinates = api.GetLine(model, faceSet.Coordinates.value);
      const points = coordinates.CoordList.map((row: Array<number | { value: number }>) => transform(row.map(valueOf)));
      const faces = faceSet.CoordIndex.map((row: Array<number | { value: number }>) => row.map(valueOf).map((index: number) => points[index - 1]).sort(compareVector).flat());
      parts.push({ color: "raw-ordered-fragment", faces: faces.sort(compareVector) });
    }
  };
  for (const ref of shape.Representations) {
    const representation = api.GetLine(model, ref.value);
    if (representation.RepresentationIdentifier?.value !== "Body") continue;
    if (representation.RepresentationType?.value !== "MappedRepresentation") { append(representation, p => p); continue; }
    for (const mappedRef of representation.Items) {
      const mapped = api.GetLine(model, mappedRef.value), map = api.GetLine(model, mapped.MappingSource.value), operator = api.GetLine(model, mapped.MappingTarget.value);
      const origin = api.GetLine(model, map.MappingOrigin.value), originPoint = api.GetLine(model, origin.Location.value);
      if (origin.Axis || origin.RefDirection || originPoint.Coordinates.some((v: number | { value: number }) => valueOf(v) !== 0)) throw new Error("Audit expects writer's identity map origin");
      const axes = [operator.Axis1, operator.Axis2, operator.Axis3].map((axis, index) => {
        const vector = axis ? api.GetLine(model, axis.value).DirectionRatios.map(valueOf) : [0, 1, 2].map(n => n === index ? 1 : 0);
        const length = Math.hypot(...vector); return vector.map((value: number) => value / length);
      });
      const offset = api.GetLine(model, operator.LocalOrigin.value).Coordinates.map(valueOf), scale = operator.Scale ? valueOf(operator.Scale) : 1;
      append(api.GetLine(model, map.MappedRepresentation.value), p => [0, 1, 2].map(axis => offset[axis] + scale * (axes[0][axis] * p[0]! + axes[1][axis] * p[1]! + axes[2][axis] * p[2]!)));
    }
  }
  return parts.sort((a, b) => a.faces.length - b.faces.length || compareVector(a.faces[0] ?? [], b.faces[0] ?? []));
}
const products = (source: string) => [...source.matchAll(/^#(\d+)=(IFC[A-Z]+)\((.*)\);$/gm)].filter(match => /,#[0-9]+,#[0-9]+,'[0-9]+'/.test(match[3]!)).map(match => ({ express: Number(match[1]), tag: /,'([0-9]+)'/.exec(match[3]!.slice(match[3]!.lastIndexOf(",#")))?.[1] ?? null }));
// Resolve products directly through the reader rather than guessing Tag arity.
function roots(source: string, model: number) {
  const map = new Map<number, number>();
  for (const product of products(source)) { const line = api.GetLine(model, product.express); const tag = Number(line.Tag?.value); if (Number.isSafeInteger(tag) && line.ObjectPlacement && line.Representation) map.set(tag, product.express); } return map;
}
const left = roots(ordinary, one), right = roots(mapped, two), withoutProfiles = roots(unprofiled, three);
let mappedProducts = 0, compared = 0, maxCoordinateDifferenceMetres = 0, maxAttributeCoordinateDifferenceMetres = 0; const mismatches: number[] = [];
const mismatchDetails: Array<{ elementId: number; maxCoordinateDifferenceMetres: number }> = [];
for (const [tag, express] of right) {
  const line = api.GetLine(two, express), shape = api.GetLine(two, line.Representation.value);
  const reps = shape.Representations ?? [];
  if (!reps.some((ref: { value: number }) => api.GetLine(two, ref.value).RepresentationType?.value === "MappedRepresentation")) continue;
  mappedProducts++;
  const original = left.get(tag); if (original === undefined) throw new Error(`Missing ordinary product ${tag}`);
  compared++;
  const attributes = compareGeometry(rawGeometry(one, original), rawGeometry(two, express));
  maxAttributeCoordinateDifferenceMetres = Math.max(maxAttributeCoordinateDifferenceMetres, attributes.maxCoordinateDifferenceMetres);
  const comparison = compareGeometry(geometry(one, original), geometry(two, express));
  maxCoordinateDifferenceMetres = Math.max(maxCoordinateDifferenceMetres, comparison.maxCoordinateDifferenceMetres);
  // The preview reader caches Float32 vertices around a geometry-specific
  // centre. Its resulting rounding differs between ordinary and mapped bodies.
  // Keep a separately reported 10um preview gate AND a 1nm double-attribute
  // gate. The latter catches real map errors independently of render rounding.
  if (attributes.maxCoordinateDifferenceMetres > 1e-9 || comparison.maxCoordinateDifferenceMetres > 1e-5) {
    mismatches.push(tag); mismatchDetails.push({ elementId: tag, maxCoordinateDifferenceMetres: comparison.maxCoordinateDifferenceMetres });
  }
}
let profileBodyCompared = 0, maxProfileBodyCoordinateDifferenceMetres = 0; const profileBodyMismatches: number[] = [];
for (const plan of profiles) {
  const profiled = left.get(plan.elementId), original = withoutProfiles.get(plan.elementId);
  if (profiled === undefined || original === undefined) continue;
  const comparison = compareGeometry(geometry(one, profiled), geometry(three, original)); profileBodyCompared++;
  maxProfileBodyCoordinateDifferenceMetres = Math.max(maxProfileBodyCoordinateDifferenceMetres, comparison.maxCoordinateDifferenceMetres);
  if (comparison.maxCoordinateDifferenceMetres > 1e-9) profileBodyMismatches.push(plan.elementId);
}
const basesByMap = new Map<number, Set<string>>();
const mappedIds = api.GetLineIDsWithType(two, IFCMAPPEDITEM);
for (let i = 0; i < mappedIds.size(); i++) {
  const item = api.GetLine(two, mappedIds.get(i)), operator = api.GetLine(two, item.MappingTarget.value);
  const axes = [operator.Axis1, operator.Axis2, operator.Axis3].map((axis, index) => axis ? api.GetLine(two, axis.value).DirectionRatios.map((value: { value: number }) => Number(value.value.toPrecision(12))) : [0, 1, 2].map(n => n === index ? 1 : 0));
  const bases = basesByMap.get(item.MappingSource.value) ?? new Set<string>(); bases.add(JSON.stringify(axes)); basesByMap.set(item.MappingSource.value, bases);
}
const mapsWithDifferentRotations = [...basesByMap.values()].filter(bases => bases.size > 1).length;
const mapCount = api.GetLineIDsWithType(two, IFCREPRESENTATIONMAP).size();
const sourceProfileDimensions = profiles.map(plan => ({ elementId: plan.elementId, typeId: plan.section.typeId, materialId: plan.materialId, shapeOwnerElementId: plan.section.shapeOwnerElementId, shapeResolution: plan.section.shapeResolution, shapeFamilyRelation: plan.section.shapeFamilyRelation, shapeWitnesses: plan.section.shapeWitnesses, widthMetres: plan.section.widthFeet * .3048, depthMetres: plan.section.depthFeet * .3048, webMetres: plan.section.webFeet * .3048, flangeMetres: plan.section.flangeFeet * .3048 }));
let profileOwnersCompared = 0; const profileMismatches: number[] = [];
const plansByElement = new Map(profiles.map(plan => [plan.elementId, plan]));
const associationIds = api.GetLineIDsWithType(two, IFCRELASSOCIATESMATERIAL);
for (let i = 0; i < associationIds.size(); i++) {
  const relation = api.GetLine(two, associationIds.get(i)), usage = api.GetLine(two, relation.RelatingMaterial.value);
  if (usage.type !== IFCMATERIALPROFILESETUSAGE) continue;
  const set = api.GetLine(two, usage.ForProfileSet.value);
  const materialProfile = api.GetLine(two, set.MaterialProfiles[0].value), section = api.GetLine(two, materialProfile.Profile.value);
  const material = materialProfile.Material ? api.GetLine(two, materialProfile.Material.value) : null;
  for (const ref of relation.RelatedObjects) {
    const owner = api.GetLine(two, ref.value), elementId = Number(owner.Tag?.value), plan = plansByElement.get(elementId);
    if (!plan) throw new Error(`Profile usage owner lacks source plan: ${elementId}`);
    profileOwnersCompared++;
    const expected = [plan.section.widthFeet, plan.section.depthFeet, plan.section.webFeet, plan.section.flangeFeet].map(value => value * .3048);
    const actual = [section.OverallWidth.value, section.OverallDepth.value, section.WebThickness.value, section.FlangeThickness.value];
    const name = result.nativeMaterialDefinitions?.find(definition => definition.elementId === plan.materialId)?.name;
    if (actual.some((value: number, index: number) => Math.abs(value - expected[index]!) > 1e-10) || material?.Name?.value !== name || usage.CardinalPoint !== null || usage.ReferenceExtent !== null) profileMismatches.push(elementId);
  }
}
const parsed = await new IfcParser().parseColumnar(new TextEncoder().encode(mapped).buffer);
const report = { fileName: basename(path), sourceSha256: createHash("sha256").update(input).digest("hex"), nativePlacements: result.nativeInstancePlacements?.length ?? 0, nativeSections: result.nativeStructuralSections?.length ?? 0, shapeResolvedSections: result.nativeStructuralSections?.filter(section => section.shape === "symmetric-I").length ?? 0, profileCandidates: profiles.length, emittedProfiles: api.GetLineIDsWithType(two, IFCISHAPEPROFILEDEF).size(), profileUsages: api.GetLineIDsWithType(two, IFCMATERIALPROFILESETUSAGE).size(), materialAssociations: api.GetLineIDsWithType(two, IFCRELASSOCIATESMATERIAL).size(), sourceProfileDimensions, profileOwnersCompared, profileMismatches, profileBodyCompared, profileBodyMismatches, maxProfileBodyCoordinateDifferenceMetres, representationMaps: mapCount, mapsWithDifferentRotations, mappedItems: api.GetLineIDsWithType(two, IFCMAPPEDITEM).size(), mappedProducts, compared, mismatches, mismatchDetails, maxCoordinateDifferenceMetres, maxAttributeCoordinateDifferenceMetres, ordinaryIfcBytes: Buffer.byteLength(ordinary), mappedIfcBytes: Buffer.byteLength(mapped), reader: "web-ifc 0.0.77 double-attribute world triangles(1nm gate) and Float32preview triangles+materials(10um gate), actualmaximumdifferences reported; IFC-Lite schema/entity parse", independentSchema: parsed.schemaVersion, limitations: ["Mapping validates unchanged mesh placement, not source-model geometry equivalence.", "Material profile associations retain measured type section parameters; body tessellation remains unchanged.", "No missing profile or cardinal point is synthesized."] };
api.CloseModel(one); api.CloseModel(two); api.CloseModel(three); api.Dispose(); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ maps: mapCount, mappedProducts, compared, mismatches: mismatches.length, profiles: report.emittedProfiles, output })); if (mismatches.length || profileMismatches.length || profileBodyMismatches.length) process.exitCode = 1;
