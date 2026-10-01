export type MapViewBox = [number,number,number,number];
/** Zoom about a world point, preserving aspect ratio and its screen position. */
export function zoomMapViewBox(view:MapViewBox, factor:number, anchor:[number,number], fitted:MapViewBox):MapViewBox {
  const width=Math.max(fitted[2]/40,Math.min(fitted[2]*8,view[2]*factor)),ratio=width/view[2];
  return [anchor[0]-(anchor[0]-view[0])*ratio,anchor[1]-(anchor[1]-view[1])*ratio,width,view[3]*ratio];
}

/** Wheel units differ between mice, trackpads and browser page scrolling. */
export function wheelZoomFactor(delta:number,mode:number,pageHeight:number):number {
  const pixels=delta*(mode===1?16:mode===2?pageHeight:1);
  return Math.exp(Math.max(-.3,Math.min(.3,pixels*.0015)));
}
/** Events can arrive before the previous frame is drawn. Keep accumulating the
 * live view while deriving the cursor fraction from the view actually on screen. */
export function zoomPendingMapView(live:MapViewBox,drawn:MapViewBox,cursor:[number,number],factor:number,fitted:MapViewBox):MapViewBox {
  const fraction=[(cursor[0]-drawn[0])/drawn[2],(cursor[1]-drawn[1])/drawn[3]];
  return zoomMapViewBox(live,factor,[live[0]+fraction[0]!*live[2],live[1]+fraction[1]!*live[3]],fitted);
}
