"use client";

import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {ConvertResult} from '../../lib/reviter/types.ts';
import {fitGeoreference,geographicToLocalMetres,georeferencedSceneMatrix,modelPointToGeographic,geoToMapPixel,mapPixelToGeo,type ModelGeoreference} from '../../lib/reviter/georeference.ts';
import {meshGroup} from './three-scene.ts';
import {directoryFloorPlanes,directoryRoomGroup,type DirectoryModelFloor} from './directory-model.ts';

type Runtime={scene:THREE.Scene;renderer:THREE.WebGLRenderer;camera:THREE.PerspectiveCamera;controls:OrbitControls;model:THREE.Group;root:THREE.Group;tiles:THREE.Group;matrix:THREE.Matrix4;frame:(top:boolean,floor?:DirectoryModelFloor|null)=>void;render:()=>void};
function disposeObject(root:THREE.Object3D){
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  root.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
}
function clipObject(root:THREE.Object3D,planes:THREE.Plane[]){
  root.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.clippingPlanes=planes;m.needsUpdate=true;}});
}

export default function GeoreferencedModelMap({result,reference,floor,basemap,onBasemapChange}:{result:ConvertResult;reference:ModelGeoreference;floor:DirectoryModelFloor|null;basemap:boolean;onBasemapChange:(visible:boolean)=>void}){
  const host=useRef<HTMLDivElement>(null),runtime=useRef<Runtime|null>(null);
  // A map datum below the lowest native level keeps basement and local-step surfaces visible.
  const initialBase=Math.min(0,...result.levels.map(l=>l.elevation).filter(Number.isFinite))-1;
  const [cutaway,setCutaway]=useState(false),[colors,setColors]=useState(true),[modelVisible,setModelVisible]=useState(true),[base,setBase]=useState(initialBase),[draftBase,setDraftBase]=useState(String(initialBase)),[failure,setFailure]=useState('');
  useEffect(()=>{
    const element=host.current;if(!element)return;
    if(!result.meshes.some(m=>m.indices.length>=3)){element.textContent='No recovered 3D geometry is loaded. The 2D map and reference points remain available.';return;}
    let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{element.textContent='The 3D map needs WebGL. The 2D map and reference points remain available.';return;}
    let disposed=false,request=0;
    const textures:THREE.Texture[]=[],scene=new THREE.Scene();scene.background=new THREE.Color('#dce5ea');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.localClippingEnabled=true;
    renderer.domElement.setAttribute('aria-label','Georeferenced Revit model on geographic map');renderer.domElement.setAttribute('role','application');renderer.domElement.tabIndex=0;element.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(45,1,.1,100000);camera.up.set(0,0,1);
    const controls=new OrbitControls(camera,renderer.domElement);controls.screenSpacePanning=false;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=2;controls.maxDistance=20000;
    const render=()=>{if(disposed||request)return;request=requestAnimationFrame(()=>{request=0;if(!disposed)renderer.render(scene,camera);});};
    const fit=fitGeoreference(reference),matrix=new THREE.Matrix4().fromArray(georeferencedSceneMatrix(fit,result.origin,base));
    const root=new THREE.Group();root.matrixAutoUpdate=false;root.matrix.copy(matrix);scene.add(root);
    const model=meshGroup(result,'technical');root.add(model);root.updateMatrixWorld(true);
    scene.add(new THREE.HemisphereLight(0xffffff,0x81909c,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-300,-400,800);scene.add(light);
    const box=new THREE.Box3().setFromObject(root),tiles=new THREE.Group();scene.add(tiles);
    // Cover the framed campus patch at a bounded tile count; no bulk/offline tile fetching.
    let zoom=17,low:[number,number],high:[number,number];
    const geo=(e:number,n:number)=>({latitude:fit.origin.latitude+n/6378137*180/Math.PI,longitude:fit.origin.longitude+e/(6378137*Math.cos(fit.origin.latitude*Math.PI/180))*180/Math.PI});
    do{const sw=geoToMapPixel(geo(box.min.x,box.min.y),zoom),ne=geoToMapPixel(geo(box.max.x,box.max.y),zoom);low=[Math.floor(sw[0]/256)-1,Math.floor(ne[1]/256)-1];high=[Math.floor(ne[0]/256)+1,Math.floor(sw[1]/256)+1];if((high[0]-low[0]+1)*(high[1]-low[1]+1)<=64)break;zoom--;}while(zoom>=2);
    if(zoom>=2)for(let x=low![0];x<=high![0];x++)for(let y=low![1];y<=high![1];y++){
      const count=2**zoom;if(y<0||y>=count)continue;
      const corners=[[x*256,y*256],[(x+1)*256,y*256],[(x+1)*256,(y+1)*256],[x*256,(y+1)*256]] as [number,number][];
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(corners.flatMap(p=>[...geographicToLocalMetres(mapPixelToGeo(p,zoom),fit),0]),3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));geometry.setIndex([0,2,1,0,3,2]);
      const material=new THREE.MeshBasicMaterial({color:0xd5dfdb,side:THREE.DoubleSide});
      const tile=new THREE.Mesh(geometry,material);tile.userData.url=`https://tile.openstreetmap.org/${zoom}/${((x%count)+count)%count}/${y}.png`;tiles.add(tile);
    }
    // Reference pairs remain visible at the map datum, independently of floor elevations.
    const markers=new THREE.Group();scene.add(markers);for(const point of reference.points){const p=geographicToLocalMetres(point.geographic,fit),q=geographicToLocalMetres(modelPointToGeographic(point.modelFeet,fit),fit);const sphere=new THREE.Mesh(new THREE.SphereGeometry(1.4,12,8),new THREE.MeshBasicMaterial({color:0x087d7b}));sphere.position.set(p[0],p[1],.8);markers.add(sphere);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p,1),new THREE.Vector3(...q,1)]),new THREE.LineBasicMaterial({color:0xd05266}));markers.add(line);}
    const frame=(top:boolean,selected?:DirectoryModelFloor|null)=>{const focus=selected?new THREE.Box3(new THREE.Vector3(selected.boundsFeet.min.x-result.origin.x,selected.boundsFeet.min.y-result.origin.y,selected.boundsFeet.min.z-result.origin.z),new THREE.Vector3(selected.boundsFeet.max.x-result.origin.x,selected.boundsFeet.max.y-result.origin.y,selected.boundsFeet.max.z-result.origin.z)).applyMatrix4(matrix):box;const centre=focus.getCenter(new THREE.Vector3()),size=focus.getSize(new THREE.Vector3());const distance=Math.max(size.x,size.y,size.z,20)/(2*Math.tan(THREE.MathUtils.degToRad(22.5)))*1.3/Math.min(camera.aspect,1);controls.target.copy(centre);camera.position.copy(centre).add(top?new THREE.Vector3(0,-distance*.001,distance):new THREE.Vector3(distance*.4,-distance*.7,distance*.7));camera.lookAt(centre);controls.update();render();};
    runtime.current={scene,renderer,camera,controls,model,root,tiles,matrix,frame,render};
    const resize=new ResizeObserver(()=>{const width=element.clientWidth,height=element.clientHeight;if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();render();});resize.observe(element);
    renderer.setSize(element.clientWidth,element.clientHeight);camera.aspect=element.clientWidth/element.clientHeight;camera.updateProjectionMatrix();frame(false);
    controls.addEventListener('change',render);
    const contextLost=(e:Event)=>{e.preventDefault();setFailure('The 3D graphics context was lost. Close and reopen the 3D map to retry.');};renderer.domElement.addEventListener('webglcontextlost',contextLost);
    // Store texture ownership on the tile group for the optional basemap effect and cleanup.
    tiles.userData.textures=textures;tiles.userData.isDisposed=()=>disposed;
    return()=>{disposed=true;cancelAnimationFrame(request);resize.disconnect();controls.dispose();renderer.domElement.removeEventListener('webglcontextlost',contextLost);disposeObject(scene);textures.forEach(t=>t.dispose());renderer.dispose();renderer.domElement.remove();runtime.current=null;};
  },[result,reference,base]);

  useEffect(()=>{const r=runtime.current;if(!r)return;r.tiles.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return;const m=o.material as THREE.MeshBasicMaterial;
    if(basemap&&!o.userData.texture){const texture=new THREE.TextureLoader().load(o.userData.url,()=>{if(r.tiles.userData.isDisposed())texture.dispose();else r.render();},undefined,()=>{if(!r.tiles.userData.isDisposed())setFailure('Some basemap tiles could not load; the georeferenced model remains available.');});texture.colorSpace=THREE.SRGBColorSpace;(r.tiles.userData.textures as THREE.Texture[]).push(texture);o.userData.texture=texture;}
    m.map=basemap?o.userData.texture??null:null;m.color.set(m.map?0xffffff:0xd5dfdb);m.needsUpdate=true;
  });r.render();},[basemap,result,reference,base]);
  useEffect(()=>{host.current?.closest('section')?.scrollIntoView({block:'start'});},[]);
  useEffect(()=>{const r=runtime.current;if(!r)return;const planes=cutaway&&floor?directoryFloorPlanes(floor,result.origin,floor.suggestedCutHeight??4).map(p=>p.applyMatrix4(r.matrix)):[];clipObject(r.model,planes);r.model.visible=modelVisible;let surfaces:THREE.Group|null=null;if(colors&&floor){surfaces=directoryRoomGroup(floor,result.origin,floor.selectedKey);r.root.add(surfaces);if(cutaway)clipObject(surfaces,planes);}r.render();return()=>{if(surfaces){r.root.remove(surfaces);disposeObject(surfaces);}};},[cutaway,colors,modelVisible,floor,result,reference,base]);
  return <section className="geo-3d-workspace" aria-label="3D model on map"><h3>3D model on map</h3><div className="geo-map-controls"><button className="rv-button" onClick={()=>{runtime.current?.frame(false,cutaway?floor:null);host.current?.closest('section')?.scrollIntoView({block:'start'});}}>Fit 3D view</button><button className="rv-button" onClick={()=>{runtime.current?.frame(true,cutaway?floor:null);host.current?.closest('section')?.scrollIntoView({block:'start'});}}>North-up top view</button><label><input type="checkbox" checked={cutaway} disabled={!floor} onChange={e=>setCutaway(e.target.checked)}/>Selected floor cutaway</label><label><input type="checkbox" checked={colors} disabled={!floor} onChange={e=>setColors(e.target.checked)}/>Selected floor colors</label><label><input type="checkbox" checked={modelVisible} onChange={e=>setModelVisible(e.target.checked)}/>Revit geometry</label><label><input type="checkbox" checked={basemap} onChange={e=>onBasemapChange(e.target.checked)}/>Basemap</label><label>Map plane elevation (model ft)<input aria-label="3D map plane elevation" type="number" step="any" value={draftBase} onChange={e=>setDraftBase(e.target.value)}/></label><button className="rv-button" onClick={()=>{const v=Number(draftBase);if(draftBase.trim()&&Number.isFinite(v)&&Math.abs(v)<1e6){setBase(v);setFailure('');}else setFailure('Enter a finite map plane elevation in model feet.');}}>Apply elevation</button></div><div className="geo-3d-map"><div ref={host} className="geo-3d-canvas"/><a className="geo-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div>{failure&&<p role="status">{failure}</p>}<p>Drag to orbit · right-drag to pan · scroll to zoom. North is +Y, east is +X. {floor?`Selected floor: ${floor.title}. `:''}The recovered Revit geometry uses your point-pair alignment; original floor heights are retained. The flat map plane starts below the lowest native level so lower floors remain visible; its elevation is a display datum, not surveyed terrain or sea level. Teal markers show map reference points; rose lines show alignment residuals. Room colors are review surfaces.</p></section>;
}
