import test from 'node:test';
import assert from 'node:assert/strict';
import { createStableOwnershipMemo, createNativeWalkingOwnershipQuery } from '../lib/reviter/native-circulation-links.ts';
import { nativeRationalOverlay } from '../lib/reviter/native-rational-overlay.ts';
import type { IndoorDataset } from '../lib/reviter/indoor-contract.ts';

const rect = (x:number,y:number,w:number,h:number):[number,number][][] => [[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]];

test('a retention-priority collision never aliases full ownership keys', () => {
  const memo = createStableOwnershipMemo(2,2000);
  const a='owner-face:8oi:-8cuab2',b='owner-face:mze:-h0v2rq';
  memo.set(a,['staff']); memo.set(b,['public']);
  assert.equal(memo.get(a)!.priority,memo.get(b)!.priority);
  assert.deepEqual(memo.get(a)!.keys,['staff']);
  assert.deepEqual(memo.get(b)!.keys,['public']);
});

test('retained ownership payloads are copied, immutable and bounded including keys and owners', () => {
  const memo=createStableOwnershipMemo(2,2000),owners=['staff'];
  memo.set('a',owners); owners[0]='public';
  const entry=memo.get('a')!;
  assert.deepEqual(entry.keys,['staff']);
  assert.ok(Object.isFrozen(entry)); assert.ok(Object.isFrozen(entry.keys));
  assert.equal(Reflect.set(entry,'priority',0),false);
  memo.set('huge'.repeat(1000),['staff']); memo.set('small',['x'.repeat(1000)]);
  assert.equal(memo.get('huge'.repeat(1000)),undefined);
  assert.equal(memo.get('small'),undefined);
  assert.ok(memo.statistics().retainedBytes<=2000);
  assert.equal(memo.statistics().retainedBytes,512+2+40+10);
  const disabled=createStableOwnershipMemo(0,2000); disabled.set('a',['staff']);
  assert.equal(disabled.get('a'),undefined);
});

test('long repeated scans retain exact tiny restricted owners and positive holes without stale snapshot reuse', () => {
  const data={source:{modelSha256:'a'.repeat(64)},records:[
    {key:'public',ringsFeet:rect(0,0,10000,100),walkable:true,access:'public',properties:{}},
    {key:'tiny-staff',ringsFeet:rect(2,2,.00001,.00001),walkable:true,access:'staff',properties:{}},
    {key:'void',ringsFeet:rect(8,2,.00001,.00001),walkable:false,access:'off-limits',properties:{}}
  ]} as unknown as IndoorDataset;
  const query=createNativeWalkingOwnershipQuery(data);
  const faces=Array.from({length:811},(_,i)=>nativeRationalOverlay('union',[rect(i*3,0,3,10)]));
  const errors:unknown[]=[];
  for(let round=0;round<3;round++) for(let i=0;i<faces.length;i++) {
    const result=query(faces[i]!,[i*3,0,i*3+3,10],data.records,(_,e)=>errors.push(e));
    assert.equal(result.unresolved,false);
    assert.deepEqual(result.owners.map(r=>r.key),i===0?['public','tiny-staff']:i===2?['public','void']:['public']);
  }
  assert.equal(errors.length,0); assert.ok(query.statistics().hits>0);
  assert.ok(query.statistics().entries<=512);
  assert.ok(query.statistics().retainedBytes<=16*1024*1024);
  const changed={...data,records:data.records.map(r=>r.key==='tiny-staff'?{...r,ringsFeet:rect(20,2,.00001,.00001)}:r)};
  const fresh=createNativeWalkingOwnershipQuery(changed);
  assert.deepEqual(fresh(faces[0]!,[0,0,3,10],changed.records,(_,e)=>errors.push(e)).owners.map(r=>r.key),['public']);
  assert.equal(fresh.statistics().hits,0);
  const holed=nativeRationalOverlay('union',[[...rect(18,0,6,10),...rect(19,1,3,3)]]);
  assert.deepEqual(fresh(holed,[18,0,24,10],changed.records,(_,e)=>errors.push(e)).owners.map(r=>r.key),['public']);
  assert.equal(errors.length,0);
});
