import {nativeRationalOverlay} from "./native-rational-overlay";
import pc from "polygon-clipping";
import type { IndoorDataset } from "./indoor-contract.ts";
import { preparedReviewedDoorApertures } from "./reviewed-door-apertures.ts";
/** Compose applied material with an independently checked aperture belonging to
 * that exact carrier. Full tagged recipes stay intact as historical evidence;
 * foreign walls, columns, and every unrelated repair keep their material. */
export function createNativeBoundaryMaterialQuery(data: IndoorDataset) {
  const apertures = data.nativeIndoorEnvelopes
    ? (preparedReviewedDoorApertures(data)?.patches ?? [])
    : [];
  return (wall: IndoorDataset["walls"][number]) => {
    if (!wall.reviewPatchId || wall.kind === "column") return [wall.ringsFeet];
    const cuts = apertures.filter(
      (p) =>
        p.levelId === wall.levelId &&
        p.wallEvidence.some((w) => w.nativeElementId === wall.nativeElementId),
    );
    return cuts.length
      ? pc.difference(wall.ringsFeet, ...cuts.map((p) => [p.apertureFeet]))
      : [wall.ringsFeet];
  };
}

/** Strict companion preserves rational own-aperture intersections between all
 * material operations. The existing numeric API remains legacy/display only. */
export function createNativeExactBoundaryMaterialQuery(data:IndoorDataset){
  const apertures=data.nativeIndoorEnvelopes?(preparedReviewedDoorApertures(data)?.patches??[]):[];
  return (wall:IndoorDataset["walls"][number])=>{
    const cuts=wall.reviewPatchId&&wall.kind!=="column"?apertures.filter(p=>p.levelId===wall.levelId&&p.wallEvidence.some(w=>w.nativeElementId===wall.nativeElementId)):[];
    return nativeRationalOverlay(cuts.length?"difference":"union",[wall.ringsFeet],...cuts.map(p=>[[p.apertureFeet]]));
  };
}
