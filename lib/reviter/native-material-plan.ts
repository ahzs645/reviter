import { nativeRationalOverlay, type NativeRationalParts } from "./native-rational-overlay";
import { nativeExactPartsForProposals } from "./native-exact-planar-topology";
import pc from "polygon-clipping";
import type { IndoorDataset } from "./indoor-contract.ts";
import { createNativeRoutingMaterialQuery } from "./native-routing-material.ts";
import { validateReviewedDoorApertures, preparedReviewedDoorApertures } from "./reviewed-door-apertures.ts";
/** Source analytical material only; original prepared jambs stay unchanged for
 * correction binding. The explicit source aperture is checked separately by
 * the compiler before this exact original-material composition is used. */
export function nativeMaterialPlanWalls(
  data: IndoorDataset,
  levelId: number,
  doorCuts?: unknown,
  cutOffset = 4,
): IndoorDataset["walls"] {
  const original = data.walls.filter((w) => w.levelId === levelId),
    level = data.nativeLevels.find((l) => l.id === levelId);
  if (!level || !data.nativeMaterialSections) return original;
  validateReviewedDoorApertures(doorCuts, data.source.modelSha256);
  const material = createNativeRoutingMaterialQuery(data)(
    level.elevationFeet,
    level.elevationFeet + cutOffset,
  );
  const cuts = new Map<number, [number, number][][]>();
  for (const patch of doorCuts?.patches ?? [])
    if (patch.levelId === levelId)
      for (const wall of patch.wallEvidence) {
        const existing = cuts.get(wall.nativeElementId) ?? [];
        existing.push(patch.apertureFeet);
        cuts.set(wall.nativeElementId, existing);
      }
  const recovered = material.parts.flatMap((part) => {
    const apertures = cuts.get(part.nativeElementId) ?? [];
    const parts = apertures.length
      ? (pc.difference(part.rings, ...apertures.map((p) => [p])) as [
          number,
          number,
        ][][][])
      : [part.rings];
    return parts.map((ringsFeet) => ({
      levelId,
      nativeElementId: part.nativeElementId,
      kind: part.column ? ("column" as const) : ("wall" as const),
      geometrySource: part.positiveSubsetOnly
        ? "original-native-positive-material-subset"
        : "original-native-material-section",
      ringsFeet,
    }));
  });
  const derived = (data.nativeDerivedFrameReturns?.rows ?? [])
    .filter(
      (r) =>
        !r.sourceFloorOuterContext &&
        r.levelId === levelId &&
        r.baseElevationFeet <= level.elevationFeet + cutOffset &&
        r.topElevationFeet > level.elevationFeet + cutOffset,
    )
    .flatMap((r) =>
      r.partsFeet.map((ringsFeet) => ({
        levelId,
        nativeElementId: r.sourceNativeElementId,
        kind: "wall" as const,
        geometrySource: "derived-native-frame-return",
        reviewPatchId: r.id,
        ringsFeet,
      })),
    );
  const provisional = (data.nativeProvisionalCornerSeals?.rows ?? [])
    .filter(
      (r) =>
        !r.sourceFloorOuterContext &&
        !r.materialRole &&
        r.state === "applied" &&
        r.baseElevationFeet <= level.elevationFeet + cutOffset &&
        r.topElevationFeet > level.elevationFeet + cutOffset,
    )
    .flatMap((r, i) =>
      r.partsFeet.map((ringsFeet) => ({
        levelId,
        nativeElementId: -700000000 - i,
        kind: "wall" as const,
        geometrySource: "provisional-native-corner-seal",
        reviewPatchId: r.id,
        ringsFeet,
      })),
    );
  return [
    ...provisional,
    ...derived,
    ...original
      .filter(
        (w) =>
          (w.reviewPatchId &&
            (!material.known.has(w.nativeElementId) ||
              material.present.has(w.nativeElementId))) ||
          !material.known.has(w.nativeElementId),
      )
      .flatMap((w) => {
        const apertures = w.reviewPatchId
          ? (cuts.get(w.nativeElementId) ?? [])
          : [];
        return apertures.length
          ? (
              pc.difference(w.ringsFeet, ...apertures.map((p) => [p])) as [
                number,
                number,
              ][][][]
            ).map((ringsFeet) => ({ ...w, ringsFeet }))
          : [w];
      }),
    ...recovered,
  ];
}
/** Strict selection retains exact aperture intersections. Numeric wall copies
 * are proposal/evidence buffers and never supply subsequent floor Booleans. */
export function nativeMaterialPlanExactWalls(data:IndoorDataset,levelId:number,query:ReturnType<typeof createNativeRoutingMaterialQuery>,cutElevationFeet?:number): (IndoorDataset["walls"][number] & {exactParts:NativeRationalParts})[] {
  const level=data.nativeLevels.find(l=>l.id===levelId);
  if(!level||!data.nativeMaterialSections)throw new Error("Exact native wall selection needs bound original material.");
  const cut=cutElevationFeet??level.elevationFeet+4;
  const material=query(level.elevationFeet,cut);
  const apertures=preparedReviewedDoorApertures(data)?.patches.filter(p=>p.levelId===levelId)??[];
  const original=data.walls.filter(w=>w.levelId===levelId);
  const copied: (IndoorDataset["walls"][number] & {parts:[number,number][][][];cutOwnApertures:boolean})[]=[
    ...material.parts.map(section=>({levelId,nativeElementId:section.nativeElementId,kind:section.column?"column" as const:"wall" as const,geometrySource:section.positiveSubsetOnly?"original-native-positive-material-subset":"original-native-material-section",ringsFeet:section.rings,parts:[section.rings],cutOwnApertures:true})),
    ...original.filter(w=>(w.reviewPatchId&&(!material.known.has(w.nativeElementId)||material.present.has(w.nativeElementId)))||!material.known.has(w.nativeElementId)).map(w=>({...w,parts:[w.ringsFeet],cutOwnApertures:!!w.reviewPatchId})),
    ...(data.nativeDerivedFrameReturns?.rows??[]).filter(r=>!r.sourceFloorOuterContext&&r.levelId===levelId&&r.baseElevationFeet<=cut&&r.topElevationFeet>cut).flatMap(r=>r.partsFeet.map(ringsFeet=>({levelId,nativeElementId:r.sourceNativeElementId,kind:"wall" as const,geometrySource:"derived-native-frame-return",reviewPatchId:r.id,ringsFeet,parts:[ringsFeet],cutOwnApertures:false}))),
    ...(data.nativeProvisionalCornerSeals?.rows??[]).filter(r=>!r.sourceFloorOuterContext&&!r.materialRole&&r.state==="applied"&&r.baseElevationFeet<=cut&&r.topElevationFeet>cut).flatMap((r,i)=>r.partsFeet.map(ringsFeet=>({levelId,nativeElementId:-700000000-i,kind:"wall" as const,geometrySource:"provisional-native-corner-seal",reviewPatchId:r.id,ringsFeet,parts:[ringsFeet],cutOwnApertures:false}))),
  ];
  return copied.flatMap(({parts,cutOwnApertures,...wall})=>{
    const cuts=cutOwnApertures?apertures.filter(p=>p.wallEvidence.some(e=>e.nativeElementId===wall.nativeElementId)):[];
    const exactParts=nativeRationalOverlay(cuts.length?"difference":"union",parts,...cuts.map(p=>[[p.apertureFeet]]));
    return exactParts.map(part=>({...wall,ringsFeet:nativeExactPartsForProposals([part])[0],exactParts:[part]}));
  });
}
