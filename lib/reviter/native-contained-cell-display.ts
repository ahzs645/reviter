import {createNativeContainedDisplay,NATIVE_CONTAINED_DISPLAY_VERSION,type NativeContainedDisplay} from './native-contained-display';
import {nativeRationalOverlay,NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,rational,type NativeRationalParts} from './native-rational-overlay';
import type {NativeExactTopologyIndex} from './native-exact-planar-topology';
export type NativeContainedCellDisplay = Pick<NativeContainedDisplay,'partsFeet'|'certificate'|'faces'|'unchangedIEEEAnchorsFeet'> & {exactResidualFaceId?:string};
/** Drawing only. Neither numeric core nor residual substitutes the full face. */
export function prepareNativeContainedCellDisplay(id:string,parts:NativeRationalParts){
 const {partsFeet,certificate,faces,unchangedIEEEAnchorsFeet,exactResidualParts}=createNativeContainedDisplay(parts);
 const residual=exactResidualParts.length?{id:`${id}:render-residual`,parts:exactResidualParts}:undefined;
 const display:NativeContainedCellDisplay={partsFeet,certificate,faces,unchangedIEEEAnchorsFeet,...(residual?{exactResidualFaceId:residual.id}:{})};
 return {display,residual};
}
const only=(v:object,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
/** Call in import/geometry workers. Explicit raw difference proves every
 * positive omission is retained separately, and every drawn piece is inside. */
export function validateNativeContainedCellDisplay(value:NativeContainedCellDisplay,source:NativeRationalParts,residualIndex?:NativeExactTopologyIndex):void{
 const fail=()=>{throw Error('Invalid contained native cell drawing representation.');};
 const cert=value?.certificate;
 if(!value||!only(value,['partsFeet','certificate','faces','unchangedIEEEAnchorsFeet','exactResidualFaceId'])||!cert||!only(cert,['version','kernelVersion','renderOnly','exactDecompositionEqualsSource','numericOutsideSourceEmpty','completeExactAuthorityRetained','positiveResidualsRetained','originalIEEEAnchorsUnchanged','maximumGeneratedMovementFeet'])||cert.version!==NATIVE_CONTAINED_DISPLAY_VERSION||cert.kernelVersion!==NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION||!cert.renderOnly||!cert.exactDecompositionEqualsSource||!cert.numericOutsideSourceEmpty||!cert.completeExactAuthorityRetained||!cert.positiveResidualsRetained||!cert.originalIEEEAnchorsUnchanged||!Number.isFinite(cert.maximumGeneratedMovementFeet)||cert.maximumGeneratedMovementFeet<0||cert.maximumGeneratedMovementFeet>1e-7||!Array.isArray(value.partsFeet)||value.partsFeet.length>100_000)fail();
 let count=0;
 const point=(p:unknown)=>Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e7);
 if(value.partsFeet.some(part=>!Array.isArray(part)||!part.length||part.some(r=>!Array.isArray(r)||r.length<3||(count+=r.length)>2_000_000||r.some(p=>!point(p)))))fail();
 if(!Array.isArray(value.faces)||value.faces.length!==source.length||!Array.isArray(value.unchangedIEEEAnchorsFeet)||value.unchangedIEEEAnchorsFeet.length>500_000||value.unchangedIEEEAnchorsFeet.some(p=>!point(p)))fail();
 let numericStart=0,residualStart=0;
 for(const [i,f] of value.faces.entries()){
  if(!f||!only(f,['sourcePartIndex','exactCells','numericPieces','unrepresentablePositiveCells','exactResidualParts','numericPieceStartIndex','exactResidualStartIndex','unchangedIEEEAnchorsFeet'])||f.sourcePartIndex!==i||f.numericPieceStartIndex!==numericStart||f.exactResidualStartIndex!==residualStart||![f.exactCells,f.numericPieces,f.unrepresentablePositiveCells,f.exactResidualParts].every(n=>Number.isSafeInteger(n)&&n>=0)||!Array.isArray(f.unchangedIEEEAnchorsFeet)||f.unchangedIEEEAnchorsFeet.length>500_000||f.unchangedIEEEAnchorsFeet.some(p=>!point(p)))fail();
  numericStart+=f.numericPieces;residualStart+=f.exactResidualParts;
 }
 const residual=value.exactResidualFaceId?residualIndex?.parts(value.exactResidualFaceId):[];
 if(!residual||numericStart!==value.partsFeet.length||residualStart!==residual.length)fail();
 const core=nativeRationalOverlay('union',value.partsFeet);
 if(nativeRationalOverlay('difference',core,source).length||nativeRationalOverlay('xor',nativeRationalOverlay('difference',source,core),residual!).length)fail();
 const vertexKey=(p:readonly number[])=>{const x=rational(p[0]),y=rational(p[1]);return `${x.n}/${x.d},${y.n}/${y.d}`;};
 const exactVertices=new Set(source.flat(2).map(p=>`${p[0].n}/${p[0].d},${p[1].n}/${p[1].d}`));
 if(value.unchangedIEEEAnchorsFeet.some(p=>!exactVertices.has(vertexKey(p)))||value.faces.some(f=>f.unchangedIEEEAnchorsFeet.some(p=>!exactVertices.has(vertexKey(p)))))fail();
}
