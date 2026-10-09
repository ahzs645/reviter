import {deserialize} from 'node:v8';
import {initializeNativeExactGeosOverlay} from '../../lib/reviter/native-exact-geos-overlay.ts';
import {prepareNativeCirculationPlaneDraft} from '../../lib/reviter/native-circulation-geometry.ts';
import type {IndoorDataset} from '../../lib/reviter/indoor-contract.ts';
import type {ConvertResult} from '../../lib/reviter/types.ts';
import {strictJson,type CheckpointWorkerContext,type JsonValue} from './bounded-worker-checkpoints.ts';
export async function initialize(context:CheckpointWorkerContext){
 const model=deserialize(await context.readVerifiedInput('native-model')) as ConvertResult;
 const data=deserialize(await context.readVerifiedInput('native-dataset')) as IndoorDataset;
 await initializeNativeExactGeosOverlay();
 return {model,data};
}
export function runTask(input:JsonValue,state:Awaited<ReturnType<typeof initialize>>):JsonValue {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||typeof input.elevationFeet!=='number')throw Error('Invalid native plane task');
 const draft=prepareNativeCirculationPlaneDraft(state.model,state.data,input.elevationFeet);
 // This API already encodes exact values in lossless rational topology.
 // Native numeric presentation follows the existing JSON wire format (-0 is
 // canonically 0); class instances/BigInts must never enter this carrier.
 const carrier=nativePlaneJsonCarrier(draft);
 strictJson(carrier);
 return carrier;
}
/** Normalize the existing presentation JSON convention explicitly, without
 * invoking toJSON/accessors or silently losing unsupported exact values. */
export function nativePlaneJsonCarrier(value:unknown,ancestors=new Set<object>()):JsonValue {
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Nonfinite native plane carrier');return Object.is(value,-0)?0:value;}
 if(typeof value!=='object'||ancestors.has(value))throw Error('Unsupported or cyclic native plane carrier');
 ancestors.add(value);
 try{
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw Error('Native plane carrier requires plain objects');
  if(Object.getOwnPropertyDescriptor(Object.prototype,'toJSON')||(array&&Object.getOwnPropertyDescriptor(Array.prototype,'toJSON')))throw Error('Native plane carrier cannot inherit toJSON');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value);
  if(keys.some(k=>typeof k!=='string'||k==='toJSON'))throw Error('Unsupported native plane property');
  if(array){
   if(keys.some(k=>k!=='length'&&(typeof k!=='string'||String(Number(k))!==k||!Number.isInteger(Number(k))||Number(k)<0||Number(k)>=value.length)))throw Error('Unexpected native plane array property');
   const result:JsonValue[]=[];
   for(let i=0;i<value.length;i++){const d=descriptors[i];if(!d||!d.enumerable||!('value'in d))throw Error('Sparse/accessor native plane array');result.push(nativePlaneJsonCarrier(d.value,ancestors));}
   return result;
  }
  const result:Record<string,JsonValue>=Object.create(null);
  for(const k of keys as string[]){const d=descriptors[k]!;if(!d.enumerable||!('value'in d))throw Error('Native plane carrier cannot contain accessors');result[k]=nativePlaneJsonCarrier(d.value,ancestors);}
  return result;
 }finally{ancestors.delete(value);}
}
