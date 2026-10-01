"use client";
import type {BuildingConnection} from '../../lib/reviter/building-connections.ts';
import {roomBuilding,type DirectoryRoom}from '../../lib/reviter/room-directory.ts';

export function BuildingConnectionInspector({connections,building,onFocus,onChoose,onDoor,modelView=false}:{connections:readonly BuildingConnection[];building:string;modelView?:boolean;onFocus?:(c:BuildingConnection)=>void;onChoose?:(r:DirectoryRoom,c:BuildingConnection)=>void;onDoor?:(id:number)=>void}){
  if(!connections.length)return null;
  return <section className="directory-building-connections" aria-label="Building connections"><strong>Building connections</strong>{connections.map(c=>{
    const local=(c.rooms.find(r=>roomBuilding(r)===building)??c.rooms[0])!,other=c.rooms.find(r=>r.key!==local.key)!;
    return <div key={c.door.door.id}><p><strong>Building {roomBuilding(local)} ↔ Building {roomBuilding(other)}</strong><br/>{local.number} · {local.name} ↔ {other.number} · {other.name}</p><p>Revit level #{c.levelId} · {c.elevation.toFixed(2)} ft<br/>Native Door #{c.door.door.id} · {c.route?'local crossing verified':'route geometry needs review'}</p><div className="directory-area-chips">{onFocus&&<button className="rv-button" onClick={()=>onFocus(c)}>View connection</button>}{onChoose&&<button className="rv-button" onClick={()=>onChoose(other,c)}>{modelView?`Select ${other.number} in 3D`:`Open Building ${roomBuilding(other)}`}</button>}{onDoor&&<button className="rv-button" onClick={()=>onDoor(c.door.door.id)}>Door #{c.door.door.id}</button>}</div><p className="directory-connection-pending">Door position and access restrictions are unknown. The crossing joins these two spaces; onward campus routes need their own connections.</p></div>;
  })}</section>;
}
