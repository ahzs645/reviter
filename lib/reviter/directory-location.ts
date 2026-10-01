import {containsDirectoryRoomPoint,directoryRoomArea,isHallway, type DirectoryRoom,type DirectoryDoor,type RoomPoint}from './room-directory.ts';
/** Rooms win over overlapping hallway masks. Door proximity is a picking aid,
 * never new connectivity evidence or a change to the source coordinates. */
export function directoryLocation(rooms:readonly DirectoryRoom[],doors:readonly DirectoryDoor[],point:RoomPoint,doorToleranceFeet:number){
  const candidates=rooms.filter(r=>r.status!=='deleted'&&containsDirectoryRoomPoint(point,r)).sort((a,b)=>Number(isHallway(a))-Number(isHallway(b))||directoryRoomArea(a)-directoryRoomArea(b));
  const nearby=doors.map(d=>({id:d.id,distance:Math.hypot(d.point[0]-point[0],d.point[1]-point[1])})).filter(d=>d.distance<=doorToleranceFeet).sort((a,b)=>a.distance-b.distance);
  return {point,roomKeys:candidates.map(r=>r.key),doorId:nearby[0]?.id};
}
