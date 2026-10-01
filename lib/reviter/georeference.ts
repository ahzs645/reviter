import type {DirectoryRoom,RoomPoint} from './room-directory.ts';
export type GeoPoint={latitude:number;longitude:number};
export type GeoControlPoint={id:string;name:string;modelFeet:RoomPoint;levelId:number;geographic:GeoPoint};
export type ModelGeoreference={format:'reviter-georeference';version:1;modelFileName:string;sourceModelFileName?:string;coordinateSystem:'WGS84';method:'fixed-scale'|'fit-scale';points:GeoControlPoint[]};
const R=6378137,rad=Math.PI/180;
export function validateGeoreference(value:unknown):asserts value is ModelGeoreference {
  const g=value as ModelGeoreference;
  if(!g||g.format!=='reviter-georeference'||g.version!==1||typeof g.modelFileName!=='string'||!g.modelFileName.trim()||g.modelFileName.length>1000||g.coordinateSystem!=='WGS84'||!['fixed-scale','fit-scale'].includes(g.method)||!Array.isArray(g.points)||g.points.length>100)throw new Error('Choose a version 1 Reviter georeference file with WGS84 reference points.');
  if(g.sourceModelFileName!=null&&(typeof g.sourceModelFileName!=='string'||!g.sourceModelFileName.trim()||g.sourceModelFileName.length>1000))throw new Error('The source model filename must be a nonempty string.');
  const ids=new Set<string>();
  for(const p of g.points){if(!p||typeof p.id!=='string'||!p.id||p.id.length>200||ids.has(p.id)||typeof p.name!=='string'||p.name.length>200||!Number.isSafeInteger(p.levelId)||!Array.isArray(p.modelFeet)||p.modelFeet.length!==2||p.modelFeet.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7)||!p.geographic||!Number.isFinite(p.geographic.latitude)||Math.abs(p.geographic.latitude)>85||!Number.isFinite(p.geographic.longitude)||Math.abs(p.geographic.longitude)>180)throw new Error('Reference points need unique IDs, finite model coordinates, a native level and valid latitude/longitude.');ids.add(p.id);}
}
export function parseGeoreference(text:string):ModelGeoreference {const g:unknown=JSON.parse(text);validateGeoreference(g);return g;}
export type GeoAlignment={origin:GeoPoint;a:number;b:number;east:number;north:number;scaleMetresPerFoot:number;rotationDegrees:number;rmsMetres:number;residuals:{id:string;metres:number;predicted:GeoPoint}[]};
const eastNorth=(p:GeoPoint,o:GeoPoint):RoomPoint=>[(p.longitude-o.longitude)*rad*R*Math.cos(o.latitude*rad),(p.latitude-o.latitude)*rad*R];
const geographic=(p:RoomPoint,o:GeoPoint):GeoPoint=>({longitude:o.longitude+p[0]/(R*Math.cos(o.latitude*rad))/rad,latitude:o.latitude+p[1]/R/rad});
export function geographicToLocalMetres(p:GeoPoint,fit:GeoAlignment):RoomPoint{return eastNorth(p,fit.origin);}
/** Column-major transform from the recovered, origin-relative feet scene to local east/north/up metres.
 * Horizontal fitted scale never changes vertical Revit-foot heights. The map plane is a display datum. */
export function georeferencedSceneMatrix(fit:GeoAlignment,origin:{x:number;y:number;z:number},mapElevationFeet:number):number[]{
  return [fit.a,fit.b,0,0,-fit.b,fit.a,0,0,0,0,.3048,0,
    fit.a*origin.x-fit.b*origin.y+fit.east,fit.b*origin.x+fit.a*origin.y+fit.north,(origin.z-mapElevationFeet)*.3048,1];
}
/** Campus-scale, local east/north registration. No shear, reflection or source-coordinate edits. */
export function fitGeoreference(g:ModelGeoreference):GeoAlignment {
  validateGeoreference(g);if(g.points.length<2)throw new Error('Add at least two distinct model/map point pairs.');
  const origin={latitude:g.points.reduce((s,p)=>s+p.geographic.latitude,0)/g.points.length,longitude:g.points.reduce((s,p)=>s+p.geographic.longitude,0)/g.points.length};
  const pairs=g.points.map(p=>({p,q:eastNorth(p.geographic,origin)}));
  if(pairs.some(p=>Math.hypot(...p.q)>10000))throw new Error('Reference points must lie within one campus-scale site (10 km from their centre).');
  const mx=g.points.reduce((s,p)=>s+p.modelFeet[0],0)/pairs.length,my=g.points.reduce((s,p)=>s+p.modelFeet[1],0)/pairs.length;
  const ex=pairs.reduce((s,p)=>s+p.q[0],0)/pairs.length,ny=pairs.reduce((s,p)=>s+p.q[1],0)/pairs.length;
  let denominator=0,dot=0,cross=0;
  for(const {p,q} of pairs){const x=p.modelFeet[0]-mx,y=p.modelFeet[1]-my,e=q[0]-ex,n=q[1]-ny;denominator+=x*x+y*y;dot+=x*e+y*n;cross+=x*n-y*e;}
  if(denominator<1||Math.hypot(dot,cross)<1e-8)throw new Error('Use well-separated model points and different geographic positions.');
  const angle=Math.atan2(cross,dot),scale=g.method==='fixed-scale'?.3048:Math.hypot(dot,cross)/denominator;
  if(scale<.001||scale>10)throw new Error('The fitted scale is implausible. Check the selected points and coordinate units.');
  const a=scale*Math.cos(angle),b=scale*Math.sin(angle),east=ex-a*mx+b*my,north=ny-b*mx-a*my;
  const alignment:GeoAlignment={origin,a,b,east,north,scaleMetresPerFoot:scale,rotationDegrees:angle/rad,rmsMetres:0,residuals:[]};
  alignment.residuals=pairs.map(({p,q})=>{const target:RoomPoint=[a*p.modelFeet[0]-b*p.modelFeet[1]+east,b*p.modelFeet[0]+a*p.modelFeet[1]+north];return{id:p.id,metres:Math.hypot(target[0]-q[0],target[1]-q[1]),predicted:geographic(target,origin)};});
  alignment.rmsMetres=Math.sqrt(alignment.residuals.reduce((s,p)=>s+p.metres*p.metres,0)/pairs.length);return alignment;
}
export function modelPointToGeographic(point:RoomPoint,fit:GeoAlignment):GeoPoint{return geographic([fit.a*point[0]-fit.b*point[1]+fit.east,fit.b*point[0]+fit.a*point[1]+fit.north],fit.origin);}
export function geographicToModelPoint(p:GeoPoint,fit:GeoAlignment):RoomPoint{const [e,n]=eastNorth(p,fit.origin),x=e-fit.east,y=n-fit.north,d=fit.a*fit.a+fit.b*fit.b;return [(fit.a*x+fit.b*y)/d,(-fit.b*x+fit.a*y)/d];}
/** Web map pixels are for display only; the registration fits local ground metres. */
export function geoToMapPixel(p:GeoPoint,zoom:number):RoomPoint {const size=256*2**zoom,lat=Math.max(-85,Math.min(85,p.latitude))*rad;return[(p.longitude+180)/360*size,(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*size];}
export function mapPixelToGeo(p:RoomPoint,zoom:number):GeoPoint{const size=256*2**zoom;return{longitude:p[0]/size*360-180,latitude:Math.atan(Math.sinh(Math.PI*(1-2*p[1]/size)))/rad};}
export function georeferencedRoomsGeoJSON(rooms:readonly DirectoryRoom[],g:ModelGeoreference){const fit=fitGeoreference(g);const ring=(ps:RoomPoint[])=>{const out=ps.map(p=>{const q=modelPointToGeographic(p,fit);return[q.longitude,q.latitude];});if(out.length&&JSON.stringify(out[0])!==JSON.stringify(out.at(-1)))out.push(out[0]!);return out;};return{type:'FeatureCollection',georeference:{...g,projection:'local-equirectangular',scaleMetresPerFoot:fit.scaleMetresPerFoot,rotationDegrees:fit.rotationDegrees,rmsMetres:fit.rmsMetres},features:rooms.filter(r=>r.status!=='deleted').map(r=>({type:'Feature',id:r.key,properties:{model:g.modelFileName,sourceKey:r.key,number:r.number,name:r.name,nativeLevelId:r.levelId,access:r.access?.kind??'unreviewed',walkability:r.walkability??'unreviewed',modelElevationFeet:r.modelSurface?.elevationFeet??null},geometry:{type:'Polygon',coordinates:[r.polygonFeet,...r.holesFeet??[]].map((ps,i)=>{const out=ring(ps),signed=out.slice(1).reduce((sum,p,j)=>sum+out[j]![0]!*p[1]!-p[0]!*out[j]![1]!,0);return(signed>0)===(i===0)?out:out.reverse();})}}))};}
