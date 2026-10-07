import type {CadStairAssumptions} from './dwg-stair-assumptions.ts';
import type {CadFloorSurfaces} from './dwg-floor-surfaces.ts';
import {cadPathReviewRegions} from './dwg-path-regions.ts';
import {cadDoorDisplayStrokes} from './dwg-door-display.ts';
import {findCadDrawingPath,findCadMultiFloorPath,type CadDrawingPaths} from './dwg-drawing-paths.ts';
import type { analyzeCadFloors } from "./dwg-floor-analysis.ts";

/** Trusted viewer code: imported package HTML is never executed. */
export function cadFloorAnalysisPreview(html: string, analysis: ReturnType<typeof analyzeCadFloors>) {
  const payload = JSON.stringify(analysis).replace(/</g, "\\u003c");
  if (!html.includes("selection=null;$('selectedSpace')") || !html.includes('<p id="facts"></p>')) {
    throw new Error("CAD preview template changed; review integration before packaging.");
  }
  return html.replace("/*DOOR_DISPLAY_HELPER*/", "const cadDoorDisplayStrokes="+cadDoorDisplayStrokes.toString()+";").replace("<title>CAD geometry reconstruction</title>", "<title>Reviter CAD floor analysis</title>")
    .replace("<h1>CAD geometry reconstruction</h1>", "<h1>Reviter CAD floor analysis</h1>")
    .replace('<p id="facts"></p>', `<p id="facts"></p><details id="floorAnalysisPanel" open><summary>Floor alignment and connections</summary><p id="floorAlignment"></p><label>Compare floor layout<select id="compareFloor" aria-label="Compare floor layout"><option value="">No comparison overlay</option></select></label><p class="sub">Purple dashed lines compare original source shapes in building-local metres. Partial upper plans do not establish floor support.</p><div id="floorMatches" class="list"></div><p id="floorMatchLimits"></p><h2>Labelled stair families</h2><div id="stairFamilies" class="list"></div><p id="buildingReviewSummary"></p><a href="coverage-audit.json" download>Every-building coverage audit</a></details>`)
    .replace("selection=null;$('selectedSpace')", "renderFloorAnalysis();selection=null;$('selectedSpace')")
    .replace("</script></html>", `</script><script>
const floorAnalysis=${payload};
function comparisonPoint(p,id){
 const t=floorAnalysis.floors.find(f=>f.id===id).additionalTransform;
 const current=floorAnalysis.floors.find(f=>f.id===floor.id).additionalTransform;
 const x=t.a*p[0]+t.c*p[1]+t.e,y=t.b*p[0]+t.d*p[1]+t.f;
 const den=current.a*current.d-current.b*current.c;
 return [(current.d*(x-current.e)-current.c*(y-current.f))/den,(-current.b*(x-current.e)+current.a*(y-current.f))/den];
}
function renderComparison(){
 $('drawing').querySelector('#comparisonOverlay')?.remove();
 const other=data.floors.find(f=>f.id===$('compareFloor').value);
 if(!other||$('mode').value!=='2d'){
  const points=floor.primitives.flatMap(p=>p.pointsMetres.map(q=>project(q)));
  const bounds=points.reduce((b,v)=>[Math.min(b[0],v[0]),Math.min(b[1],v[1]),Math.max(b[2],v[0]),Math.max(b[3],v[1])],[Infinity,Infinity,-Infinity,-Infinity]);
  base=[bounds[0]-3,bounds[1]-3,bounds[2]-bounds[0]+6,bounds[3]-bounds[1]+6];view=[...base];update();return;
 }
 const group=node('g',{id:'comparisonOverlay','pointer-events':'none','aria-label':'Compared source floor '+other.id});
 for(const p of other.primitives){const n=line(p.pointsMetres.map(q=>comparisonPoint(q,other.id)),'#783da8',.8);n.setAttribute('stroke-dasharray','4 3');group.append(n);}
 $('drawing').append(group);
 const bounds=[Infinity,Infinity,-Infinity,-Infinity];
 for(const f of [floor,other])for(const p of f.primitives)for(const q of p.pointsMetres){const v=project(f===floor?q:comparisonPoint(q,f.id));bounds[0]=Math.min(bounds[0],v[0]);bounds[1]=Math.min(bounds[1],v[1]);bounds[2]=Math.max(bounds[2],v[0]);bounds[3]=Math.max(bounds[3],v[1]);}
 base=[bounds[0]-3,bounds[1]-3,bounds[2]-bounds[0]+6,bounds[3]-bounds[1]+6];view=[...base];update();
}
function renderFloorAnalysis(){
  const result=floorAnalysis.floors.find(f=>f.id===floor.id),fit=floorAnalysis.registrations.find(r=>r.floorId===floor.id);
  $('floorAlignment').textContent=fit?'Control-checked local alignment · '+fit.controlCount+' controls · maximum residual '+fit.maximumMetres.toFixed(4)+' m. This is not campus placement.': 'Original drawing alignment: '+result.alignment.status+'. Compare original stair and structural features before confirming orientation.';
  const compare=$('compareFloor'),previous=compare.value;compare.replaceChildren();
  for(const f of [null,...data.floors.filter(f=>f.buildingCode===floor.buildingCode&&f.id!==floor.id)]){const o=document.createElement('option');o.value=f?.id??'';o.textContent=f?f.name+' · '+f.id:'No comparison overlay';compare.append(o);}
  if([...compare.options].some(o=>o.value===previous))compare.value=previous;compare.disabled=$('mode').value!=='2d';compare.onchange=renderComparison;renderComparison();
  const list=$('floorMatches');list.replaceChildren();
  const matches=floorAnalysis.candidates.filter(c=>[c.fromFloorId,c.toFloorId].includes(floor.id));
  for(const c of matches){const text=document.createElement('p');text.textContent=c.fromFloorId+' ↔ '+c.toFloorId+' · '+c.alignmentStatus+' · '+(c.overlapRatio*100).toFixed(1)+'% footprint overlap';list.append(text);
    for(const [id,areaId]of [[c.fromFloorId,c.fromAreaId],[c.toFloorId,c.toAreaId]]){const b=document.createElement('button');b.textContent='Inspect '+areaId;b.onclick=()=>{$('floor').value=id;render();const area=floor.stairAreas.find(a=>a.id===areaId);if(area)pick('stair-area',area);$('floorAnalysisPanel').open=true;};list.append(b);}}
  const unresolved=floorAnalysis.unresolved.filter(r=>r.floorIds.includes(floor.id));
  $('floorMatchLimits').textContent=matches.length+' candidate correspondence(s) · '+unresolved.length+' unmatched or ambiguous record(s). Drawing comparison only; elevations, entrances, continuous flights and access still need review. No route edges created.';
  const families=$('stairFamilies');families.replaceChildren();
  for(const f of floorAnalysis.stairFamilies??[]){if(f.buildingCode!==floor.buildingCode)continue;
    const p=document.createElement('p');p.textContent=f.family+' · '+f.status+(f.missingDrawingOrdinals.length?' · no labelled stop on drawing level '+f.missingDrawingOrdinals.join(', '):'');families.append(p);
    for(const o of f.occurrences){const b=document.createElement('button');b.textContent='Inspect '+o.number+' · '+o.floorId;b.onclick=()=>{$('floor').value=o.floorId;render();const room=floor.regions.find(r=>r.roomKey===o.roomKey);if(room)pick('room',room);};families.append(b);}}
  const levels=floorAnalysis.floors.filter(f=>f.buildingCode===floor.buildingCode);
  $('buildingReviewSummary').textContent='Building '+floor.buildingCode+' · '+levels.length+' analyzed drawing floors · '+levels.reduce((n,f)=>n+f.roomRecords,0)+' room labels. Shared or missing regions: '+levels.reduce((n,f)=>n+f.sharedRegions+f.missingRegions,0)+'. See coverage audit for pending composite panels.';
}
</script></html>`);
}

export function cadFloorReviewDocument(html: string, geometry: unknown, analysis: ReturnType<typeof analyzeCadFloors>, paths:CadDrawingPaths|null=null,assumptions:CadStairAssumptions|null=null,surfaces:CadFloorSurfaces|null=null,circulation:import('./dwg-circulation-review.ts').CadCirculationReview|null=null) {
  const escaped = JSON.stringify(geometry).replace(/</g,"\\u003c");
  const template = cadCirculationReviewPreview(cadFloorSurfacesPreview(cadStairAssumptionsPreview(cadDrawingPathsPreview(cadFloorAnalysisPreview(html, analysis),paths),assumptions),surfaces),circulation);
  const request = "const r=await fetch('geometry.json',{cache:'no-store'});";
  if (!template.includes(request)) throw new Error("Viewer geometry loader changed.");
  // Inline data resolves before the parser reaches the comparison script.
  // Start after both trusted scripts are installed, rather than relying on fetch latency.
  const readyTemplate=template.replace("(async()=>{try{const r=", "window.addEventListener('DOMContentLoaded',()=>{(async()=>{try{const r=")
    .replace("}})();\n</script>", "}})();});\n</script>");
  return readyTemplate.replace(request, `const r={ok:true,json:async()=>(${escaped})};`)
    .replace('<a href="UNBC.cad-geometry.zip" download>Download package</a>', '<span class="sub">Loaded locally in Reviter</span>')
    .replace(/<details><summary>Portable files and limits<\/summary>[\s\S]*?<\/details>/, '<a id="modelDownload" hidden></a><p>Portable evidence stays in your original CAD analysis ZIP. Use Reviter’s toolbar to download the coverage audit.</p>')
    .replace('<a href="coverage-audit.json" download>Every-building coverage audit</a>', '<span>Full coverage audit is available in Reviter’s toolbar.</span>');
}

/** Show source-bound hole evidence in the same local coordinates as the drawing/path cells. */
export function cadFloorSurfacesPreview(html:string,surfaces:CadFloorSurfaces|null){
 if(!surfaces)return html;
 const payload=JSON.stringify(surfaces).replace(/</g,'\\u003c');
 return html.replace('<p id="facts"></p>','<details open><summary>Reviewed floor surfaces and openings</summary><div id="floorSurfaceReview"></div><p>Use Area comparison to inspect the original and recovered floor. Orange outlines protect the centre open to below. The recovered surface can also be switched off in 3D building.</p></details><p id="facts"></p>')
 .replace('renderFloorAnalysis();','renderReviewedSurfaces();renderFloorAnalysis();')
 .replace('</script></html>',`</script><script>
const floorSurfaceReview=${payload};
function renderReviewedSurfaces(){const list=$('floorSurfaceReview');list.replaceChildren();for(const s of floorSurfaceReview.surfaces.filter(s=>s.floorId===floor.id)){const p=document.createElement('p');p.textContent=s.title+' · centre open to below. '+s.reason;list.append(p);const b=document.createElement('button');b.textContent='Inspect '+s.title;b.onclick=()=>{focus(s.ringsMetres.flat());$('detail').textContent=s.remainingReview.join(' ');};list.append(b);const g=node('g',{id:'protectedOpeningOverlay','pointer-events':'none','aria-label':'Protected opening: '+s.title});for(const ring of s.ringsMetres.slice(1)){const n=line(ring,'#c87831',3);g.append(n);}$('drawing').append(g);}}
</script></html>`);
}

export function cadDrawingPathsPreview(html:string,paths:CadDrawingPaths|null){
 if(!paths)return html;
 const payload=JSON.stringify(paths).replace(/</g,'\\u003c');
 return html.replace("floor=data.floors.find(f=>f.id===$('floor').value);if(!floor)return;","floor=data.floors.find(f=>f.id===$('floor').value);if(!floor)return;applyPathRegions();").replace('<div class="legend">','<div class="legend">Magenta path: comparison · Green thresholds: two-sided · Orange: needs review<br>').replace('<p id="facts"></p>',`<details id="drawingPathsPanel" open><summary>Paths and door review</summary><label>Area comparison<select id="pathRegionMode" aria-label="Area comparison"><option value="contacts">Contact-corrected drawing areas</option><option value="original">Original recovered areas</option></select></label><p id="pathCounts"></p><label>Start space<select id="pathStart" aria-label="Path start space"></select></label><label>Destination floor<select id="pathEndFloor" aria-label="Path destination floor"></select></label><label>Destination space<select id="pathEnd" aria-label="Path destination space"></select></label><button id="previewPath">Preview drawing path</button> <button id="clearPath">Clear path</button><label><input type="checkbox" id="pathAssumedStairs"> Use assumed aligned stairs between floors</label><label><input type="checkbox" id="allowUnlabelled"> Compare through unlabelled areas (unverified)</label><label><input type="checkbox" id="pathDoors" checked> Colour door connectivity</label><p id="pathResult" role="status">Choose two spaces on this drawing floor. This comparison does not provide visitor directions.</p><label>Door review filter<select id="pathDoorFilter" aria-label="Door review filter"><option value="unresolved">Unresolved doors</option><option value="all">All doors</option><option value="two-sided-drawing-door">Two-sided drawing doors</option></select></label><div id="pathDoorList" class="list"></div><details><summary>Selection closure comparisons</summary><p>Each link joins recorded original wall contacts for outlining only. Inspect one doorway at a time; physical door width and source strokes remain unchanged.</p><div id="selectionClosureList" class="list"></div><button id="clearSelectionClosure">Show original geometry</button><p id="selectionClosureResult" role="status"></p></details><details><summary>Unmeshed spaces and nearby entrances</summary><p>Labels do not establish a floor. Inspect the original source outline and nearby unmatched door swings before recovering a landing, lobby or shaft.</p><div id="unmeshedSpaces" class="list"></div></details><button id="downloadPaths">Download path and door evidence</button></details><p id="facts"></p>`)
 .replace("renderFloorAnalysis();selection=null;", "renderFloorAnalysis();renderDrawingPaths();selection=null;")
 .replace('</script></html>',`</script><script>
const drawingPaths=${payload};
const pathRegionSources=new WeakMap(),derivePathRegions=${cadPathReviewRegions.toString()};
function applyPathRegions(){if(!pathRegionSources.has(floor))pathRegionSources.set(floor,floor.regions);const original=pathRegionSources.get(floor),report=drawingPaths.floors.find(f=>f.id===floor.id);floor.regions=$('pathRegionMode').value==='contacts'&&report?derivePathRegions(original,report):original;}
$('pathRegionMode').onchange=render;
const pathWorker=new Worker(URL.createObjectURL(new Blob(['const solve='+${JSON.stringify(findCadDrawingPath.toString())}+';const multi='+${JSON.stringify(findCadMultiFloorPath.toString())}+';self.onmessage=e=>{const {paths,assumptions,floor,start,end,endFloor,assumed,allow,token}=e.data;self.postMessage({token,floorId:floor.id,result:multi(paths,assumptions,floor.id,start,endFloor,end,assumed,allow)});};'],{type:'text/javascript'})));
let pathToken=0,pathFloorId='',pathPoints=[];
function clearDrawingPath(){pathToken++;pathPoints=[];parent.postMessage({type:'reviter-cad-path-preview',path:null},'*');$('drawing').querySelector('#drawingPathOverlay')?.remove();}
function paintDrawingDoors(){
 $('drawing').querySelector('#drawingDoorOwnership')?.remove();if(!$('pathDoors').checked)return;
 const f=drawingPaths.floors.find(f=>f.id===floor.id);if(!f)return;const g=node('g',{id:'drawingDoorOwnership'});
 for(const d of f.doors){const n=line(d.closedLeafMetres,d.status==='two-sided-drawing-door'?'#0d925e':'#d36a16',4);n.setAttribute('role','button');n.setAttribute('aria-label','Inspect door '+d.arcHandle+' · '+d.status);n.setAttribute('tabindex','0');n.onclick=()=>inspectDrawingDoor(d);n.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspectDrawingDoor(d);}};g.append(n);}$('drawing').append(g);
}
function drawingDoorLabel(d){return {'two-sided-drawing-door':'Two-sided areas','unmatched-area':'Adjacent boundary missing','same-area-bypass':'Same area on both sides','source-obstacle':'Other source stroke blocks threshold','mesh-incomplete':'Approach not covered by path mesh'}[d.status]??d.status;}
function inspectDrawingDoor(d){const original=floor.doors.find(x=>x.id===d.id);if(original)pick('door',original);$('detail').textContent+=' '+d.status+' · '+d.reason;$('pathResult').textContent='Door #'+d.arcHandle+' · '+d.status+' · '+d.reason;}
function renderDrawingDoorList(){
 const f=drawingPaths.floors.find(f=>f.id===floor.id);$('pathDoorList').replaceChildren();if(!f)return;
 for(const d of f.doors){const filter=$('pathDoorFilter').value;if(filter==='unresolved'&&d.status==='two-sided-drawing-door'||filter==='two-sided-drawing-door'&&d.status!==filter)continue;const b=document.createElement('button');b.textContent='#'+d.arcHandle+' · '+drawingDoorLabel(d);b.onclick=()=>inspectDrawingDoor(d);$('pathDoorList').append(b);}
}
function fillPathSpaces(id,f,old){$(id).replaceChildren();for(const r of f.rooms){const o=document.createElement('option');o.value=r.roomKey;o.textContent=r.number+' · '+r.name+(r.nodeId===null?' · boundary missing':r.status==='shared-drawing-region'?' · shared boundary':'');$(id).append(o);}if([...$(id).options].some(o=>o.value===old))$(id).value=old;}
function renderDrawingPaths(){
 const f=drawingPaths.floors.find(f=>f.id===floor.id);if(!f)return;clearDrawingPath();
 const previousEndFloor=$('pathEndFloor').value;$('pathEndFloor').replaceChildren();for(const pf of drawingPaths.floors.filter(p=>p.buildingCode===floor.buildingCode)){const o=document.createElement('option');o.value=pf.id;o.textContent=pf.name+' · '+pf.id;$('pathEndFloor').append(o);}$('pathEndFloor').value=[...$('pathEndFloor').options].some(o=>o.value===previousEndFloor)?previousEndFloor:floor.id;
 const oldStart=pathFloorId===floor.id?$('pathStart').value:'';fillPathSpaces('pathStart',f,oldStart);fillPathSpaces('pathEnd',drawingPaths.floors.find(p=>p.id===$('pathEndFloor').value),$('pathEnd').value);
 if(pathFloorId!==floor.id&&$('pathEndFloor').value===floor.id&&f.rooms.length>1)$('pathEnd').selectedIndex=1;pathFloorId=floor.id;
 $('pathCounts').textContent=f.doors.filter(d=>d.status==='two-sided-drawing-door').length+' / '+f.doors.length+' door symbols have distinct drawing areas on both sides. '+f.rooms.filter(r=>r.nodeId!==null).length+' / '+f.rooms.length+' space anchors have recovered boundaries.';
 $('pathResult').textContent='Drawing comparison only. Access, floor support and stair continuity remain unverified.';
 renderDrawingDoorList();paintDrawingDoors();renderSelectionClosures();renderUnmeshedSpaces();
}
function renderUnmeshedSpaces(){
 const report=drawingPaths.floors.find(f=>f.id===floor.id),list=$('unmeshedSpaces');list.replaceChildren();
 for(const r of report.rooms.filter(r=>r.nodeId===null)){const original=floor.regions.find(x=>x.roomKey===r.roomKey);if(!original)continue;
  const arcs=floor.primitives.filter(p=>floor.unresolvedDoorArcHandles.includes(p.sourceHandle)&&p.pointsMetres.some(q=>Math.hypot(q[0]-original.anchorMetres[0],q[1]-original.anchorMetres[1])<5));
  const b=document.createElement('button');b.textContent='Inspect unmeshed '+r.number+' · '+r.name;b.onclick=()=>{pick('room',original,false);const p=original.anchorMetres;focus([[p[0]-5,p[1]-5],[p[0]+5,p[1]+5]]);$('detail').textContent+=' No meshed floor anchor. Nearby unmatched swing(s): '+(arcs.map(a=>'#'+a.sourceHandle).join(', ')||'none within 5 m')+'. Proximity does not establish doorway or shaft ownership.';};list.append(b);
  for(const arc of arcs){const a=document.createElement('button');a.textContent='Inspect swing #'+arc.sourceHandle+' near '+r.number;a.onclick=()=>pick('arc',arc);list.append(a);}
 }
}
function renderSelectionClosures(){
 $('drawing').querySelector('#selectionClosureOverlay')?.remove();$('selectionClosureResult').textContent='';$('selectionClosureList').replaceChildren();
 const f=drawingPaths.floors.find(f=>f.id===floor.id);
 for(const c of f?.selectionDoorClosures??[]){const d=f.doors.find(d=>d.id===c.doorId),b=document.createElement('button');b.textContent='Inspect closure at #'+(d?.arcHandle??c.doorId);b.onclick=()=>{
  $('drawing').querySelector('#selectionClosureOverlay')?.remove();const g=node('g',{id:'selectionClosureOverlay','pointer-events':'none','aria-label':'Selected door closure comparison'});
  for(const id of d?.cellIds??[]){const cell=f.cells[id];if(cell){const area=polygon(cell.ringsMetres,'#38b37b4d','#0d925e');g.append(area);}}
  for(const ps of c.selectionThresholdSegmentsMetres)g.append(line(ps,'#d526cb',5));$('drawing').append(g);focus(c.selectionThresholdSegmentsMetres.flat());
  $('selectionClosureResult').textContent='Door #'+d?.arcHandle+' · width unchanged: '+c.physicalDoorWidthMetres.toFixed(3)+' m. Magenta: exact original wall-contact closure. Green: recovered adjacent path areas. '+d?.reason;
 };$('selectionClosureList').append(b);}
}
$('clearSelectionClosure').onclick=()=>{$('drawing').querySelector('#selectionClosureOverlay')?.remove();$('selectionClosureResult').textContent='Comparison cleared. Original source strokes remain visible.';};
$('pathDoors').onchange=paintDrawingDoors;$('pathDoorFilter').onchange=renderDrawingDoorList;
$('clearPath').onclick=()=>{clearDrawingPath();$('pathResult').textContent='Path cleared.';};
$('pathEndFloor').onchange=()=>{fillPathSpaces('pathEnd',drawingPaths.floors.find(p=>p.id===$('pathEndFloor').value),'');clearDrawingPath();$('pathResult').textContent='Destination floor changed. Enable assumed stairs to compare between floors.';};
for(const id of ['pathStart','pathEnd','allowUnlabelled','pathAssumedStairs'])$(id).onchange=()=>{clearDrawingPath();$('pathResult').textContent='Selection changed. Preview again to compare.';};
$('previewPath').onclick=()=>{clearDrawingPath();const f=drawingPaths.floors.find(f=>f.id===floor.id);$('pathResult').textContent='Checking drawing path…';pathWorker.postMessage({paths:drawingPaths,assumptions:typeof stairAssumptions==='undefined'?null:stairAssumptions,floor:f,start:$('pathStart').value,end:$('pathEnd').value,endFloor:$('pathEndFloor').value,assumed:$('pathAssumedStairs').checked,allow:$('allowUnlabelled').checked,token:pathToken});};
pathWorker.onmessage=({data:message})=>{
 if(message.token!==pathToken||message.floorId!==floor.id)return;const result=message.result,f=drawingPaths.floors.find(f=>f.id===floor.id);
 if(result.status!=='drawing-preview'){$('pathResult').textContent=(result.status==='stairs-disabled'?'Enable “Use assumed aligned stairs between floors” for a provisional comparison.':result.status==='missing-boundary'?'An endpoint lacks a recovered boundary. Inspect its missing wall/threshold evidence.':'No connected drawing path. Unmeshed landings and intermediate offices remain excluded.')+(result.unresolved.length?' '+result.unresolved.join('; '):'');return;}
 const segment=result.segments.find(s=>s.floorId===floor.id);pathPoints=segment?.points??[];const segments=result.segments.map(s=>{const t=floorAnalysis.floors.find(x=>x.id===s.floorId).additionalTransform;return {floorId:s.floorId,points:s.points.map(p=>[t.a*p[0]+t.c*p[1]+t.e,t.b*p[0]+t.d*p[1]+t.f])};});
 parent.postMessage({type:'reviter-cad-path-preview',path:{floorId:floor.id,points:segments[0].points,segments,connections:result.connections,lengthMetres:result.lengthMetres}},'*');const g=node('g',{id:'drawingPathOverlay','pointer-events':'none','aria-label':'Drawing path comparison'});if(pathPoints.length){g.append(line(pathPoints,'#d526cb',4));for(const p of [pathPoints[0],pathPoints[pathPoints.length-1]]){const q=project(p);g.append(node('circle',{cx:q[0],cy:q[1],r:.3,fill:'#d526cb'}));}$('drawing').append(g);focus(pathPoints);}
 $('pathResult').textContent=result.lengthMetres.toFixed(1)+' m horizontal drawing path · '+result.doorIds.length+' measured door crossing(s) · '+result.connections.length+' assumed stair connection(s). '+(result.connections.length?'Open 3D building → All drawing floors to see the whole path. Stair rise and intermediate stops remain unknown. ':'')+'Access and floor support remain unverified.'+(result.unresolved.length?' Other stair pairs needing landings: '+result.unresolved.length+'.':'');

};
$('downloadPaths').onclick=()=>{const blob=new Blob([JSON.stringify(drawingPaths,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='drawing-paths.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('pagehide',()=>pathWorker.terminate());
</script></html>`);
}

export function cadStairAssumptionsPreview(html:string,assumptions:CadStairAssumptions|null){
 if(!assumptions)return html;
 const payload=JSON.stringify(assumptions).replace(/</g,'\\u003c');
 return html.replace('<h2>Labelled stair families</h2>','<details><summary>Temporary stair assumptions</summary><p>Switch these on or off in 3D building → Show assumed aligned stair connections. Magenta links share a point inside both original source footprints; no floors are moved. Continuous flights are assumed. Heights, intermediate stops and access remain unknown.</p><div id="assumedStairList"></div></details><h2>Labelled stair families</h2>')
 .replace('renderFloorAnalysis();selection=null;', 'renderFloorAnalysis();renderAssumedStairs();selection=null;').replace('renderFloorAnalysis();renderDrawingPaths();','renderFloorAnalysis();renderDrawingPaths();renderAssumedStairs();')
 .replace('</script></html>',`</script><script>
const stairAssumptions=${payload};
function renderAssumedStairs(){const list=$('assumedStairList');list.replaceChildren();for(const c of stairAssumptions.connections.filter(c=>c.buildingCode===floor.buildingCode)){const p=document.createElement('p');p.textContent=c.family+' · '+c.fromFloorId+' ↔ '+c.toFloorId+' · aligned shared footprint · assumed continuity'+(c.missingIntermediateOrdinals.length?' · intermediate stop unknown':'');list.append(p);for(const [id,point]of [[c.fromFloorId,c.fromPointMetres],[c.toFloorId,c.toPointMetres]]){const b=document.createElement('button');b.textContent='Inspect assumed '+c.family+' on '+id;b.onclick=()=>{$('floor').value=id;render();const q=project(point),g=node('circle',{cx:q[0],cy:q[1],r:.3,fill:'#d526cb','aria-label':'Aligned assumed stair point'});$('drawing').append(g);focus([point]);$('detail').textContent=c.reason;};list.append(b);}}
for(const u of stairAssumptions.unresolved.filter(u=>u.buildingCode===floor.buildingCode)){const p=document.createElement('p');p.textContent=u.family+': '+u.reason;list.append(p);}}
</script></html>`);
}

/** Reusable interpretation evidence, with one source contact visible at a time. */
export function cadCirculationReviewPreview(html:string,review:import('./dwg-circulation-review.ts').CadCirculationReview|null){
 if(!review)return html;
 const payload=JSON.stringify(review).replace(/</g,'\\u003c');
 return html.replace('<p id="facts"></p>',`<details id="circulationInterpretationPanel"><summary>Drawing interpretation and remaining boundaries</summary><p id="interpretationCounts"></p><p>Original drawing bytes are preserved. These contact joins and door interpretations affect comparison areas only. A shared label is not a separately enclosed room.</p><label>Measured source contact<select id="sourceContact" aria-label="Measured source contact"></select></label><button id="inspectSourceContact">Inspect this contact</button><button id="clearSourceContact">Clear contact overlay</button><p id="sourceContactEvidence" role="status"></p><details><summary>Paired stair riser interpretation</summary><p>Exact paired riser strokes are drawing symbols. Railings stay protected. Inspect one source stroke alongside its recognized tread.</p><div id="stairRiserList" class="list"></div><button id="clearStairRiser">Clear riser overlay</button><p id="stairRiserEvidence" role="status"></p></details><div id="remainingBoundaryList" class="list"></div><details><summary>Doorless entrance boundary proposals</summary><p>Preview one logical boundary at a time. This does not construct a wall, admit a route or certify access.</p><div id="logicalEntranceList" class="list"></div><button id="clearLogicalEntrance">Show current areas</button><p id="logicalEntranceResult" role="status"></p></details><button id="downloadInterpretation">Download interpretation evidence</button></details><p id="facts"></p>`)
 .replace('renderDrawingPaths();','renderDrawingPaths();renderCirculationReview();')
 .replace('</script></html>',`</script><script>
const circulationInterpretation=${payload};
function renderCirculationReview(){
 const r=circulationInterpretation.floors.find(r=>r.floorId===floor.id),list=$('remainingBoundaryList'),select=$('sourceContact');list.replaceChildren();select.replaceChildren();$('logicalEntranceList').replaceChildren();$('stairRiserList').replaceChildren();$('drawing').querySelector('#stairRiserOverlay')?.remove();$('drawing').querySelector('#sourceContactOverlay')?.remove();$('drawing').querySelector('#logicalEntranceOverlay')?.remove();
 $('interpretationCounts').textContent=r?r.assessment.beforeClosedLabels+' → '+r.assessment.afterClosedLabels+' labelled anchors in meshed drawing areas. '+r.doors.length+' additional supported leaf symbols; '+r.contacts.length+' finite contacts ≤ 2 mm; '+(r.stairRiserWitnesses??[]).length+' paired riser strokes abstracted. '+r.assessment.sharedLabels.length+' shared labels and '+r.assessment.missingLabels.length+' missing boundaries remain.':'No interpretation applied to this floor.';
 if(!r)return;
 for(const w of r.stairRiserWitnesses??[]){const b=document.createElement('button');b.textContent='Inspect riser #'+w.handle+' · tread '+(w.treadIndex+1);b.onclick=()=>{$('drawing').querySelector('#stairRiserOverlay')?.remove();const tread=floor.stairs.find(s=>s.id===w.stairId)?.treads[w.treadIndex];if(!tread)return;const g=node('g',{id:'stairRiserOverlay','pointer-events':'none'});g.append(line(tread.pointsMetres,'#278f64',4));g.append(line(w.pointsMetres,'#d8249d',4));$('drawing').append(g);focus(w.pointsMetres.concat(w.pointsMetres.map(p=>[p[0]+.4,p[1]+.4]),w.pointsMetres.map(p=>[p[0]-.4,p[1]-.4])));$('stairRiserEvidence').textContent='Original riser #'+w.handle+' · exact finite span beside a recognized tread, at most 25 mm apart. This symbol is excluded from comparison barriers; original CAD and railings are retained.';};$('stairRiserList').append(b);}
 for(const c of r.entranceCandidates??[]){const b=document.createElement('button');const groups=c.roomGroups.map(keys=>keys.map(key=>floor.regions.find(r=>r.roomKey===key)?.number??key).join(', '));b.textContent='Preview '+c.widthMetres.toFixed(2)+' m entrance · '+groups.map(g=>g.length>55?g.slice(0,55)+'…':g).join(' / ');b.onclick=()=>{$('drawing').querySelector('#logicalEntranceOverlay')?.remove();const g=node('g',{id:'logicalEntranceOverlay','pointer-events':'none'});const area=rings=>Math.abs(rings[0].reduce((sum,p,i)=>{const q=rings[0][(i+1)%rings[0].length];return sum+p[0]*q[1]-q[0]*p[1];},0));const smallest=Math.min(...c.previewRingsMetres.map(area));for(const rings of c.previewRingsMetres)g.append(polygon(rings,area(rings)===smallest?'#59bc8240':'none',area(rings)===smallest?'#29945d':'#6b9294'));g.append(line(c.pointsMetres,'#d8249d',5));$('drawing').append(g);focus(c.pointsMetres.concat(c.pointsMetres.map(p=>[p[0]+3,p[1]+3]),c.pointsMetres.map(p=>[p[0]-3,p[1]-3])));$('logicalEntranceResult').textContent='Proposed logical entrance · '+c.widthMetres.toFixed(3)+' m · caps '+c.capWitnesses.map(w=>'#'+w.handle).join(' / ')+'. '+c.reason;};$('logicalEntranceList').append(b);}
 for(const [i,c]of r.contacts.entries()){const o=document.createElement('option');o.value=String(i);o.textContent='#'+c.fromHandle+' → #'+c.toHandle+' · '+(c.gapMetres*1000).toFixed(4)+' mm';select.append(o);}
 for(const key of [...new Set([...r.assessment.missingLabels,...r.assessment.sharedLabels])]){const room=floor.regions.find(s=>s.roomKey===key);if(!room)continue;const b=document.createElement('button');b.textContent='Inspect '+room.number+' · '+(r.assessment.missingLabels.includes(key)?'boundary missing':'shared open area');b.onclick=()=>{pick('room',room);$('detail').textContent+=' Interpretation requires '+(r.assessment.missingLabels.includes(key)?'the remaining original enclosure contacts or entrance evidence.':'doorless entrance/partition ownership review; no wall or access is inferred.');};list.append(b);}
}
$('inspectSourceContact').onclick=()=>{const r=circulationInterpretation.floors.find(r=>r.floorId===floor.id),c=r?.contacts[Number($('sourceContact').value)];if(!c)return;$('drawing').querySelector('#sourceContactOverlay')?.remove();const g=node('g',{id:'sourceContactOverlay','pointer-events':'none'});for(const h of [c.fromHandle,c.toHandle]){const p=floor.primitives.find(p=>p.sourceHandle===h);if(p)g.append(line(p.pointsMetres,'#a136ae',2));}g.append(line(c.pointsMetres,'#ef288c',6));$('drawing').append(g);const p=c.pointsMetres[0];view=[project([p[0]-1.5,p[1]+1.5])[0],project([p[0]-1.5,p[1]+1.5])[1],3,3];update();$('sourceContactEvidence').textContent=(c.gapMetres*1000).toFixed(4)+' mm · exact original endpoint #'+c.fromHandle+' to finite segment #'+c.toHandle+'. Comparison join only; no physical wall thickness or routing permission assigned.';};
$('clearStairRiser').onclick=()=>{$('drawing').querySelector('#stairRiserOverlay')?.remove();$('stairRiserEvidence').textContent='Riser overlay cleared; compiled comparison retained.';};
$('clearLogicalEntrance').onclick=()=>{$('drawing').querySelector('#logicalEntranceOverlay')?.remove();$('logicalEntranceResult').textContent='Current compiled areas; proposed partition has not been applied.';};
$('clearSourceContact').onclick=()=>{$('drawing').querySelector('#sourceContactOverlay')?.remove();$('sourceContactEvidence').textContent='Original source strokes remain visible.';};
$('downloadInterpretation').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(circulationInterpretation,null,2)],{type:'application/json'}));a.download='cad-circulation-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
</script></html>`);
}
