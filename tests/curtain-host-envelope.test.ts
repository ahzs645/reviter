import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {boundedNativeWallFootprints,nativeWallSolidPolygon} from '../lib/reviter/architectural-plan.ts';
import {nativeWalkingRegion,supportedWalkingPath} from '../lib/reviter/native-circulation-links.ts';
import type {ConvertResult,ElementBoundsRecord} from '../lib/reviter/types.ts';
import type {IndoorDataset} from '../lib/reviter/indoor-contract.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/unbc-curtain-host-extensions.json',import.meta.url),'utf8')) as {elementBounds:ElementBoundsRecord[]};
const z=3.2808398950131235;
const floor={elementId:1500982,categoryId:-2000032,boundsFeet:{min:{x:225,y:750,z:z-.5},max:{x:250,y:790,z}},loops:[[[225,750,z],[250,750,z],[250,790,z],[225,790,z]]]};
const model={elementBounds:[floor,...fixture.elementBounds],levels:[{levelId:1487816,elevation:z}],nativeAssociatedLevelRelations:[]} as unknown as ConvertResult;
const data={source:{modelSha256:'a'.repeat(64)},nativeLevels:[{id:1487816,name:'Native Floor 1',elevationFeet:z}],records:[],nodes:[],edges:[],doors:[],walls:[],alignment:{horizontalMetresPerFoot:.3048}} as unknown as IndoorDataset;
test('persisted curtain host extensions never become hallway material outside the native element envelope',()=>{
 const snapshot=JSON.stringify(model);const region=nativeWalkingRegion(model,data,z,true);
 assert.equal(supportedWalkingPath(region,[[231,766,z],[235,766,z]]),true,'real floor west of host1501178 remains clear');
 assert.equal(supportedWalkingPath(region,[[236.8,777,z],[236.8,779,z]]),true,'real floor north of host1501196 remains clear');
 assert.equal(supportedWalkingPath(region,[[238,766,z],[245,766,z]]),false,'entire remaining curtain envelope remains solid');
 assert.equal(supportedWalkingPath(region,[[236.8,771,z],[236.8,774,z]]),false,'remaining second host remains solid');
 assert.equal(JSON.stringify(model),snapshot,'native metadata remains unchanged');
});
test('only inconsistent curtain analytical proxies are clipped; regular walls and native join corners remain intact',()=>{
 for(const record of fixture.elementBounds){const solid=record.solid!,polygon=nativeWallSolidPolygon(solid);const clipped=boundedNativeWallFootprints(record,polygon);
  assert.ok(clipped.length);assert.ok(clipped.every(f=>f.approximate));assert.ok(clipped.flatMap(f=>f.polygon).every(([x,y])=>x>=record.boundsFeet.min.x-1e-8&&x<=record.boundsFeet.max.x+1e-8&&y>=record.boundsFeet.min.y-1e-8&&y<=record.boundsFeet.max.y+1e-8));
  const regular={...record,wallKind:'basic' as const};assert.deepEqual(boundedNativeWallFootprints(regular,polygon)[0]!.polygon,polygon);
  const sameExtent={...record,boundsFeet:{min:{x:Math.min(...polygon.map(p=>p[0])),y:Math.min(...polygon.map(p=>p[1])),z},max:{x:Math.max(...polygon.map(p=>p[0])),y:Math.max(...polygon.map(p=>p[1])),z:z+8}}};assert.deepEqual(boundedNativeWallFootprints(sameExtent,polygon)[0]!.polygon,polygon);
 }
});
test('native floor holes and public access restrictions still veto routes in the released hallway space',()=>{
 const path:[number,number,number][]=[[231,766,z],[235,766,z]];
 const holed={...model,elementBounds:[{...floor,loops:[...floor.loops,[[232,765,z],[234,765,z],[234,767,z],[232,767,z]]]},...fixture.elementBounds]} as ConvertResult;
 assert.equal(supportedWalkingPath(nativeWalkingRegion(holed,data,z,true),path),false);
 const staff={key:'staff',levelId:1487816,elevationFeet:z,walkable:true,circulation:true,access:'staff',properties:{},ringsFeet:[[[232,765],[234,765],[234,767],[232,767]]]} as IndoorDataset['records'][number];
 assert.equal(supportedWalkingPath(nativeWalkingRegion(model,{...data,records:[staff]},z,true),path),false);
});
