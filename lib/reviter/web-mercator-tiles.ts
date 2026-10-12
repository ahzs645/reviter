/** Display-only slippy-map (Web Mercator) pixel projection for the studio map.
 * Kept outside georeference.ts so the compiled-geometry pipeline never imports
 * implementation-approximated Math (tan/log/sinh); registration fits local ground metres. */
import type {RoomPoint} from './room-directory.ts';
import type {GeoPoint} from './georeference.ts';
const rad=Math.PI/180;
export function geoToMapPixel(p:GeoPoint,zoom:number):RoomPoint {const size=256*2**zoom,lat=Math.max(-85,Math.min(85,p.latitude))*rad;return[(p.longitude+180)/360*size,(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*size];}
export function mapPixelToGeo(p:RoomPoint,zoom:number):GeoPoint{const size=256*2**zoom;return{longitude:p[0]/size*360-180,latitude:Math.atan(Math.sinh(Math.PI*(1-2*p[1]/size)))/rad};}
