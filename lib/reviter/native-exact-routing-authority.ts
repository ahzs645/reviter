import type {IndoorDataset} from './indoor-contract';
import {createNativeRoutingMaterialQuery} from './native-routing-material';
import {createNativeExactBoundaryMaterialQuery} from './native-boundary-material';
import {createNativeIndoorEnvelopeIndex} from './native-indoor-envelopes';
import {indoorExclusionParts} from './indoor-exclusions';
import {nativeRationalOverlay,type NativeRationalParts} from './native-rational-overlay';
import {freezeNativeRationalParts} from './native-exact-planar-topology';
import {nativeAuthoredStairTreads} from './native-authored-stair-treads';
/** Recheck current original physical facts independently of a prepared face's
 * declared checksum. This is operation-local; no mutable dataset is cached. */
export function createNativeExactRoutingAuthority(data:IndoorDataset){
 const materialQuery=createNativeRoutingMaterialQuery(data),boundaryQuery=createNativeExactBoundaryMaterialQuery(data),envelopes=createNativeIndoorEnvelopeIndex(data.nativeIndoorEnvelopes,data.source.modelSha256);
 const authored=nativeAuthoredStairTreads(data.nativeSourceStairMaterials?.authoredTreadRoles,data.source.modelSha256);
 const treads=[...authored.values()].flat();
 // Unrecovered native cache inventory remains a conservative physical veto,
 // matching the compiler. It never certifies a walking surface or full flight.
 if(data.stairDisplay?.sourceModelSha256===data.source.modelSha256)
  for(const f of data.stairDisplay.sourceFlights??[])for(const t of f.treads)if(!authored.has(t.runElementId))treads.push(t);
 const levels=new Map<number,NativeRationalParts>();
 return (z:number):NativeRationalParts=>{
  const saved=levels.get(z);if(saved)return saved;
  if(!data.nativeIndoorEnvelopes||data.walkingSupport?.sourceModelSha256!==data.source.modelSha256)return [];
  const floors=data.walkingSupport.floors.filter(f=>Math.abs(f.elevationFeet-z)<.05).flatMap(f=>f.partsFeet??[f.ringsFeet]);
  const envelope=envelopes.parts(z);
  // Empty flat support cannot admit a cell. No material obstacle is waived:
  // ramp/body certification uses its separate physical barrier query.
  const support=floors.length&&envelope.length?nativeRationalOverlay('intersection',floors,envelope):[];
  if(!support.length){const empty=freezeNativeRationalParts([]);levels.set(z,empty);return empty;}
  const material=materialQuery(z),ids=new Set(data.nativeLevels.filter(l=>Math.abs(l.elevationFeet-z)<.05).map(l=>l.id));
  const masks=[
   ...(material.derivedParts??[]),...material.parts.map(p=>p.rings),
   ...data.walls.filter(w=>ids.has(w.levelId)&&(!material.known.has(w.nativeElementId)||(w.reviewPatchId&&material.present.has(w.nativeElementId)))).flatMap(w=>boundaryQuery(w)),
   ...(data.circulationGeometry?.fixtures??[]).filter(f=>Math.abs(f.elevationFeet-z)<.05).map(f=>f.ringsFeet),
   // Qualified positive roles replace the current native cache mask. Explicit
   // reference faces and historicalPreparedTreads never supply this veto.
   ...treads.filter(t=>t.elevationFeet>z+.05&&t.elevationFeet<z+6).map(t=>[t.ringFeet]),
   ...indoorExclusionParts(data,z),
   ...(data.doors??[]).filter(d=>ids.has(d.levelId)&&d.footprintFeet).map(d=>[d.footprintFeet!]),
  ];
  const free=freezeNativeRationalParts(nativeRationalOverlay('difference',support,masks));
  levels.set(z,free);return free;
 };
}
