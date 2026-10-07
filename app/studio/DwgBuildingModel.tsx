"use client";
import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import type {CadBuildingScene} from '../../lib/reviter/dwg-building-scene.ts';

export type CadPathPreview={floorId:string;points:[number,number][];lengthMetres:number;segments?:{floorId:string;points:[number,number][]}[];connections?:string[]};
export function DwgBuildingModel({buildings,initialBuildingCode,pathPreview}:{buildings:CadBuildingScene[];initialBuildingCode?:string;pathPreview?:CadPathPreview|null}){
 const [code,setCode]=useState(buildings.some(b=>b.code===initialBuildingCode)?initialBuildingCode!:buildings[0]?.code??'');
 const [floorId,setFloorId]=useState('all'),[spacing,setSpacing]=useState(4),[exploded,setExploded]=useState(false);
 const [paths,setPaths]=useState(true),[doorDisplay,setDoorDisplay]=useState('abstract'),[assumedStairs,setAssumedStairs]=useState(!!pathPreview?.connections?.length);
 const [surfaces,setSurfaces]=useState(true);
 const [walls,setWalls]=useState(true),[links,setLinks]=useState(true),[detail,setDetail]=useState('Drag to orbit · right-drag to pan · scroll to zoom. Select a recovered region to inspect it.'),[exporting,setExporting]=useState(false);
 const host=useRef<HTMLDivElement>(null),runtime=useRef<{fit:()=>void;lookDown:()=>void;fitPath:()=>void;inspectDoor:(id:string)=>void;root:THREE.Group;scene:THREE.Scene;render:()=>void}|null>(null);
 const building=buildings.find(b=>b.code===code)!;
 useEffect(()=>{
  const element=host.current;if(!element||!building)return;
  let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});}catch{setDetail('WebGL is unavailable. Floor plans remain available.');return;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));element.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','3D schematic of Building '+code);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#eef3f6');
  const camera=new THREE.PerspectiveCamera(42,1,.05,20000),controls=new OrbitControls(camera,renderer.domElement);
  controls.maxPolarAngle=Math.PI*.92;
  scene.add(new THREE.HemisphereLight(0xffffff,0x607080,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(30,70,20);scene.add(light);
  const root=new THREE.Group();root.userData={format:'reviter-cad-building-schematic',buildingCode:code,routingEligible:false,physicalElevationsMetres:null,
   reviewedFloorSurfacesVisible:surfaces,assumedStairConnectionsVisible:assumedStairs,heightsAreIllustrative:true,drawingLevelIntervalMetres:spacing,exploded,wallHeightMetres:2.7,doorHeightMetres:2.1,sourceScope:'DWG drawing reconstruction',
   sourceSha256:building.sourceSha256,geometrySha256:building.geometrySha256,supportingEvidence:building.evidenceNotes};scene.add(root);
  const render=()=>renderer.render(scene,camera);controls.addEventListener('change',render);
  const levelHeight=(id:string)=>{const floor=building.floors.find(f=>f.id===id)!;return (floor.ordinal-building.floors[0]!.ordinal)*spacing*(exploded?2.5:1);};
  const makeGeometry=(positions:Float32Array)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.computeVertexNormals();return g;};
  const mesh=(positions:Float32Array,color:number,opacity:number)=>new THREE.Mesh(makeGeometry(positions),new THREE.MeshStandardMaterial({color,roughness:.85,metalness:0,opacity,transparent:opacity<1,depthWrite:opacity===1,side:THREE.DoubleSide}));
  for(const floor of building.floors){
   if(floorId!=='all'&&floorId!==floor.id)continue;
   const group=new THREE.Group();group.name=floor.id;group.position.y=levelHeight(floor.id);
   group.userData={drawingFloorId:floor.id,drawingOrdinal:floor.ordinal,alignmentStatus:floor.alignmentStatus,physicalElevationMetres:null};root.add(group);
   for(const region of floor.regions){const object=mesh(region.positions,region.shared?0xc6aa63:0x69afa1,.36);object.userData={kind:'recovered-drawing-region',roomKey:region.roomKey,title:region.title,shared:region.shared,floorId:floor.id};group.add(object);}
   for(const s of floor.surfaces){
    if(surfaces){const object=mesh(s.positions,0x73b5a9,1);object.userData={kind:'reviewed-drawing-floor',id:s.id,roomKey:s.roomKey,title:s.title,floorId:floor.id,openToBelow:true,physicalSlabVerified:false,reason:s.reason,remainingReview:s.remainingReview};group.add(object);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(s.openingEdges,3));const edge=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xcf7a36}));edge.userData={kind:'protected-open-to-below-edge',surfaceId:s.id};group.add(edge);
   }
   if(walls&&floor.walls.length){const object=mesh(floor.walls,0x8a9baa,.4);object.userData={kind:'measured-wall-pair-candidates',materialVerified:false};group.add(object);}
   for(const door of floor.doorSymbols){const object=mesh(door.positions,0x259ac4,.6);object.userData={kind:'door-symbol-plane',nativeDoorIdentity:null,floorId:floor.id,id:door.id,handle:door.handle,widthMetres:door.widthMetres,supportingWallHandles:door.supportingWallHandles};group.add(object);}
   if(floor.stairs.length)group.add(mesh(floor.stairs,0x9c62bb,.45));
   for(const [positions,color]of [[doorDisplay==='architectural'?floor.source:floor.abstractSource,0x8b9ca8],[floor.treads,0x9e399e]] as const){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));group.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color,transparent:true,opacity:.65})));
   }
  }
  if(links&&floorId==='all')for(const link of building.links){
   const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(link.from[0],levelHeight(link.fromFloorId)+.1,-link.from[1]),new THREE.Vector3(link.to[0],levelHeight(link.toFloorId)+.1,-link.to[1])]);
   const line=new THREE.Line(g,new THREE.LineDashedMaterial({color:0xe27b16,dashSize:.3,gapSize:.18}));line.computeLineDistances();
   line.name=link.id;line.userData={kind:'stair-footprint-correspondence',...link,routingEligible:false,servedFloorsVerified:false,physicalElevations:null};root.add(line);
  }
  if(assumedStairs&&floorId==='all')for(const link of building.assumedLinks.filter(l=>!paths||!pathPreview?.connections?.length||pathPreview.connections.includes(l.id))){const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(link.from[0],levelHeight(link.fromFloorId)+.1,-link.from[1]),new THREE.Vector3(link.to[0],levelHeight(link.toFloorId)+.1,-link.to[1])]);const line=new THREE.Line(g,new THREE.LineDashedMaterial({color:0xd526cb,dashSize:.35,gapSize:.16,depthTest:false,transparent:true}));line.computeLineDistances();line.renderOrder=10;line.userData={kind:'user-assumed-stair-connection',...link,routingEligible:false,servedStopsVerified:false,physicalElevations:null};root.add(line);}
  const pathGroup=new THREE.Group();pathGroup.name='drawing-path-comparison';
  if(paths&&pathPreview){
   for(const part of pathPreview.segments??[{floorId:pathPreview.floorId,points:pathPreview.points}])if(building.floors.some(f=>f.id===part.floorId)&&(floorId==='all'||floorId===part.floorId)){
    const g=new THREE.BufferGeometry().setFromPoints(part.points.map(p=>new THREE.Vector3(p[0],levelHeight(part.floorId)+.12,-p[1]))),line=new THREE.Line(g,new THREE.LineBasicMaterial({color:0xd526cb,depthTest:false,depthWrite:false,transparent:true}));line.renderOrder=10;line.userData={kind:'drawing-path-comparison',floorId:part.floorId,routingEligible:false,horizontalLengthMetres:pathPreview.lengthMetres};pathGroup.add(line);
   }
   if(assumedStairs&&floorId==='all')for(const id of pathPreview.connections??[]){const l=building.assumedLinks.find(l=>l.id===id);if(!l)continue;
    const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(l.from[0],levelHeight(l.fromFloorId)+.12,-l.from[1]),new THREE.Vector3(l.to[0],levelHeight(l.toFloorId)+.12,-l.to[1])]),line=new THREE.Line(g,new THREE.LineDashedMaterial({color:0xd526cb,dashSize:.18,gapSize:.12,depthTest:false}));line.computeLineDistances();line.renderOrder=11;line.userData={kind:'assumed-path-floor-crossing',...l,routingEligible:false,physicalElevations:null};pathGroup.add(line);
   }
   root.add(pathGroup);
  }
  const fit=(object:THREE.Object3D=root)=>{
   const box=new THREE.Box3().setFromObject(object),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
   const distance=Math.max(size.x,size.z,size.y,1)*1.3/Math.min(1,camera.aspect);camera.position.copy(center).add(new THREE.Vector3(distance*.68,distance*.64,distance*.8));controls.target.copy(center);camera.near=Math.max(.01,distance/10000);camera.far=distance*25;camera.updateProjectionMatrix();controls.update();render();
  };
  const resize=()=>{camera.aspect=element.clientWidth/Math.max(element.clientHeight,1);camera.updateProjectionMatrix();renderer.setSize(element.clientWidth,element.clientHeight);render();};
  const observer=new ResizeObserver(()=>{resize();fit();});observer.observe(element);resize();fit();const inspectDoor=(id:string)=>{let target:THREE.Object3D|null=null;root.traverse(o=>{if(o.userData.kind==='door-symbol-plane'&&o.userData.id===id)target=o;});if(target){fit(target);describe(target);}};
  const describe=(object:THREE.Object3D)=>{const d=object.userData;if(d.kind==='door-symbol-plane')setDetail('Door #'+d.handle+' · '+d.floorId+' · measured width '+d.widthMetres.toFixed(3)+' m · wall supports '+d.supportingWallHandles.join(', ')+'. Abstract display retains door evidence. Physical access and floor support remain unverified.');else if(d.kind==='reviewed-drawing-floor')setDetail(d.title+' · '+d.floorId+' · centre open to below. '+d.reason+' Remaining review: '+d.remainingReview.join(' '));else setDetail(d.title+' · '+d.floorId+(d.shared?' · shared drawing region; partition unresolved':' · recovered drawing region')+'. Source floor support and physical enclosure remain unverified.');};
  const lookDown=()=>{const box=new THREE.Box3().setFromObject(root),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),distance=Math.max(size.z,size.x/Math.max(camera.aspect,.1),1)*1.4;camera.position.copy(center).add(new THREE.Vector3(0,distance,distance*.001));controls.target.copy(center);controls.update();render();};
  runtime.current={fit,lookDown,fitPath:()=>{if(pathGroup.children.length)fit(pathGroup);},inspectDoor,root,scene,render};
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let start:[number,number]=[0,0];
  const down=(e:PointerEvent)=>{start=[e.clientX,e.clientY];};
  const up=(e:PointerEvent)=>{
   if(Math.hypot(e.clientX-start[0],e.clientY-start[1])>5)return;
   const b=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);ray.setFromCamera(pointer,camera);
   const hit=ray.intersectObject(root,true).find(h=>['recovered-drawing-region','reviewed-drawing-floor','door-symbol-plane'].includes(h.object.userData.kind));
   if(hit)describe(hit.object);
  };
  renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);
  return ()=>{runtime.current=null;observer.disconnect();controls.dispose();root.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Line){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(m=>m.dispose());}});renderer.dispose();renderer.domElement.remove();};
 },[building,code,floorId,spacing,exploded,walls,links,paths,pathPreview,doorDisplay,assumedStairs,surfaces]);
 async function download(){const current=runtime.current;if(!current)return;setExporting(true);setDetail('Preparing the visible building schematic GLB…');try{
  const bytes=await new GLTFExporter().parseAsync(current.root,{binary:true});
  const url=URL.createObjectURL(new Blob([bytes as ArrayBuffer],{type:'model/gltf-binary'}));const a=document.createElement('a');a.href=url;a.download='Building-'+code+'.drawing-schematic.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  setDetail('Export prepared: '+a.download+' · includes illustrative height and source evidence metadata.');
 }catch(error){setDetail(error instanceof Error?error.message:'Unable to export 3D schematic.');}finally{setExporting(false);}}
 return <section className="cad-building-view">
  <aside aria-label="3D building controls">
   <h2>Assembled drawing geometry</h2>
   <label>Building<select aria-label="3D building" value={code} onChange={e=>{setCode(e.target.value);setFloorId('all');}}>{buildings.map(b=><option key={b.code} value={b.code}>Building {b.code}</option>)}</select></label>
   <label>Visible floors<select aria-label="Visible floors" value={floorId} onChange={e=>setFloorId(e.target.value)}><option value="all">All drawing floors</option>{building.floors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
   <label>Illustrative level interval (m)<input aria-label="Illustrative level interval (m)" type="number" min="3" max="12" step=".5" value={spacing} onChange={e=>setSpacing(Math.min(12,Math.max(3,Number(e.target.value)||4)))}/></label>
   <label>Door display<select aria-label="3D door display" value={doorDisplay} onChange={e=>setDoorDisplay(e.target.value)}><option value="abstract">Abstract thresholds</option><option value="architectural">Architectural swings</option></select></label>
   <details><summary>Inspect measured doors</summary><div className="cad-door-buttons">{building.floors.filter(f=>floorId==='all'||floorId===f.id).flatMap(f=>f.doorSymbols.map(d=><button type="button" key={d.id} onClick={()=>runtime.current?.inspectDoor(d.id)}>Door #{d.handle} · {f.name}</button>))}</div></details>
   <label><input type="checkbox" checked={exploded} onChange={e=>setExploded(e.target.checked)}/>Explode floor layers</label>
   <label><input type="checkbox" checked={walls} onChange={e=>setWalls(e.target.checked)}/>Show measured wall strips</label>
   {building.floors.some(f=>f.surfaces.length>0)&&<><label><input type="checkbox" checked={surfaces} onChange={e=>setSurfaces(e.target.checked)}/>Show reviewed floor surfaces</label><p>The orange inner edge is open to below. It stays excluded when this display is switched off.</p>{building.floors.flatMap(f=>f.surfaces.map(s=><p key={s.id}>{s.title}: {s.remainingReview.join(' ')}</p>))}</>}
   <label><input type="checkbox" checked={links} onChange={e=>setLinks(e.target.checked)}/>Show proposed stair links</label>
   {building.assumedLinks.length>0&&<><label><input type="checkbox" checked={assumedStairs} onChange={e=>setAssumedStairs(e.target.checked)}/>Show assumed aligned stair connections</label><p>Magenta dashed lines share an XY point inside both original stair footprints. Continuous flights are assumed; elevations and intermediate stops remain unknown. Select All drawing floors to compare. With a path active, only its stair crossings are shown.</p>{building.assumedLinks.map(l=><p key={l.id}>{l.family}: {l.fromFloorId} ↔ {l.toFloorId}{l.missingIntermediateOrdinals.length?' · intermediate stop unknown':''}.</p>)}</>}
   <label><input type="checkbox" checked={paths} onChange={e=>setPaths(e.target.checked)}/>Show drawing path comparison</label>
   {pathPreview&&<p>Drawing path on {pathPreview.floorId}: {pathPreview.lengthMetres.toFixed(1)} m. Magenta shows {pathPreview.segments?.length??1} floor segment(s) and {pathPreview.connections?.length??0} assumed stair crossing(s); stair rise, access and support remain unverified.</p>}
   <button type="button" onClick={()=>runtime.current?.fit()}>Fit building</button>
   <button type="button" onClick={()=>runtime.current?.lookDown()}>Look down at floor</button>
   {pathPreview&&<button type="button" disabled={!paths||!building.floors.some(f=>f.id===pathPreview.floorId)||(floorId!=='all'&&floorId!==pathPreview.floorId)} onClick={()=>runtime.current?.fitPath()}>Focus drawing path</button>}
   <button type="button" disabled={exporting} onClick={()=>void download()}>Download building schematic GLB</button>
   <p>{building.floors.length} drawing floors · {building.links.length} stair footprint correspondences · {building.stairFamilies.length} labelled stair families.</p>
   {building.floors.map(f=><p key={f.id}>{f.name}: {f.alignmentStatus} XY alignment.</p>)}
   <p>Grey: measured wall strips, possibly frames or glazing. Green/tan: recovered room regions. Blue: door symbols. Purple: flat stair/tread evidence. Orange dashed links: proposed floor correspondences.</p>
   <p>Floor spacing, 2.7 m walls and 2.1 m door planes are illustrative. Original XY shapes and holes are preserved. No stair rise, slab, served stop or route is certified by this view.</p>
   {building.evidenceNotes.length>0&&<><h3>Supporting building evidence</h3>{building.evidenceNotes.map((note,i)=><p key={i}>{note}</p>)}</>}
   {building.assumptionWarnings.map((w,i)=><p key={i}>{w}</p>)}
   {building.stairFamilies.filter(f=>f.missingDrawingOrdinals.length).map(f=><p key={f.family}>{f.family}: no labelled stop on drawing level {f.missingDrawingOrdinals.join(', ')}. That stop remains unknown; any assumption is shown separately in magenta.</p>)}
  </aside>
  <div className="cad-building-main"><div ref={host} className="cad-building-canvas"/><p role="status">{detail}</p></div>
 </section>;
}
