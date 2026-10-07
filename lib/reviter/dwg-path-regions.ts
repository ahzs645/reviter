import type {CadPathFloor} from './dwg-drawing-paths.ts';
/** Derived drawing display only. Keep source records and all rings/holes intact. */
export function cadPathReviewRegions<T extends {roomKey:string;ringsMetres:[number,number][][];sharedRoomKeys:string[];areaSquareMetres?:number|null;status?:string}>(original:T[],paths:CadPathFloor):T[]{
 return original.map(r=>{const room=paths.rooms.find(v=>v.roomKey===r.roomKey),cell=room?.cellId==null?null:paths.cells[room.cellId];
  if(!cell||!cell.roomKeys.includes(r.roomKey))return {...r};
  const area=cell.ringsMetres.reduce((sum,ring,i)=>{const a=Math.abs(ring.reduce((s,p,j)=>{const q=ring[(j+1)%ring.length]!;return s+p[0]*q[1]-q[0]*p[1];},0))/2;return sum+(i===0?a:-a);},0);
  return {...r,ringsMetres:cell.ringsMetres,sharedRoomKeys:cell.roomKeys,areaSquareMetres:area,status:cell.roomKeys.length>1?'shared-contact-corrected-drawing-region':'contact-corrected-drawing-region-needs-review'};
 });
}
