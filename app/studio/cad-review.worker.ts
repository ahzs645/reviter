import template from '../../tools/dwg-analysis/building-geometry.html?raw';
import { cadFloorReviewDocument } from '../../lib/reviter/dwg-floor-analysis-view.ts';
import { readCadReviewPackage } from '../../lib/reviter/dwg-review-package.ts';
import { buildCadBuildingScenes } from '../../lib/reviter/dwg-building-scene.ts';
self.onmessage=async(event:MessageEvent<ArrayBuffer>)=>{
  try{const data=await readCadReviewPackage(new Uint8Array(event.data));
    self.postMessage({ok:true,document:cadFloorReviewDocument(template,data.geometry,data.analysis,data.paths,data.assumptions,data.surfaces,data.circulation),coverage:data.coverage,
      buildings:buildCadBuildingScenes(data.geometry,data.analysis,data.evidence,data.paths,data.assumptions,data.surfaces)});}
  catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'Unable to read CAD review ZIP.'});}
};
