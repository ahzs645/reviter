import {test} from 'node:test';import assert from 'node:assert/strict';
import {cadPointInRings,validateCadStairAssumptions,type CadStairAssumptions} from '../lib/reviter/dwg-stair-assumptions.ts';
test('assumptions need the same XY inside both original footprints and never grant access or native routes',()=>{
 const rings:[number,number][][]=[[[0,0],[5,0],[5,5],[0,5],[0,0]]];
 const geometry={sourceSha256:'s',floors:['a','b'].map(id=>({id,buildingCode:'B',stairAreas:[{id:'area-'+id,ringsMetres:rings}]}))};
 const analysis={geometrySha256:'g',floors:['a','b'].map(id=>({id,additionalTransform:{a:1,b:0,c:0,d:1,e:0,f:0}})),stairFamilies:[{buildingCode:'B',family:'stairs',occurrences:['a','b'].map(floorId=>({floorId,nearbyAreaIds:['area-'+floorId]}))}]};
 const v:CadStairAssumptions={format:'reviter-cad-stair-assumptions',version:1,sourceSha256:'s',geometrySha256:'g',userAssumed:true,routingEligible:false,graphEdges:[],connections:[{id:'c',buildingCode:'B',family:'stairs',fromFloorId:'a',toFloorId:'b',fromAreaId:'area-a',toAreaId:'area-b',fromPointMetres:[2,2],toPointMetres:[2,2],missingIntermediateOrdinals:[1],assumedContinuous:true,servedStopsVerified:false,physicalElevations:null,reason:'user assumption'}],unresolved:[]};
 assert.equal(validateCadStairAssumptions(v,geometry,analysis),v);v.connections[0]!.toPointMetres=[3,2];assert.throws(()=>validateCadStairAssumptions(v,geometry,analysis),/original source/);v.connections[0]!.toPointMetres=[6,2];assert.throws(()=>validateCadStairAssumptions(v,geometry,analysis),/original source/);
});
test('a real source opening is excluded even when contained by the outer stair outline',()=>{assert.equal(cadPointInRings([2,2],[[[0,0],[5,0],[5,5],[0,5],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]),false);});
