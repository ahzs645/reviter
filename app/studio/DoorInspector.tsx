"use client";
import type{DoorReview}from '../../lib/reviter/directory-navigation.ts';
import type{DirectoryRoom}from '../../lib/reviter/room-directory.ts';
import type{ElementBoundsRecord}from '../../lib/reviter/types.ts';
export function DoorInspector({review,record,hostId,levelId,rooms,onClose,onFocus,onReview,onChoose}:{review:DoorReview;record?:ElementBoundsRecord;hostId?:number;levelId:number|null;rooms:readonly DirectoryRoom[];onClose:()=>void;onFocus:()=>void;onReview:()=>void;onChoose:(r:DirectoryRoom)=>void}){
  const {door,portal}=review;
  return <section className="directory-door-inspector" aria-label="Selected door information"><div className="directory-inspector-heading"><strong>Selected door · #{door.id}</strong><button className="rv-button" onClick={onClose} aria-label="Close door information">×</button></div>
    <dl className="directory-area-facts"><div><dt>Connection</dt><dd>{portal?portal.reviewed?'Reviewed doorway link':'Recovered doorway link':review.state==='ambiguous'?'Ambiguous room match':'Missing room match'}</dd></div><div><dt>Level</dt><dd>#{levelId}</dd></div><div><dt>Family / type</dt><dd>{[record?.familyName,record?.typeName].filter(Boolean).join(' · ')||'Not decoded'}</dd></div><div><dt>Host wall ID</dt><dd>{hostId??'Not decoded'}</dd></div><div><dt>Model location</dt><dd>X {door.point[0].toFixed(2)} · Y {door.point[1].toFixed(2)} ft</dd></div><div><dt>Opening bounds</dt><dd>{(door.halfWidth*2).toFixed(2)} × {(door.halfHeight*2).toFixed(2)} ft in plan · {door.footprint?'oriented footprint':'approximate'}</dd></div></dl>
    <p>{portal?'Joins':'Candidate spaces'}:</p><div className="directory-area-chips">{(portal?.rooms??review.candidates).map(k=>{const r=rooms.find(r=>r.key===k);return r&&<button key={k} onClick={()=>onChoose(r)}>{r.number} · {r.name}</button>;})}</div>
    {portal&&review.candidates.some(k=>!portal.rooms.includes(k))&&<><p>Other nearby source boundaries:</p><div className="directory-area-chips">{review.candidates.filter(k=>!portal.rooms.includes(k)).map(k=>{const r=rooms.find(r=>r.key===k);return r&&<button key={k} onClick={()=>onChoose(r)}>{r.number} · {r.name}</button>;})}</div><p>Review the matched sides if this opening should connect a different space.</p></>}
    {!portal&&<p>The opening needs a room/boundary match before it can establish a route.</p>}
    <p>Current door position is unknown.</p>
    <div className="directory-area-chips"><button onClick={onFocus}>Focus door</button><button onClick={onReview}>Review door connection</button></div>
    {!!record?.parameters?.length&&<details><summary>Recovered model parameters</summary><pre>{JSON.stringify(record.parameters,null,2)}</pre></details>}
  </section>;
}
