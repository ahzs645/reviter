"use client";

import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ConvertResult } from "../../lib/reviter/types.ts";
import { createProjectPackage, projectPackageName } from "../../lib/reviter/project-package.ts";
import { downloadBlob } from "../../lib/reviter/export-naming.ts";
import {staticWorkerUrl} from './reference-model.ts';
import {
  cleanRoomBoundary, containsRoomPoint, containsDirectoryRoomPoint, isHallway, isWalkable, isPubliclyAccessible, parseRoomDirectory,
  directoryRoomArea, hallwayRouteComponents, roomBuilding, roomPortals, validRoomBoundary,
  type DirectoryRoom, type RoomDirectoryData, type RoomPoint,
} from "../../lib/reviter/room-directory.ts";

import {directoryStairFootprints,directoryUpperStairContext, nativeStairAtPoint,stairTreadVisibleInPlan,stairRoomsForSelection} from "../../lib/reviter/directory-stair-geometry.ts";
import {modelWalkwayCandidates,recoverModelWalkways}from "../../lib/reviter/model-walkways.ts";
import {recoverUnassignedCirculation} from "../../lib/reviter/unassigned-circulation.ts";
import { directoryOpenPassages } from "../../lib/reviter/directory-openings.ts";
import { architecturalPlanGeometry } from "../../lib/reviter/architectural-plan.ts";
import { connectHallwaysThroughFloor } from "../../lib/reviter/hallway-connections.ts";
import { auditDirectoryFloor, type DirectoryAudit } from "../../lib/reviter/directory-audit.ts";
import { directoryDoors, directoryDoorReviews, directoryStairs, findBuildingRoute, isStaircase, reviewedStairConnection, type ReviewedDoorLink } from "../../lib/reviter/directory-navigation.ts";
import { rebuildRoomBoundaries } from "../../lib/reviter/room-boundaries.ts";
import { directoryModelFloor, directoryModelStorey, directoryRoomFocusPoints, withLocalBuildingContext, type DirectoryModelFloor } from "./directory-model.ts";
import { AreaInspector } from "./AreaInspector.tsx";
import { CampusFloorEditor } from "./CampusFloorEditor.tsx";
import GeoreferenceWorkspace from "./GeoreferenceWorkspace.tsx";
import { DoorInspector } from "./DoorInspector.tsx";
import SourceCoverage from "./SourceCoverage.tsx";
import {LocalBuildingConnectionInspector} from "./LocalBuildingConnectionInspector.tsx";
import {localBuildingConnections,type LocalBuildingConnection,type BuildingLocation} from "../../lib/reviter/building-transitions.ts";
import {BuildingConnectionInspector} from "./BuildingConnectionInspector.tsx";
import {buildingConnections,type BuildingConnection}from "../../lib/reviter/building-connections.ts";
import {directoryLocation}from '../../lib/reviter/directory-location.ts';
import { directoryAreas, directoryAreaKind, connectedCirculationAreas, reportedCirculationRoomKeys } from "../../lib/reviter/directory-areas.ts";
import {zoomMapViewBox,wheelZoomFactor,zoomPendingMapView,type MapViewBox} from "../../lib/reviter/map-viewport.ts";

import { CAMPUS_BUILDING, campusFloors, campusFloorLabel } from "../../lib/reviter/campus-floors.ts";

const path = (polygon: readonly RoomPoint[]) => `${polygon.map((p, i) => `${i ? "L" : "M"}${p[0]},${-p[1]}`).join(" ")} Z`;
const buildingName = (room: DirectoryRoom) => room.dwg?.sectionId?.replace(/\s+(?:LVL|Base|Atrium|\d{4})\b.*$/i, "") ?? `Building ${roomBuilding(room)}`;
const floorName = (rooms: readonly DirectoryRoom[], id: number) => rooms.find(r=>r.levelId===id && r.dwg?.sectionId?.startsWith(`${roomBuilding(r)} `))?.dwg?.sectionId ?? rooms.find(r=>r.levelId===id)?.dwg?.sectionId ?? `Level ${id}`;

export function BuildingDirectory({ result, initialRoomFile, modelFile, onImportProject, onShowModel, roomRequest }: { modelFile?: File | null; onImportProject?: () => void; result: ConvertResult; initialRoomFile?: File | null; onShowModel: (floor: DirectoryModelFloor) => void; roomRequest: {key: string; sequence: number} | null }) {
  const [packaging, setPackaging] = useState(false);
  const [packageMessage, setPackageMessage] = useState("");
  const [data, setData] = useState<RoomDirectoryData | null>(null);
  const [georeferenceOpen,setGeoreferenceOpen]=useState(false);
  const [campusFloorEditorOpen, setCampusFloorEditorOpen] = useState(false);
  const [original, setOriginal] = useState<RoomDirectoryData | null>(null);
  const [building, setBuilding] = useState("");
  const [levelId, setLevelId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [startKey, setStartKey] = useState("");
  const [audit, setAudit] = useState<(DirectoryAudit & { doorReviews?: Map<string, ReturnType<typeof directoryDoorReviews>> }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [stairRoutes, setStairRoutes] = useState(true);
  const [stairVisible, setStairVisible] = useState<boolean|"with-upper-context">(true);
  const upperStairVisible=stairVisible==="with-upper-context";
  const [stairTarget, setStairTarget] = useState("");
  const [doorKey, setDoorKey] = useState<number | null>(null);
  const [connectionDoorKey,setConnectionDoorKey]=useState<number|null>(null);
  const [buildingContext,setBuildingContext]=useState(true);
  const [doorPair, setDoorPair] = useState<[string,string]>(["", ""]);
  const checkGeneration = useRef(0);
  const [connections, setConnections] = useState(true);
  const [wallsVisible, setWallsVisible] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [labels, setLabels] = useState(true);
  const [sourceLabels, setSourceLabels] = useState(false);
  const [connectedCirculation, setConnectedCirculation] = useState(true);
  const [circulationOnly, setCirculationOnly] = useState(false);
  const [hideStaff, setHideStaff] = useState(true);
  const [editing, setEditing] = useState(false);
  const showArea = (room: DirectoryRoom) => editing || (!hideStaff || isPubliclyAccessible(room)) && (!circulationOnly || isWalkable(room) && (directoryAreaKind(room) !== "room" || connectedCirculation && circulationReviewKeys.has(room.key)));
  const [mapExpanded, setMapExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [mapView,setMapView]=useState<{scope:string;bounds:MapViewBox}|null>(null);
  const [sectionFocus,setSectionFocus]=useState<{scope:string;section:string}|null>(null);
  const [pickedLocation,setPickedLocation]=useState<{point:RoomPoint;levelId:number;building:string;roomKeys:string[]}|null>(null);
  const pan=useRef<{id:number;start:RoomPoint;bounds:MapViewBox;inverse:DOMMatrix;scope:string}|null>(null);
  const panMoved=useRef(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<RoomPoint[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const connectionsDetails = useRef<HTMLDetailsElement>(null);
  const doorReviewPanel=useRef<HTMLElement>(null);
  const importedRoomFile = useRef<File | null>(null);
  const importGeneration = useRef(0);
  const rooms = useMemo(() => data?.annotations.filter((r) => r.status !== "deleted") ?? [], [data?.annotations]);
  const buildings = useMemo(() => {
    const names = new Map<string, string>();
    for (const room of rooms) if (!names.has(roomBuilding(room)) || room.dwg?.sectionId) names.set(roomBuilding(room), buildingName(room));
    return [...names.entries()].sort();
  }, [rooms]);
  const campus = building === CAMPUS_BUILDING;
  const campusLevels = useMemo(() => campusFloors(rooms, result.levels, data?.campusStoreys), [rooms, result.levels, data?.campusStoreys]);
  const campusLevel = campusLevels.find(l => l.levelIds.includes(levelId ?? -1));
  const buildingRooms = useMemo(() => rooms.filter((r) => campus || roomBuilding(r) === building), [rooms, building, campus]);
  const nativeLevels = useMemo(() => [...new Set(buildingRooms.map((r) => r.levelId))].sort((a, b) => {
    const elevation = (id: number) => result.levels.find((l) => l.levelId === id)?.elevation ?? id;
    return elevation(a) - elevation(b);
  }), [buildingRooms, result]);
  const levels = campus ? campusLevels.map(l=>l.levelId) : nativeLevels;
  const floorIds = useMemo(()=>campus&&campusLevel?campusLevel.levelIds:levelId==null?[]:[levelId],[campus,campusLevel,levelId]);
  const displayLevel = (id:number)=>campus?campusLevels.find(l=>l.levelIds.includes(id))?.levelId??id:id;
  const floorRooms = useMemo(() => buildingRooms.filter((r) => floorIds.includes(r.levelId)), [buildingRooms, floorIds]);
  const baseFloor = useMemo(() => {
    const floor = levelId == null ? null : campus&&campusLevel?directoryModelStorey(result,floorRooms,floorIds,selectedKey,campusLevel.name):directoryModelFloor(result, floorRooms, levelId, selectedKey);
    return floor ? {...floor, areaMetadata: data?.areaMetadata} : null;
  }, [result, floorRooms, levelId, selectedKey, data?.areaMetadata,campus,campusLevel,floorIds]);
  const selectedArea = baseFloor?.areas.find(a=>a.roomKeys.includes(selectedKey));
  const [handledRoomRequest, setHandledRoomRequest] = useState<typeof roomRequest>(null);
  if (roomRequest && roomRequest !== handledRoomRequest) {
    const room = rooms.find(r=>r.key===roomRequest.key);
    if (room) {
      setHandledRoomRequest(roomRequest);
      setSelectedKey(room.key); setLevelId(room.levelId); setBuilding(roomBuilding(room));
      setMapExpanded(false); setDraft(cleanRoomBoundary(room.polygonFeet)); setEditing(true); setZoom(2); setDoorKey(null);
    }
  }
  const geometry = useMemo(() => {
    if (levelId == null) return null;
    try { return architecturalPlanGeometry(result, levelId); } catch { return null; }
  }, [result, levelId]);
  const references = useMemo(() => data?.boundaryReference?.sections.filter((s) => floorIds.includes(s.levelId) && floorRooms.some((r) => r.dwg?.sectionId === s.sectionId)) ?? [], [data, floorIds, floorRooms]);
  const nativeWalls=useMemo(()=>{
    if(!baseFloor)return[];const b=baseFloor.boundsFeet;
    return floorIds.flatMap(id=>architecturalPlanGeometry(result,id).walls).filter(w=>{const xs=w.polygon.map(p=>p[0]),ys=w.polygon.map(p=>p[1]);return Math.min(...xs)<=b.max.x&&Math.max(...xs)>=b.min.x&&Math.min(...ys)<=b.max.y&&Math.max(...ys)>=b.min.y;})??[];
  },[baseFloor,result,floorIds]);
  const mapRooms = useMemo(() => floorRooms.filter((r, i) => !r.circulationGroup || floorRooms.findIndex((other) => other.circulationGroup === r.circulationGroup) === i), [floorRooms]);
  const selected = rooms.find((r) => r.key === selectedKey);
  const selectedAliases = new Set(buildingRooms.filter((r) => r.key === selectedKey || !!selected?.circulationGroup && r.circulationGroup === selected.circulationGroup).map((r) => r.key));
  const doorsByLevel = useMemo(() => {
    const map = new Map<number, ReturnType<typeof directoryDoors>>();
    for (const id of new Set(rooms.map(r => r.levelId))) {
      try { map.set(id, directoryDoors(result, id)); } catch { map.set(id, []); }
    }
    return map;
  }, [result, rooms]);
  const campusConnectionsByLevel=useMemo(()=>new Map([...doorsByLevel].map(([id,doors])=>{
    const candidates=rooms.filter(r=>r.levelId===id),reviews=directoryDoorReviews(candidates,doors,data?.navigation?.doorLinks);
    const cross=reviews.filter(d=>d.portal&&new Set(d.portal.rooms.map(k=>roomBuilding(candidates.find(r=>r.key===k)!))).size===2);
    const endpoints=candidates.filter(r=>cross.some(d=>d.portal!.rooms.includes(r.key)));
    const placements=directoryModelFloor(result,endpoints,id,null)?.roomElevations??{};
    return [id,buildingConnections(candidates,cross,placements,architecturalPlanGeometry(result,id))] as const;
  })),[doorsByLevel,rooms,data?.navigation?.doorLinks,result]);
  const floorBuildingConnections=useMemo(()=>floorIds.flatMap(id=>campusConnectionsByLevel.get(id)??[]).filter(c=>(campus||c.rooms.some(r=>roomBuilding(r)===building))&&(!hideStaff||c.rooms.every(isPubliclyAccessible))),[campusConnectionsByLevel,floorIds,building,campus,hideStaff]);
  const pickedCrossings=pickedLocation?.building===building&&floorIds.includes(pickedLocation.levelId)?floorBuildingConnections.filter(c=>Math.hypot(c.door.door.point[0]-pickedLocation.point[0],c.door.door.point[1]-pickedLocation.point[1])<6).sort((a,b)=>Math.hypot(a.door.door.point[0]-pickedLocation.point[0],a.door.door.point[1]-pickedLocation.point[1])-Math.hypot(b.door.door.point[0]-pickedLocation.point[0],b.door.door.point[1]-pickedLocation.point[1])):[];
  const localConnections=useMemo(()=>localBuildingConnections(result,rooms,data?.buildingTransitions??[]),[result,rooms,data?.buildingTransitions]);
  const floorLocalConnections=useMemo(()=>localConnections.filter(c=>c.endpoints.some(e=>(campus||e.building===building)&&floorIds.includes(e.levelId))),[localConnections,building,floorIds,campus]);
  const displayedLocalConnections=floorLocalConnections.filter(c=>campus||buildingContext||c.endpoints.every(e=>e.building===building));
  const pickedLocalTread=pickedLocation&&floorLocalConnections.flatMap(c=>c.treads.map(t=>({connection:c,tread:t}))).find(({tread})=>containsRoomPoint(pickedLocation.point,tread.polygon));
  const adjoiningRooms=useMemo(()=>!campus&&buildingContext?[...new Map([...floorBuildingConnections.flatMap(c=>c.rooms.filter(r=>roomBuilding(r)!==building)),...floorLocalConnections.flatMap(c=>c.endpoints.flatMap(e=>e.building!==building&&e.room?[e.room]:[]))].map(r=>[r.key,r])).values()]:[],[floorBuildingConnections,floorLocalConnections,buildingContext,building,campus]);
  const mapReferences=useMemo(()=>[...new Map([...references,...(data?.boundaryReference?.sections.filter(s=>(s.levelId===levelId&&adjoiningRooms.some(r=>r.dwg?.sectionId===s.sectionId)||!campus&&buildingContext&&floorLocalConnections.some(c=>c.endpoints.some(e=>e.building!==building&&e.levelId===s.levelId&&s.sectionId.startsWith(`${e.building} `)))))??[])].map(s=>[s.sectionId,s])).values()],[references,data?.boundaryReference,levelId,adjoiningRooms,buildingContext,floorLocalConnections,building,campus]);
  const mapAdjoiningRooms=!campus&&buildingContext?[...new Map([...adjoiningRooms,...rooms.filter(r=>roomBuilding(r)!==building&&mapReferences.some(s=>s.levelId===r.levelId&&s.sectionId===r.dwg?.sectionId))].map(r=>[r.key,r])).values()]:[];
  const activeConnection=floorBuildingConnections.find(c=>c.door.door.id===connectionDoorKey);
  const reviewsByLevel = useMemo(() => new Map([...doorsByLevel].map(([id, doors]) => [id, audit?.doorReviews?.get(`${building}:${id}`) ?? directoryDoorReviews(buildingRooms.filter(r => r.levelId === id), doors, data?.navigation?.doorLinks)])), [doorsByLevel, buildingRooms, data?.navigation, audit, building]);
  const portalsByLevel = useMemo(() => new Map([...reviewsByLevel].map(([id, reviews]) => [id, reviews.flatMap(r => r.portal ? [r.portal] : [])])), [reviewsByLevel]);
  const openingsByLevel = useMemo(() => new Map([...reviewsByLevel.keys()].map(id => [id,directoryOpenPassages(buildingRooms.filter(r=>r.levelId===id),data?.navigation?.openLinks??[],data?.boundaryReference,architecturalPlanGeometry(result,id))])),[reviewsByLevel,buildingRooms,data,result]);
  const routeOpeningsByLevel = useMemo(()=>new Map([...portalsByLevel].map(([id,p])=>[id,[...p,...openingsByLevel.get(id)??[]]])),[portalsByLevel,openingsByLevel]);
  const openings = useMemo(()=>floorIds.flatMap(id=>openingsByLevel.get(id)??[]),[openingsByLevel,floorIds]);
  const walkwayCandidates = useMemo(()=>levelId==null?[]:modelWalkwayCandidates(result,rooms,building,levelId),[result,rooms,building,levelId]);
  const doors = [...new Map(floorIds.flatMap(id=>doorsByLevel.get(id)??[]).map(d=>[d.id,d])).values()];
  const portals = useMemo(() => floorIds.flatMap(id=>portalsByLevel.get(id)??[]), [portalsByLevel, floorIds]);
  const modelFloor = useMemo(() => baseFloor ? {...baseFloor, portals, openings, connectedCirculation,areaRelationships:data?.areaRelationships} : null, [baseFloor, portals, openings, connectedCirculation,data?.areaRelationships]);
  const publicAreas=modelFloor?.areas.filter(a=>a.roomKeys.every(k=>isPubliclyAccessible(rooms.find(r=>r.key===k)!)))??[];
  const circulationReviewKeys = reportedCirculationRoomKeys(publicAreas,data?.areaRelationships);
  const pickedAccessReview=pickedLocation&&data?.accessReviewLocations?.find(r=>r.levelId===pickedLocation.levelId&&(campus||r.building===building)&&Math.hypot(r.point[0]-pickedLocation.point[0],r.point[1]-pickedLocation.point[1])<=2);
  const circulationContext = useMemo(() => connectedCirculation && modelFloor ? connectedCirculationAreas(modelFloor.areas, portals, selectedKey,modelFloor.areaRelationships,openings) : new Set<string>(), [modelFloor, portals, openings, selectedKey, connectedCirculation]);
  const nearbyReviews = [...new Map(floorIds.flatMap(id=>(reviewsByLevel.get(id)??[]).map(d=>({...d,nativeLevelId:id}))).map(d=>[d.door.id,d])).values()].map(d=>({...d,...floorBuildingConnections.find(c=>c.levelId===d.nativeLevelId&&c.door.door.id===d.door.id)?.door})).filter(d => d.candidates.length || floorRooms.some(r => containsDirectoryRoomPoint(d.door.point, r)));
  const selectedPortals = portalsByLevel.get(selected?.levelId ?? -1) ?? [];
  const pickedDoor = nearbyReviews.find(d => d.door.id === doorKey);
  const stairs = useMemo(() => directoryStairs(result, rooms, data?.navigation?.stairLinks), [result, rooms, data?.navigation]);
  const stairGeometry = useMemo(()=>({footprints:directoryStairFootprints(result,floorRooms),upper:directoryUpperStairContext(result,floorRooms,baseFloor?.roomElevations)}),[result,floorRooms,baseFloor?.roomElevations]);
  const stairFootprints=stairGeometry.footprints,upperStairContext=stairGeometry.upper;
  const selectedUpperStairs=upperStairContext.filter(c=>selectedKey?c.roomKeys.includes(selectedKey):true);
  const upperContextCutHeight=upperStairVisible&&selectedUpperStairs.length?Math.ceil(Math.max(4,...selectedUpperStairs.flatMap(c=>c.treads.map(t=>t.elevation-(modelFloor?.cutBaseElevation??modelFloor?.elevation??0)+.5)))*2)/2:4;
  const pickedNativeStair=useMemo(()=>!!pickedLocation&&floorIds.includes(pickedLocation.levelId)&&pickedLocation.building===building?nativeStairAtPoint(result,pickedLocation.levelId,pickedLocation.point,.75):null,[result,pickedLocation,floorIds,building]);
  const pickedFloorOpening=floorRooms.find(r=>r.floorOpeningsFeet?.some(h=>!!pickedLocation&&floorIds.includes(pickedLocation.levelId)&&containsRoomPoint(pickedLocation.point,h)));
  const pickedStairSource=pickedNativeStair?stairFootprints.find(f=>f.stairElementIds.includes(pickedNativeStair.stairElementId)):undefined;
  const pickedStairLink=pickedNativeStair?stairs.find(s=>s.stairElementId===pickedNativeStair.stairElementId):undefined;
  const floorStairs = stairs.filter(s => s.levels.some(id=>floorIds.includes(id)) && s.rooms.some(k => floorRooms.some(r => r.key === k)));
  const navigationElevations = useMemo(() => Object.assign({},...nativeLevels.map(id=>directoryModelFloor(result,buildingRooms,id,null)?.roomElevations??{})),[result,buildingRooms,nativeLevels]);
  const navigationBarriers = useMemo(()=>new Map(nativeLevels.map(id=>[id,architecturalPlanGeometry(result,id)])),[result,nativeLevels]);
  const networks = useMemo(() => campus ? [] : hallwayRouteComponents(floorRooms, [...portals,...openings],navigationElevations,navigationBarriers.get(levelId??-1)), [floorRooms, portals, openings,navigationElevations,navigationBarriers,levelId,campus]);
  const buildingRoute = useMemo(() => startKey && selectedKey && startKey !== selectedKey ? findBuildingRoute(campus?buildingRooms.filter(r=>roomBuilding(r)===roomBuilding(rooms.find(r=>r.key===startKey)!)):buildingRooms, routeOpeningsByLevel, stairs, startKey, selectedKey, stairRoutes,navigationElevations,navigationBarriers) : null, [buildingRooms, routeOpeningsByLevel, stairs, startKey, selectedKey, stairRoutes,navigationElevations,navigationBarriers,campus,rooms]);
  const activeLegs = useMemo(() => buildingRoute?.legs.filter(l => floorIds.includes(l.levelId)) ?? [], [buildingRoute, floorIds]);
  const route = activeLegs[0]?.route ?? null;
  const floorAudit = audit?.floors.find(f => f.building === building && f.levelId === levelId);
  const flagged = new Set(floorAudit?.issues.map(i => i.roomKey));
  const updateData = useCallback((next: Parameters<typeof setData>[0]) => {
    checkGeneration.current++; setAudit(null); setChecking(false); setCheckProgress(""); setReviewOnly(false); setData(next);
  }, []);
  const visible = useMemo(() => buildingRooms.filter(r => !reviewOnly || audit?.floors.some(f => f.issues.some(i => i.roomKey === r.key))).filter((r) => `${r.number ?? ""} ${r.name ?? ""} ${r.dwg?.sectionId ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (a.number ?? "").localeCompare(b.number ?? "", undefined, { numeric: true })), [buildingRooms, query, reviewOnly, audit]);
  const fittedBounds = useMemo<MapViewBox>(() => {
    const focus = zoom === 3 && route ? floorRooms.filter((r) => activeLegs.some(l=>l.route.roomKeys.includes(r.key)))
      : zoom > 1 && !!selected && floorIds.includes(selected.levelId) ? [selected] : floorRooms;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const focusPoints = [...(zoom===2 && !editing && selected && baseFloor ? directoryRoomFocusPoints(baseFloor,selected) : focus.flatMap(r=>r.polygonFeet))];
    if(zoom===2&&!editing&&selected&&upperStairVisible)focusPoints.push(...upperStairContext.filter(c=>c.roomKeys.includes(selected.key)).flatMap(c=>c.treads.flatMap(t=>t.polygon)));
    for (const [x, y] of focusPoints) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    if (zoom === 3) for (const [x, y] of activeLegs.flatMap(l => l.route.points)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    if (!Number.isFinite(minX)) return [0, 0, 100, 100];
    const pad = zoom > 1 ? 12 : 8;
    return [minX - pad, -maxY - pad, Math.max(1, maxX - minX) + pad * 2, Math.max(1, maxY - minY) + pad * 2];
  }, [floorRooms, selected, zoom, route, floorIds, activeLegs, baseFloor, editing,upperStairVisible,upperStairContext]);
  const viewScope=JSON.stringify([building,campus?campusLevel?.levelId??levelId:levelId]);
  const bounds=mapView?.scope===viewScope?mapView.bounds:fittedBounds;
  const liveView=useRef<{scope:string;bounds:MapViewBox}>({scope:viewScope,bounds});
  const gestureFrame=useRef<number|null>(null),gestureTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const zoomOutput=useRef<HTMLOutputElement>(null);
  const cancelGesture=useCallback(()=>{
    if(gestureFrame.current!=null)cancelAnimationFrame(gestureFrame.current);
    if(gestureTimer.current!=null)clearTimeout(gestureTimer.current);
    gestureFrame.current=null;gestureTimer.current=null;
  },[]);
  useLayoutEffect(()=>{
    cancelGesture();liveView.current={scope:viewScope,bounds};
    svg.current?.setAttribute('viewBox',bounds.join(' '));
    if(zoomOutput.current)zoomOutput.current.textContent=`${Math.round(fittedBounds[2]/bounds[2]*100)}%`;
  },[bounds,viewScope,fittedBounds,cancelGesture]);
  const currentBounds=()=>liveView.current.scope===viewScope?liveView.current.bounds:bounds;
  const zoomMap=useCallback((factor:number,anchor?:RoomPoint)=>{
    cancelGesture();const current=liveView.current.scope===viewScope?liveView.current.bounds:bounds;
    const next={scope:viewScope,bounds:zoomMapViewBox(current,factor,anchor??[current[0]+current[2]/2,current[1]+current[3]/2],fittedBounds)};
    liveView.current=next;setMapView(next);
  },[bounds,fittedBounds,viewScope,cancelGesture]);
  useEffect(()=>{
    const element=svg.current;if(!element)return;
    const wheel=(e:WheelEvent)=>{
      if(editing)return;e.preventDefault();
      const inverse=element.getScreenCTM()?.inverse();if(!inverse)return;
      const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(inverse),v=element.viewBox.baseVal;
      const drawn:MapViewBox=[v.x,v.y,v.width,v.height],live=liveView.current;
      if(live.scope!==viewScope||!drawn[2]||!drawn[3])return;
      liveView.current={scope:viewScope,bounds:zoomPendingMapView(live.bounds,drawn,[p.x,p.y],wheelZoomFactor(e.deltaY,e.deltaMode,element.clientHeight),fittedBounds)};
      if(gestureFrame.current==null)gestureFrame.current=requestAnimationFrame(()=>{
        gestureFrame.current=null;const next=liveView.current;
        element.setAttribute('viewBox',next.bounds.join(' '));
        if(zoomOutput.current)zoomOutput.current.textContent=`${Math.round(fittedBounds[2]/next.bounds[2]*100)}%`;
      });
      if(gestureTimer.current!=null)clearTimeout(gestureTimer.current);
      gestureTimer.current=setTimeout(()=>{gestureTimer.current=null;setMapView(liveView.current);},120);
    };
    element.addEventListener('wheel',wheel,{passive:false});
    return()=>{element.removeEventListener('wheel',wheel);cancelGesture();};
  },[fittedBounds,viewScope,editing,mapExpanded,cancelGesture]);
  function resetMap(nextZoom:number){
    setSectionFocus(null);
    cancelGesture();liveView.current={scope:viewScope,bounds:fittedBounds};
    svg.current?.setAttribute('viewBox',fittedBounds.join(' '));
    if(zoomOutput.current)zoomOutput.current.textContent='100%';
    setZoom(nextZoom);setMapView(null);
  }
  function focusPlanSection(section:string){
    if(!section){resetMap(1);return;}
    const points=floorRooms.filter(r=>r.dwg?.sectionId===section).flatMap(r=>r.polygonFeet);
    if(!points.length)return;
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    cancelGesture();setZoom(1);setSectionFocus({scope:viewScope,section});
    setMapView({scope:viewScope,bounds:[Math.min(...xs)-8,-Math.max(...ys)-8,Math.max(...xs)-Math.min(...xs)+16,Math.max(...ys)-Math.min(...ys)+16]});
  }
  useEffect(()=>{if(doorKey!=null&&!mapExpanded&&connectionsDetails.current){connectionsDetails.current.open=true;doorReviewPanel.current?.scrollIntoView({block:'nearest'});}},[doorKey,mapExpanded]);
  const fontSize = Math.max(1.1, Math.min(3, bounds[2]! / 140));

  const load = useCallback(async (file: File) => {
    const generation = ++importGeneration.current;
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error("This room file exceeds the 64 MB import limit.");
      const next = parseRoomDirectory(await file.text());
      if (generation !== importGeneration.current) return;
      const levelIds = new Set(result.nativeAssociatedLevelRelations?.map((r) => r.levelId));
      if (next.annotations.some((r) => !levelIds.has(r.levelId))) throw new Error("Some room levels do not belong to the open Revit model. Open the matching RVT first.");
      const active = next.annotations.filter((r) => r.status !== "deleted");
      if (!active.length) throw new Error("This file contains no active room boundaries.");
      updateData(next); setOriginal(next); setBuilding(roomBuilding(active[0]!)); setLevelId(active[0]!.levelId);
      setSelectedKey(""); setStartKey(""); setDoorKey(null); setReviewOnly(false); setDraft(null); setEditing(false); setZoom(1); setMapView(null); setPickedLocation(null); setCampusFloorEditorOpen(false);
      setMessage(`Loaded ${active.length.toLocaleString()} rooms from ${file.name}. Door links use the open Revit model; check alignment before using a route.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, [result, updateData]);
  useEffect(() => {
    if (!initialRoomFile || importedRoomFile.current === initialRoomFile) return;
    importedRoomFile.current = initialRoomFile;
    void load(initialRoomFile);
  }, [initialRoomFile, load]);
  async function checkBuildings() {
    if (!data || checking) return;
    const generation = ++checkGeneration.current;
    setChecking(true); setAudit(null);
    const groups = new Map<string, typeof rooms>();
    for (const room of rooms) { const key = `${roomBuilding(room)}:${room.levelId}`; groups.set(key, [...groups.get(key) ?? [], room]); }
    const floors: DirectoryAudit["floors"] = [];
    const doorReviews = new Map<string, ReturnType<typeof directoryDoorReviews>>();
    try {
      for (const group of groups.values()) {
        setCheckProgress(`Checking ${roomBuilding(group[0]!)} · ${group[0]!.dwg?.sectionId ?? group[0]!.levelId} (${floors.length + 1}/${groups.size})`);
        await new Promise(resolve => setTimeout(resolve, 20));
        if (generation !== checkGeneration.current) return;
        const reviews = directoryDoorReviews(group, doorsByLevel.get(group[0]!.levelId) ?? [], data.navigation?.doorLinks);
        doorReviews.set(`${roomBuilding(group[0]!)}:${group[0]!.levelId}`, reviews);
        const floor=directoryModelFloor(result,group,group[0]!.levelId,null);
        const checked=auditDirectoryFloor(group, [...reviews.flatMap(r => r.portal ? [r.portal] : []),...directoryOpenPassages(group,data.navigation?.openLinks??[],data.boundaryReference,architecturalPlanGeometry(result,group[0]!.levelId))], reviews, stairs, data.boundaryReference,floor?.roomElevations,architecturalPlanGeometry(result,group[0]!.levelId));
        const sections=data.boundaryReference?.sections.filter(s=>s.levelId===group[0]!.levelId&&group.some(r=>r.dwg?.sectionId===s.sectionId))??[];
        const walls=architecturalPlanGeometry(result,group[0]!.levelId).walls;
        checked.wallContext={drawingSegments:sections.reduce((n,s)=>n+s.wallSegments.length,0),missingDrawingSections:[...new Set(group.map(r=>r.dwg?.sectionId).filter((s):s is string=>!!s))].filter(s=>!sections.some(v=>v.sectionId===s)),nativeWalls:floor?walls.filter(w=>w.polygon.some(([x,y])=>x>=floor.boundsFeet.min.x&&x<=floor.boundsFeet.max.x&&y>=floor.boundsFeet.min.y&&y<=floor.boundsFeet.max.y)).length:0,slabMatches:floor?group.filter(r=>floor.roomElevations[r.key]?.evidence.startsWith('Recovered slab')).length:0};
        floors.push(checked);
      }
      if (generation === checkGeneration.current) { setAudit({version: 1, checkedAt: new Date().toISOString(), floors, doorReviews}); setCheckProgress(`Checked ${new Set(rooms.map(roomBuilding)).size} buildings and ${floors.length} building floors.`); }
    } catch (error) { setCheckProgress(error instanceof Error ? error.message : String(error)); }
    finally { if (generation === checkGeneration.current) setChecking(false); }
  }
  function inspectDoor(id: number) {
    const door = nearbyReviews.find(d => d.door.id === id); if (!door) return;
    setDoorKey(id); setDoorPair(door.portal?.rooms ?? [door.candidates[0] ?? "", door.candidates[1] ?? ""]);
    setEditing(false); setDraft(null);
  }
  function focusDoor(){if(!pickedDoor)return;const [x,y]=pickedDoor.door.point;setMapView({scope:viewScope,bounds:[x-12,-y-12,24,24]});}
  function saveDoor() {
    if (!data || !pickedDoor) return;
    const link: ReviewedDoorLink = {doorId: pickedDoor.door.id, levelId:pickedDoor.nativeLevelId, rooms: doorPair};
    const review = directoryDoorReviews([...floorRooms,...adjoiningRooms].filter(r=>r.levelId===link.levelId), [pickedDoor.door], [link])[0];
    if (!review?.portal) { setMessage("Choose two different room boundaries at this model door opening."); return; }
    updateData({...data, navigation: {...data.navigation, version: 1, doorLinks: [...data.navigation?.doorLinks.filter(l => l.doorId !== link.doorId || l.levelId !== link.levelId) ?? [], link]}});
    setMessage("Door connection saved. Export rooms to keep it with your boundary edits.");
  }
  function jumpToFloor(id: number) { setLevelId(displayLevel(id)); setZoom(3); setEditing(false); setDraft(null); setDoorKey(null); }
  async function rebuildFloor() {
    if (!data?.boundaryReference || !geometry || rebuilding) return;
    setRebuilding(true); setMessage("Tracing survey walls and door openings…");
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const rebuilt = rebuildRoomBoundaries(floorRooms, data.boundaryReference, geometry);
      const connected = connectHallwaysThroughFloor(rebuilt.rooms, roomPortals(rebuilt.rooms, doors), { ...geometry, doors: geometry.doors.map(door => ({...door, polygon: doors.find(d=>d.id===door.elementId)?.footprint ?? door.polygon})) }, rooms, navigationElevations);
      const replacements = new Map(connected.rooms.map((r) => [r.key, r]));
      updateData({ ...data, annotations: [...data.annotations.map((r) => replacements.get(r.key) ?? r), ...connected.rooms.filter((r) => !data.annotations.some((old) => old.key === r.key))] });
      setDraft(null); setEditing(false);
      setMessage(`Rebuilt ${rebuilt.rebuilt} boundaries from registered walls. ${rebuilt.unresolved.length} retained for review. ${connected.added} floor connections added; ${connected.unresolvedNetworks} hallway network${connected.unresolvedNetworks === 1 ? "" : "s"} remaining. Export rooms to keep these changes.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setRebuilding(false); }
  }
  async function connectFloor() {
    if (!data || !geometry || rebuilding) return;
    setRebuilding(true); setMessage("Tracing walkable floor connections…");
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const connected = connectHallwaysThroughFloor(floorRooms, portals, { ...geometry, doors: geometry.doors.map(door => ({...door, polygon: doors.find(d=>d.id===door.elementId)?.footprint ?? door.polygon})) }, rooms, navigationElevations);
      updateData({ ...data, annotations: [...data.annotations, ...connected.rooms.filter((r) => !data.annotations.some((old) => old.key === r.key))] });
      setMessage(`Added ${connected.added} connections across recovered floor geometry. ${connected.unresolvedNetworks} hallway network${connected.unresolvedNetworks === 1 ? "" : "s"} remaining. Inferred strips show the route footprint; review their full hallway width.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setRebuilding(false); }
  }
  function choose(room: DirectoryRoom,focus=true) {
    if(focus)setSectionFocus(null);
    cancelGesture();setMapView(focus?null:{scope:viewScope,bounds:[...currentBounds()]});
    setStairTarget(""); setDoorKey(null); setSelectedKey(room.key); setLevelId(displayLevel(room.levelId)); if(!campus)setBuilding(roomBuilding(room)); setDraft(null); setEditing(false); if(focus)setZoom(2);
  }
  function pointer(e: { clientX: number; clientY: number }): RoomPoint | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return [p.x, -p.y];
  }
  function saveBoundary() {
    if (!draft || !selected || !data) return;
    const polygon = cleanRoomBoundary(draft);
    if (!validRoomBoundary(polygon)) { setMessage("The boundary crosses itself or has too little area. Adjust the vertices before saving."); return; }
    if ((selected.holesFeet ?? []).some((hole) => hole.some((p, i) => {
      const q = hole[(i + 1) % hole.length]!;
      return !containsRoomPoint(p, polygon) || !containsRoomPoint([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], polygon);
    }))) { setMessage("Keep enclosed rooms and columns inside the hallway's outer boundary."); return; }
    if (floorRooms.filter((r) => r.key === selected.key || !!selected.circulationGroup && r.circulationGroup === selected.circulationGroup).some((r) => !containsRoomPoint(r.labelPointFeet, polygon))) { setMessage("Keep every room label inside its boundary before saving."); return; }
    updateData({ ...data, annotations: data.annotations.map((r) => r.key === selected.key || !!selected.circulationGroup && r.circulationGroup === selected.circulationGroup ? {
      ...r, polygonFeet: polygon, boundaryReview: undefined, source: { ...(r.source as Record<string, unknown> ?? {}), polygon: "manual" },
      updatedAt: new Date().toISOString(),
    } : r) });
    setDraft(null); setEditing(false); setMessage("Boundary saved in this session. Export rooms to keep the change.");
  }

  function changeBuilding(nextBuilding: string) {
    const next = rooms.find((r) => nextBuilding === CAMPUS_BUILDING || roomBuilding(r) === nextBuilding);
    const keepLevel = rooms.some(r => r.levelId === levelId && (nextBuilding === CAMPUS_BUILDING || roomBuilding(r) === nextBuilding));
    startTransition(() => {
    setSectionFocus(null);
    if(nextBuilding===CAMPUS_BUILDING&&!campus)setLabels(false);
    const targetLevel=keepLevel?levelId:next?.levelId??null;
    setBuilding(nextBuilding); setLevelId(nextBuilding===CAMPUS_BUILDING?campusLevels.find(l=>l.levelIds.includes(targetLevel??-1))?.levelId??targetLevel:targetLevel); setDoorKey(null);
    setSelectedKey(""); setStartKey(""); setEditing(false); setDraft(null); setZoom(1);setMapView(null);setPickedLocation(null);
    });
  }
  function changeFloor(nextLevel: number) {
    startTransition(() => {
    setSectionFocus(null);
    setLevelId(nextLevel); setConnectionDoorKey(null); setDoorKey(null); if (campus || !buildingRoute) setSelectedKey("");
    setEditing(false); setDraft(null); setZoom(1);setMapView(null);setPickedLocation(null);
    });
  }
  function focusBuildingConnection(connection:BuildingConnection,other?:DirectoryRoom){
    setSectionFocus(null);
    const local=other??(connection.rooms.find(r=>roomBuilding(r)===building)??connection.rooms[0])!;
    if(other)choose(other);
    else {setSelectedKey(local.key);setDoorKey(null);setEditing(false);setDraft(null);}
    setBuildingContext(true);setConnectionDoorKey(connection.door.door.id);
    const points=connection.rooms.flatMap(r=>r.polygonFeet),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    setMapView({scope:JSON.stringify([campus?CAMPUS_BUILDING:roomBuilding(local),displayLevel(connection.levelId)]),bounds:[Math.min(...xs)-4,-Math.max(...ys)-4,Math.max(...xs)-Math.min(...xs)+8,Math.max(...ys)-Math.min(...ys)+8]});
  }

  function focusLocalConnection(connection:LocalBuildingConnection,endpoint?:BuildingLocation){
    setSectionFocus(null);
    const local=endpoint??(connection.endpoints.find(e=>e.building===building)??connection.endpoints[0])!;
    if(!campus)setBuilding(local.building);setLevelId(displayLevel(local.levelId));setSelectedKey(local.roomKey??"");
    setPickedLocation({point:local.point,building:campus?CAMPUS_BUILDING:local.building,levelId:local.levelId,roomKeys:local.roomKey?[local.roomKey]:[]});
    setBuildingContext(true);setDoorKey(null);setConnectionDoorKey(null);setEditing(false);setDraft(null);
    const [x0,y0,x1,y1]=connection.bounds;
    setMapView({scope:JSON.stringify([campus?CAMPUS_BUILDING:local.building,displayLevel(local.levelId)]),bounds:[x0,-y1,x1-x0,y1-y0]});
  }
  function openAdjoiningRoom(room:DirectoryRoom){
    const c=floorBuildingConnections.find(c=>c.rooms.some(r=>r.key===room.key));
    if(c)focusBuildingConnection(c,room);
    else {const local=floorLocalConnections.find(c=>c.endpoints.some(e=>e.roomKey===room.key));if(local)focusLocalConnection(local,local.endpoints.find(e=>e.roomKey===room.key));else choose(room);}
  }

  function recoverCrosswalks(){
    if(!data||levelId==null)return;
    const recovered=recoverModelWalkways(result,data.annotations,{building,levelId,elementIds:walkwayCandidates});
    if(!recovered.length){setMessage("No additional unlabelled crosswalk floor surfaces were found on this level. Existing boundaries and native slab holes are retained.");return;}
    const addedAreas=directoryAreas(recovered,Object.fromEntries(recovered.map(r=>[r.key,{elevation:r.modelSurface!.elevationFeet}])));
    const metadata={...data.areaMetadata};for(const area of addedAreas)metadata[area.key]={...metadata[area.key],name:`Building ${building} · Level #${levelId} atrium crosswalks`,elementIds:[...new Set(recovered.map(r=>r.modelSurface!.elementId))],notes:"Recovered from this level’s native Revit floor surfaces. Existing annotated spaces, walls, columns and slab openings are preserved. These surfaces have no imported room number; door and landing alignment still need review."};
    updateData({...data,annotations:[...data.annotations,...recovered],areaMetadata:metadata});
    setSelectedKey(recovered[0]!.key);setMessage(`Recovered ${recovered.length} crosswalk regions from native floor geometry. Export rooms with edits to preserve them.`);
  }

  async function recoverPickedCirculation(){
    if(!data||!pickedLocation||levelId==null||rebuilding)return;
    setRebuilding(true);setMessage("Checking the registered boundary and native floor at the pin…");
    await new Promise(resolve=>setTimeout(resolve,30));
    try {
      const recovered=recoverUnassignedCirculation(result,data.annotations,data.boundaryReference,{building,levelId,point:pickedLocation.point});
      if(!recovered.room){setMessage(recovered.reason??"This boundary needs manual review.");return;}
      updateData({...data,annotations:[...data.annotations,recovered.room]});
      setPickedLocation({...pickedLocation,roomKeys:[recovered.room.key]});setSelectedKey(recovered.room.key);
      setMessage(`Recovered ${(directoryRoomArea(recovered.room)*.092903).toFixed(1)} m² of circulation at the pin from registered boundaries and native floor support. Export rooms with edits to preserve it.`);
    } catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setRebuilding(false);}
  }

  const exportProject = async (prepareIndoor=false) => {
    if (!modelFile || !data || packaging) return;
    setPackaging(true); setPackageMessage("Packaging original Revit model, floor reviews and GIS references…");
    try {
      let prepared:Parameters<typeof createProjectPackage>[2];
      if(prepareIndoor){
        const source=new Uint8Array(await modelFile.arrayBuffer());
        prepared=await new Promise<NonNullable<Parameters<typeof createProjectPackage>[2]>>((resolve,reject)=>{
          const worker=new Worker(staticWorkerUrl('indoor')??new URL('../../lib/reviter/indoor-worker.ts',import.meta.url),{type:'module'});
          worker.onmessage=event=>{const message=event.data;if(message.type==='progress')setPackageMessage(message.message);else{worker.terminate();if(message.type==='complete')resolve({indoor:message.indoor,scene:message.scene});else reject(new Error(message.message));}};
          worker.onerror=event=>{worker.terminate();reject(new Error(event.message||'Indoor preparation failed.'));};
          worker.onmessageerror=()=>{worker.terminate();reject(new Error('The indoor worker returned an unreadable result.'));};
          try{worker.postMessage({model:result,rooms:data,source},[source.buffer]);}catch(error){worker.terminate();reject(error);}
        });
      }
      const bytes = await createProjectPackage(modelFile, data,prepared);
      downloadBlob(new Blob([bytes.slice().buffer as ArrayBuffer], {type:"application/zip"}), projectPackageName(modelFile.name));
      setPackageMessage(`Project exported · ${data.annotations.length.toLocaleString()} source records · ${data.georeference?.points.length ?? 0} GIS reference points.${prepared?` Prepared ${prepared.indoor.nodes.length.toLocaleString()} navigation nodes for OpenIndoorMaps · ${prepared.indoor.issues.length} review items.`:' Open the ZIP to restore the model and reviews together.'}`);
    } catch (error) {
      setPackageMessage(error instanceof Error ? error.message : String(error));
    } finally { setPackaging(false); }
  };
  return <section className={`building-directory${mapExpanded ? " directory-expanded" : ""}`} aria-label="Building directory">
    {!mapExpanded && <aside className="directory-sidebar">
      <header><h2>Building directory</h2><p>Rooms, hallway access, and boundary review</p></header>
      <input ref={input} type="file" accept=".json" className="visually-hidden" tabIndex={-1} aria-hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void load(file); e.target.value = ""; }} />
      <button className="rv-button" onClick={() => input.current?.click()}>Import room annotations</button>
      {data && <>
        <label>Building<select aria-label="Building" value={building} onChange={(e) => changeBuilding(e.target.value)}><option value={CAMPUS_BUILDING}>All buildings · Campus map</option>{buildings.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Floor<select aria-label="Floor" value={(campus?campusLevel?.levelId:levelId) ?? ""} onChange={(e) => changeFloor(Number(e.target.value))}>
          {levels.map((id) => <option key={id} value={id}>{campus ? campusFloorLabel(campusLevels.find(l=>l.levelId===id)!) : `${floorName(buildingRooms,id)} · #${id}`}</option>)}
        </select></label>
        <section className="directory-audit" aria-label="Building checks">
          <h3>Building checks</h3>
          <button className="rv-button" disabled={checking} onClick={() => void checkBuildings()}>{checking ? "Checking buildings…" : "Check all buildings"}</button>
          <p role="status">{checkProgress || "Check boundaries, hallway routes, doors and staircase entrances for every imported building."}</p>
          {audit && <>
            <p><strong>{audit.floors.reduce((n,f)=>n+f.routesPassed,0)} / {audit.floors.reduce((n,f)=>n+f.destinations,0)} room routes found</strong> · {audit.floors.reduce((n,f)=>n+f.issues.length,0)} review flags</p>
            <details><summary>Results by building and floor</summary><div className="directory-check-results">{audit.floors.map(f => <button key={`${f.building}:${f.levelId}`} onClick={() => { setBuilding(f.building); setLevelId(f.levelId); setQuery(""); setSelectedKey(""); setStartKey(""); setDoorKey(null); setReviewOnly(true); setEditing(false); setZoom(1); setMapView(null); setPickedLocation(null); }}><strong>{f.building} · {rooms.find(r=>roomBuilding(r)===f.building && r.levelId===f.levelId)?.dwg?.sectionId ?? f.levelId}</strong><span>{f.routesPassed}/{f.destinations} room routes · {f.networks} hallway networks · {f.issues.length} flags</span>{f.wallContext&&<span>{f.wallContext.drawingSegments.toLocaleString()} drawing wall segments · {f.wallContext.nativeWalls} native walls{!f.wallContext.slabMatches?' · Slab association needs review':''}{f.wallContext.missingDrawingSections.length?` · ${f.wallContext.missingDrawingSections.length} missing drawing sections`:''}</span>}</button>)}</div></details>
            {floorAudit && <><p><strong>This floor: {floorAudit.routesPassed}/{floorAudit.destinations} room routes</strong> · {floorAudit.networks} hallway {floorAudit.networks === 1 ? "network" : "networks"} · {floorAudit.issues.length} review flags.</p><p>{floorAudit.connectedDoors} linked doors · {floorAudit.unresolvedDoors} doors to review · {floorAudit.stairLinks} stair {floorAudit.stairLinks === 1 ? "connection" : "connections"}.</p></>}
            <button className="rv-button" onClick={() => downloadBlob(new Blob([JSON.stringify({...audit,doorReviews:undefined},null,2)],{type:"application/json"}), "building-checks.json")}>Export building checks</button>
          </>}
        </section>
        <SourceCoverage data={data} building={building} records={buildingRooms.filter(r=>!!r.dwg?.sectionId).length}/>
        <button className="rv-button" disabled={campus || !references.length || rebuilding} onClick={() => void rebuildFloor()}>{rebuilding ? "Rebuilding…" : "Rebuild floor boundaries"}</button>
        <button className="rv-button" disabled={campus || !geometry || rebuilding || networks.length < 2} onClick={() => void connectFloor()}>Connect hallway gaps</button>
        {!references.length && <p className="directory-count">Add a registered wall reference to rebuild boundaries. You can still review the model walls and edit corners.</p>}
        {!!networks.length && <div className="directory-network-status" role="status">
          <strong>{networks.length === 1 ? "Hallway routes form one connected network" : `${networks.length} separate hallway networks`}</strong>
          {networks.length > 1 && <p>Review the separated sections and their door openings.</p>}
          {networks.length > 1 && networks.map((keys, i) => <button key={keys[0]} onClick={() => { const r = floorRooms.find((r) => r.key === keys[0]); if (r) choose(r); }}>Section {i + 1} · {keys.length} hallway{keys.length === 1 ? "" : "s"}</button>)}
        </div>}
        <details ref={connectionsDetails} className="directory-connection-review"><summary>Doors and staircases · {nearbyReviews.filter(d=>!d.portal).length} doors to review</summary>
          <p>{nearbyReviews.filter(d=>!!d.portal).length} linked doors · {floorStairs.length} native stair connections on this floor</p>
          <label className="directory-toggle"><input type="checkbox" checked={stairRoutes} onChange={e=>setStairRoutes(e.target.checked)} />Use stairs in routes</label>
          <div className="directory-door-list">{nearbyReviews.map(d=><button key={d.door.id} onClick={()=>inspectDoor(d.door.id)}>Door #{d.door.id} · {d.portal ? d.portal.rooms.map(k=>rooms.find(r=>r.key===k)?.number).join(" ↔ ") : d.state === "ambiguous" ? "Choose connected rooms" : "Missing room boundary"}</button>)}</div>
          {pickedDoor && <article ref={doorReviewPanel} className="directory-door-review"><strong>Door #{pickedDoor.door.id}</strong><p>Select the two rooms whose boundaries meet this opening.</p>{[0,1].map(i=><label key={i}>Door side {i+1}<select aria-label={`Door side ${i+1}`} value={doorPair[i]} onChange={e=>setDoorPair(p=>i===0?[e.target.value,p[1]]:[p[0],e.target.value])}><option value="">Choose a room</option>{pickedDoor.candidates.map(k=><option key={k} value={k}>{rooms.find(r=>r.key===k)?.number} · {rooms.find(r=>r.key===k)?.name}</option>)}</select></label>)}
            {pickedDoor.candidates.length<2 && <p>Edit the missing or misaligned room boundary before linking this opening.</p>}
            {!pickedDoor.door.footprint && <p>This door has an approximate opening outline. Check its placement against the walls.</p>}
            <button className="rv-button" onClick={()=>setDoorKey(null)}>Close door inspection</button>
            <button className="rv-button" disabled={pickedDoor.candidates.length<2 || !doorPair[0] || !doorPair[1] || doorPair[0]===doorPair[1]} onClick={saveDoor}>Save door connection</button>
            {pickedDoor.portal?.reviewed && <button className="rv-button" onClick={()=>{ if(data)updateData({...data,navigation:{...data.navigation,version:1,doorLinks:data.navigation?.doorLinks.filter(l=>l.doorId!==pickedDoor.door.id || l.levelId!==pickedDoor.nativeLevelId)??[]}}); }}>Reset to automatic door match</button>}
          </article>}
          <div className="directory-stair-list">{floorStairs.map(s=>{const key=s.rooms.find(k=>!floorIds.includes(rooms.find(r=>r.key===k)?.levelId??-1))??s.rooms.find(k=>k!==selectedKey)??s.rooms[1];const other=rooms.find(r=>r.key===key)!;return <button key={s.id} onClick={()=>choose(other)}>Stairs to {other.number} · {other.dwg?.sectionId ?? other.levelId}{s.evidence==="reviewed"?" · reviewed":""}</button>;})}</div>
          {floorRooms.filter(isStaircase).filter(r=>!floorStairs.some(s=>s.rooms.includes(r.key))).map(r=><button key={r.key} onClick={()=>choose(r)}>Review staircase {r.number} · no matched flight to another floor</button>)}
        </details>
        {audit && <label className="directory-toggle"><input type="checkbox" checked={reviewOnly} onChange={e=>setReviewOnly(e.target.checked)} />Show rooms needing review</label>}
        <label>Find a room<input placeholder="Room number, name, or floor" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <p className="directory-count">{query.trim()?`${visible.length} matching source records`:`${floorRooms.length} source records`} · {modelFloor?.areas.length??floorRooms.length} areas on this floor</p>
        {selected && <article className="directory-selection">
          <h3>{selected.number || "Unnumbered room"}</h3><p>{selected.name || "Unnamed room"}</p>
          <p>Source record{selectedArea && selectedArea.kind!=="room" ? ` within ${data?.areaMetadata?.[selectedArea.key]?.name || selectedArea.title}` : ""}</p>
          <dl><div><dt>Source record area</dt><dd>{(directoryRoomArea(selected) * 0.092903).toFixed(1)} m²</dd></div><div><dt>Boundary confidence</dt><dd>{Math.round(selected.confidence * 100)}%</dd></div>
            <div><dt>Boundary source</dt><dd>{(selected.source as Record<string, unknown> | undefined)?.polygon === "vector-walls" ? "Registered walls" : (selected.source as Record<string, unknown> | undefined)?.polygon === "manual" ? "Manual edit" : (selected.source as Record<string, unknown> | undefined)?.polygon === "native-floor-connection" || selected.modelSurface ? "Recovered model floor" : "Imported"}</dd></div>
            <div><dt>Recovered door links</dt><dd>{selectedPortals.filter((p) => p.rooms.some((key) => selectedAliases.has(key))).length}</dd></div></dl>
          {(selected.source as Record<string, unknown> | undefined)?.polygon === "native-floor-connection" && <p>This connection follows recovered floor geometry around obstacles. The strip marks a route footprint; its full hallway width needs review.</p>}
          {typeof (selected.boundaryReview as Record<string, unknown> | undefined)?.note === "string" && <p className="directory-issue">{(selected.boundaryReview as { note: string }).note}</p>}
          {audit?.floors.flatMap(f=>f.issues).filter(i=>i.roomKey===selected.key).map((issue,i)=><p key={i} className="directory-issue">{issue.message}</p>)}
          {isStaircase(selected) && stairs.filter(s=>s.rooms.includes(selected.key)).map(s=>{const neighbour=rooms.find(r=>r.key===s.rooms.find(k=>k!==selected.key))!;return <button key={s.id} className="directory-access" onClick={()=>choose(neighbour)}>Take stairs to {neighbour.number} · {neighbour.dwg?.sectionId ?? neighbour.levelId}</button>;})}
          {isStaircase(selected) && <details><summary>Review staircase connection</summary><p>Link an entrance on another floor after checking that this staircase continues to it. The entrances must overlap in plan.</p><label>Staircase on another floor<select value={stairTarget} onChange={e=>setStairTarget(e.target.value)}><option value="">Choose an entrance</option>{buildingRooms.filter(r=>r.key!==selected.key && reviewedStairConnection(result,rooms,{rooms:[selected.key,r.key]})).map(r=><option key={r.key} value={r.key}>{r.number} · {r.dwg?.sectionId ?? r.levelId}</option>)}</select></label><button className="rv-button" disabled={!stairTarget} onClick={()=>{if(!data)return;const roomsPair:[string,string]=[selected.key,stairTarget];if(!reviewedStairConnection(result,rooms,{rooms:roomsPair}))return;updateData({...data,navigation:{...data.navigation,version:1,doorLinks:data.navigation?.doorLinks??[],stairLinks:[...data.navigation?.stairLinks?.filter(s=>!s.rooms.every(k=>roomsPair.includes(k)))??[],{rooms:roomsPair}]}});setMessage("Reviewed staircase connection saved. Export rooms to keep it.");}}>Save reviewed stair connection</button></details>}
          {stairs.filter(s=>s.evidence==="reviewed" && s.rooms.includes(selected.key)).map(s=><button key={s.id} onClick={()=>{if(data)updateData({...data,navigation:{...data.navigation,version:1,doorLinks:data.navigation?.doorLinks??[],stairLinks:data.navigation?.stairLinks?.filter(l=>!l.rooms.every(k=>s.rooms.includes(k)))??[]}});}}>Remove reviewed staircase connection</button>)}
          {selected.circulationGroup && <p>Shares a continuous hallway region with {floorRooms.filter((r) => r.circulationGroup === selected.circulationGroup && r.key !== selected.key).map((r) => r.number).join(", ")}.</p>}
          {selectedPortals.filter((p) => p.rooms.some((key) => selectedAliases.has(key))).map((portal) => {
            const neighbour = rooms.find((r) => r.key === portal.rooms.find((key) => !selectedAliases.has(key)));
            return neighbour && <button key={portal.doorId} className="directory-access" onClick={() => choose(neighbour)}>Door to {neighbour.number} · {neighbour.name || "room"}</button>;
          })}
          <button className="rv-button" disabled={!isWalkable(selected)} onClick={() => { setStartKey(selected.key); setZoom(1); }}>Start here</button>
          {startKey && <p>From {rooms.find((r) => r.key === startKey)?.number || "selected room"} <button onClick={() => setStartKey("")}>Clear</button></p>}
          {startKey && startKey !== selectedKey && <div role="status" className="directory-route-status">{buildingRoute
            ? <>Approx. {(buildingRoute.distanceFeet * 0.3048).toFixed(0)} m · {buildingRoute.transitions.length ? `${buildingRoute.transitions.length} staircase transition${buildingRoute.transitions.length===1?"":"s"}` : "on this floor"}.
              <ol>{buildingRoute.steps.map((step,i)=>step.kind==="floor" ? <li key={i}><button onClick={()=>jumpToFloor(step.levelId)}>Show {buildingRooms.find(r=>r.levelId===step.levelId)?.dwg?.sectionId ?? `floor ${step.levelId}`}</button><p>{step.route.roomKeys.map(key=>rooms.find(r=>r.key===key)?.number??"Hallway").join(" → ")}</p></li> : <li key={i}>Take stairs from {rooms.find(r=>r.key===step.fromKey)?.number} to {rooms.find(r=>r.key===step.toKey)?.number}{step.connection.evidence==="reviewed" ? " (reviewed connection)" : ""}. <button onClick={()=>jumpToFloor(rooms.find(r=>r.key===step.toKey)!.levelId)}>Show arrival floor</button></li>)}</ol>
</>
            : campus && roomBuilding(selected)!==roomBuilding(rooms.find(r=>r.key===startKey)!) ? "Full routes between buildings are not available yet. Select a purple building connection to inspect its verified local crossing." : "No connected route found. Review the door openings, hallway seams and staircase entrances."}</div>}
          {!editing ? <button className="rv-button" disabled={!floorIds.includes(selected.levelId)} onClick={() => { setDraft(cleanRoomBoundary(selected.polygonFeet)); setEditing(true); setZoom(2); }}>Edit boundary</button> : <>
            <p>Drag a corner or use arrow keys to move it ¼ foot. Double-click an edge to add a corner. Alt-click or Delete removes a corner.</p>
            <button className="rv-button" onClick={saveBoundary}>Save boundary</button><button className="rv-button" onClick={() => { setDraft(null); setEditing(false); }}>Cancel</button>
          </>}
          {original && <button className="directory-reset" onClick={() => {
            const source = original.annotations.find((r) => r.key === selected.key); if (!source) return;
            updateData((current) => current && ({ ...current, annotations: current.annotations.map((r) => {
              if (r.key !== source.key && (!selected.circulationGroup || r.circulationGroup !== selected.circulationGroup)) return r;
              return original.annotations.find((o) => o.key === r.key) ?? r;
            }) }));
            setDraft(null); setEditing(false); setMessage("Restored the imported boundary and its provenance.");
          }}>Restore imported boundary</button>}
        </article>}
        <div className="directory-room-list" aria-label="Room directory">{!query.trim() && modelFloor?.areas.filter(a=>a.kind!=="room" && (!reviewOnly||a.roomKeys.some(k=>visible.some(r=>r.key===k)))).map(area=><button key={area.key} aria-pressed={selectedArea?.key===area.key} onClick={()=>{const room=floorRooms.find(r=>r.key===area.roomKeys[0]);if(room)choose(room);}}><strong>{data?.areaMetadata?.[area.key]?.name||area.title}</strong><small>{area.roomKeys.length} source records · {(area.areaFeet*.092903).toFixed(1)} m²</small></button>)}{visible.filter(r=>query.trim() || r.levelId===levelId&&directoryAreaKind(r)==="room").map((room) => <button key={room.key} aria-pressed={selectedKey === room.key} onClick={() => choose(room)}>
          <span>{isHallway(room) ? "↔ " : ""}{room.number || "Unnumbered"}</span><strong>{room.name || "Unnamed room"}</strong>
          <small>{room.dwg?.sectionId ?? `Level ${room.levelId}`}{room.confidence < .75 ? " · Review boundary" : ""}</small>
        </button>)}{!visible.length && <p>No matching rooms.</p>}</div>
        <button className="rv-button" onClick={() => {
          downloadBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), "rooms.directory-edited.json");
          setMessage("Room annotations exported with boundary edits and original provenance.");
        }}>Export rooms with edits</button>
      </>}
      <p role="status" className="directory-message">{message || "Import the rooms JSON supplied with your building. Changes stay in this session until exported."}</p>
    </aside>}
    <div className="directory-map-panel">
      {data ? <>
        {mapExpanded && <div className="directory-map-overview">
          <label>Map building<select aria-label="Map building" value={building} onChange={e=>changeBuilding(e.target.value)}><option value={CAMPUS_BUILDING}>All buildings · Campus map</option>{buildings.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
          <label>Map floor<select aria-label="Map floor" value={(campus?campusLevel?.levelId:levelId) ?? ""} onChange={e=>changeFloor(Number(e.target.value))}>{levels.map(id=><option key={id} value={id}>{campus ? campusFloorLabel(campusLevels.find(l=>l.levelId===id)!) : `${floorName(buildingRooms,id)} · #${id}`}</option>)}</select></label>
          <p>{campus ? `Campus · ${campusLevel?.name ?? "Native level"} · ${floorRooms.length} source records · ${campusLevel?.buildings.length ?? 0} ${campusLevel?.buildings.length === 1 ? "building" : "buildings"}` : [...new Set(floorRooms.map(r=>r.dwg?.sectionId).filter(Boolean))].join(" · ")}</p>
          {floorAudit && <p>{floorAudit.routesPassed}/{floorAudit.destinations} destination routes · {floorAudit.networks} hallway networks · {floorAudit.connectedDoors} linked doors · {floorAudit.stairLinks} stair connections · {floorAudit.issues.length} review flags</p>}
        </div>}
        <div className="directory-map-toolbar">
          <button className="rv-button" aria-pressed={campus} onClick={()=>{changeBuilding(CAMPUS_BUILDING);setMapExpanded(true);}}>Campus map</button>
          {campus&&<><button className="rv-button" disabled={levels.indexOf(levelId??-1)<=0} onClick={()=>changeFloor(levels[levels.indexOf(levelId!)-1]!)}>Previous level</button><button className="rv-button" disabled={levels.indexOf(levelId??-1)>=levels.length-1} onClick={()=>changeFloor(levels[levels.indexOf(levelId!)+1]!)}>Next level</button></>}
          {new Set(floorRooms.map(r=>r.dwg?.sectionId).filter(Boolean)).size>1&&<label className="directory-section-picker">Plan section<select aria-label="Plan section" value={sectionFocus?.scope===viewScope?sectionFocus.section:""} onChange={e=>focusPlanSection(e.target.value)}><option value="">Whole floor</option>{[...new Set(floorRooms.map(r=>r.dwg?.sectionId).filter((s):s is string=>!!s))].map(s=><option key={s} value={s}>{s} · {floorRooms.filter(r=>r.dwg?.sectionId===s).length} {floorRooms.filter(r=>r.dwg?.sectionId===s).length===1?'record':'records'}</option>)}</select></label>}
          {!campus&&<button className="rv-button" disabled={!walkwayCandidates.length||editing} onClick={recoverCrosswalks}>Recover crosswalks</button>}
          {onImportProject&&<button className="rv-button" onClick={onImportProject} disabled={packaging}>Import project ZIP</button>}
          <button className="rv-button" onClick={()=>void exportProject()} disabled={!modelFile||packaging||editing}>{packaging?"Exporting project…":"Export project ZIP"}</button>
          <button className="rv-button" onClick={()=>void exportProject(true)} disabled={!modelFile||packaging||editing||(data.georeference?.points.length??0)<2}>Prepare OpenIndoorMaps project</button>
          <button className="rv-button" aria-pressed={georeferenceOpen} disabled={editing} onClick={()=>setGeoreferenceOpen(v=>!v)}>Georeference model</button>
          <button className="rv-button" aria-pressed={campusFloorEditorOpen} disabled={editing} onClick={()=>setCampusFloorEditorOpen(v=>!v)}>Assign campus floors</button>
          <button className="rv-button" aria-pressed={mapExpanded} onClick={()=>setMapExpanded(v=>!v)}>{mapExpanded ? "Show room review" : "Expand map"}</button>
          <button className="rv-button" onClick={() => resetMap(1)}>Whole floor</button>
          <button className="rv-button" disabled={!selected || !floorIds.includes(selected.levelId)} onClick={() => resetMap(2)}>Focus room</button>
          <div className="directory-zoom-controls"><button className="rv-button" aria-label="Zoom out" title="Zoom out" onClick={()=>zoomMap(1.25)}>−</button><output ref={zoomOutput} aria-label="Map zoom"/><button className="rv-button" aria-label="Zoom in" title="Zoom in" onClick={()=>zoomMap(.8)}>+</button></div>
          <button className="rv-button" disabled={!modelFloor || editing} onClick={() => { if(modelFloor&&levelId!=null) {const context=campus?modelFloor:directoryModelFloor(result,[...floorRooms,...adjoiningRooms],levelId,selectedKey);onShowModel(withLocalBuildingContext({...modelFloor,...context,suggestedCutHeight:upperContextCutHeight,upperStairContext:upperStairVisible?upperStairContext:undefined,primaryBuilding:campus?undefined:building,title:campus?campusLevel?.name??"Campus storey":context?.title??modelFloor.title,buildingConnections:campus||buildingContext?floorBuildingConnections:[],portals:[...portals,...(!campus&&buildingContext?floorBuildingConnections.flatMap(c=>c.door.portal?[c.door.portal]:[]):[])]},displayedLocalConnections));} }}>Show this floor in 3D</button>
          <label><input type="checkbox" checked={wallsVisible} onChange={(e) => setWallsVisible(e.target.checked)} />Walls</label>
          <label><input type="checkbox" checked={connections} onChange={(e) => setConnections(e.target.checked)} />Door connections</label>
          {!campus&&<label><input type="checkbox" checked={buildingContext} onChange={e=>setBuildingContext(e.target.checked)} />Adjoining buildings</label>}
          <label><input type="checkbox" checked={connectedCirculation} onChange={e=>setConnectedCirculation(e.target.checked)} />Connected circulation</label>
          <label><input type="checkbox" checked={hideStaff} disabled={editing} onChange={e=>setHideStaff(e.target.checked)} />Hide staff-only areas</label>
          <label><input type="checkbox" checked={circulationOnly} disabled={editing} onChange={e=>setCirculationOnly(e.target.checked)} />Circulation only</label>
          <label><input type="checkbox" checked={!!stairVisible} onChange={e=>setStairVisible(e.target.checked)} />Stair flights</label>
          <label><input type="checkbox" checked={upperStairVisible} disabled={!stairVisible||editing} onChange={e=>setStairVisible(e.target.checked?"with-upper-context":true)} />Upper stair context</label>
          <label><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />Room numbers</label>
          <label><input type="checkbox" checked={sourceLabels} onChange={e=>setSourceLabels(e.target.checked)} />Source labels</label>
        </div>
        {campusFloorEditorOpen&&data&&<CampusFloorEditor data={data} levels={result.levels} currentLevelId={levelId} onClose={()=>setCampusFloorEditorOpen(false)} onSave={(next,target,message)=>{
          cancelGesture();
          startTransition(()=>{
            updateData(next); setBuilding(CAMPUS_BUILDING); setLevelId(target); setLabels(false);
            setSelectedKey(""); setStartKey(""); setDoorKey(null); setConnectionDoorKey(null);
            setEditing(false); setDraft(null); setSectionFocus(null); setPickedLocation(null); setZoom(1); setMapView(null); setMessage(message);
          });
        }}/>}
        {campus&&campusLevel&&<section className="directory-campus-level" aria-label="Campus level overview">
          <p>A campus storey can include several native Revit levels. Areas keep their original level IDs and recovered heights; local steps retain their connections. Missing source plans remain listed in source coverage.</p>
          <div className="directory-campus-buildings">{campusLevel.buildings.map(b=>{const elevations=[...new Set(b.roomKeys.map(k=>modelFloor?.roomElevations[k]?.elevation).filter((z):z is number=>z!=null).map(z=>z.toFixed(2)))];return <button className="rv-button" key={b.building} aria-label={`Focus Building ${b.building} on campus map`} onClick={()=>{const points=floorRooms.filter(r=>roomBuilding(r)===b.building).flatMap(r=>r.polygonFeet),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);setSelectedKey("");setDoorKey(null);setSectionFocus(null);setMapView({scope:viewScope,bounds:[Math.min(...xs)-8,-Math.max(...ys)-8,Math.max(...xs)-Math.min(...xs)+16,Math.max(...ys)-Math.min(...ys)+16]});}}><strong>{buildings.find(([id])=>id===b.building)?.[1]??`Building ${b.building}`}</strong><span>{b.roomKeys.length} records · {elevations.join(" / ")} ft</span></button>;})}</div>
          <details><summary>Building plans on this level</summary>{campusLevel.buildings.map(b=><p key={b.building}><strong>Building {b.building}</strong> · {b.sections.join(" · ")||"No source plan name"}</p>)}</details>
        </section>}
        <p className="directory-level-context">{campus?`${campusLevel?.name??"Campus storey"} · Native Revit levels ${campusLevel?.nativeLevels.map(l=>`#${l.levelId} · ${l.elevation.toFixed(2)} ft`).join(" + ")}`:`Revit level #${levelId}`} · {modelFloor ? `${modelFloor.elevation.toFixed(2)} ft · ${modelFloor.elevationSource}` : "Elevation unavailable"}{editing ? " · Save the boundary before showing it in 3D." : ""}</p>
        <p className="directory-wall-context">Wall source: {mapReferences.length?`registered drawing · ${mapReferences.reduce((n,s)=>n+s.wallSegments.length,0).toLocaleString()} segments${!nativeWalls.length?' · no native walls recovered at this cut':''}`:nativeWalls.length?`native model · ${nativeWalls.length.toLocaleString()} wall footprints at ${geometry?.cutElevation.toFixed(2)} ft`:'no recovered walls at this model cut; a registered drawing wall reference is needed.'}{modelFloor&&modelFloor.rooms.length>0&&modelFloor.rooms.every(r=>!modelFloor.roomElevations[r.key]?.evidence.startsWith('Recovered slab'))?' · No matched model slab here; review the drawing-to-model level association.':''}</p>
        {packageMessage&&<p className="directory-message" role="status">{packageMessage}</p>}
        {georeferenceOpen&&data&&<GeoreferenceWorkspace result={result} floor={modelFloor} value={data.georeference} modelName={result.fileName} sourceModelName={data.model.fileName} rooms={floorRooms} allRooms={rooms} picked={pickedLocation} levelIds={floorIds} onClose={()=>setGeoreferenceOpen(false)} onSave={g=>{setData({...data,georeference:g});setMessage("Reference points saved locally. Export rooms with edits to preserve them.");}}/>}
        {!!mapAdjoiningRooms.length&&<p className="directory-wall-context">Pale adjoining areas keep their building and room numbers. Select one to open its directory details. Purple marks recovered building connections; area fills alone do not establish routes.</p>}
        <div className="directory-map-stage">
        <aside className="directory-map-inspection" aria-label="Map selection details">
        {mapExpanded&&data&&<SourceCoverage data={data} building={building} records={buildingRooms.filter(r=>!!r.dwg?.sectionId).length}/>}
        {pickedLocation&&floorIds.includes(pickedLocation.levelId)&&pickedLocation.building===building&&<section className="directory-location-inspector" aria-label="Picked map location"><strong>Picked location</strong><p>{campus?"Campus":`Building ${building}`} · Revit level #{pickedLocation.levelId}<br/>Model X {pickedLocation.point[0].toFixed(2)} · Y {pickedLocation.point[1].toFixed(2)} ft</p><p>{pickedLocation.roomKeys.length?pickedLocation.roomKeys.map(k=>{const r=floorRooms.find(r=>r.key===k);return r?.number??r?.name??k;}).join(' · '):pickedLocalTread?`Local step · native run #${pickedLocalTread.tread.elementId} · ${pickedLocalTread.tread.elevation.toFixed(2)} ft` :pickedFloorOpening?'Native slab opening · no flat floor here':pickedNativeStair?`${pickedNativeStair.distanceFeet>0?"Near native stair tread":"Native stair tread"} · run #${pickedNativeStair.runId} · ${pickedNativeStair.elevation.toFixed(2)} ft`:'Outside the current source area outlines'}</p>{pickedLocation.roomKeys.map(k=>floorRooms.find(r=>r.key===k)).filter(r=>r?.modelSurface?.kind==='circulation').map(r=><p key={r!.key}>Recovered circulation · native slab #{r!.modelSurface!.elementId} at {r!.modelSurface!.elevationFeet.toFixed(2)} ft. The outline follows the registered plan and existing areas, with columns, walls and source islands excluded. Slab level association may be absent; support is checked at this elevation.</p>)}{pickedAccessReview&&<p>Staff-only location · user reported. No source outline is assigned here; the restriction is retained as a review pin and does not invent a floor region.</p>}{!pickedAccessReview&&!pickedLocation.roomKeys.length&&!pickedLocalTread&&!pickedNativeStair&&!pickedFloorOpening&&data?.boundaryReference&&<button className="rv-button" disabled={campus||rebuilding} onClick={recoverPickedCirculation}>Recover circulation at pin</button>}{pickedNativeStair&&<div><strong>Native stair flight #{pickedNativeStair.stairElementId}</strong><p>{pickedStairLink?pickedStairLink.rooms.map(k=>rooms.find(r=>r.key===k)?.number??k).join(" ↔ "):`Levels #${pickedNativeStair.lowLevelId??"unknown"} ↔ #${pickedNativeStair.highLevelId??"unknown"}`}<br/>{pickedNativeStair.distanceFeet>0?`Pin is ${pickedNativeStair.distanceFeet.toFixed(2)} ft from the actual tread edge. Nearby flight context does not establish walkable floor at the pin.`:pickedNativeStair.overhead?"This tread is above the plan cut. Blue shows the overhead flight projection, not a flat floor surface. A floor beneath it may exist; clearance and access below need separate review.":"Physical tread identified from the native model; source boundaries remain separate."}</p>{pickedStairSource&&<button className="rv-button" onClick={()=>{const room=rooms.find(r=>r.key===pickedStairSource.roomKey);if(room)choose(room,false);}}>Select {rooms.find(r=>r.key===pickedStairSource.roomKey)?.number} staircase</button>}</div>}{pickedCrossings.map(c=><div key={c.door.door.id}><strong>Building connection at this location</strong><p>{c.rooms.map(r=>r.number).join(" ↔ ")} · native Door #{c.door.door.id}<br/>{c.route?"Door crossing verified against native walls and columns.":"Door matched; crossing route geometry still needs review."}</p><button className="rv-button" onClick={()=>focusBuildingConnection(c)}>Show crossing through Door #{c.door.door.id}</button></div>)}<button className="rv-button" onClick={()=>setPickedLocation(null)}>Clear location pin</button></section>}
        {pickedDoor&&<DoorInspector review={pickedDoor} record={result.elementBounds.find(r=>r.elementId===pickedDoor.door.id)} hostId={result.nativeHostRelations?.find(r=>r.elementId===pickedDoor.door.id)?.hostId} levelId={pickedDoor.nativeLevelId} rooms={[...floorRooms,...adjoiningRooms]} onClose={()=>setDoorKey(null)} onFocus={focusDoor} onReview={()=>setMapExpanded(false)} onChoose={r=>choose(r,false)}/>}
        <LocalBuildingConnectionInspector connections={floorLocalConnections} building={building} pickedPoint={pickedLocation?.building===building&&floorIds.includes(pickedLocation.levelId)?pickedLocation.point:undefined} onFocus={focusLocalConnection} onChoose={(e,c)=>focusLocalConnection(c,e)}/>
        {(!selectedArea||floorBuildingConnections.some(c=>c.rooms.some(r=>selectedArea.roomKeys.includes(r.key))))&&<BuildingConnectionInspector connections={pickedCrossings.length?pickedCrossings:floorBuildingConnections.filter(c=>!selectedArea||c.rooms.some(r=>selectedArea.roomKeys.includes(r.key)))} building={building} onFocus={focusBuildingConnection} onChoose={(r,c)=>focusBuildingConnection(c,r)} onDoor={inspectDoor}/>}
        {selectedArea && modelFloor && <AreaInspector key={selectedArea.key} area={selectedArea} floor={modelFloor} metadata={data?.areaMetadata?.[selectedArea.key]} members={floorRooms.filter(r=>selectedArea.roomKeys.includes(r.key))} modelName={result.fileName} portals={portals} stairArrivals={floorStairs.filter(s=>s.rooms.some(k=>stairRoomsForSelection(floorRooms,selectedKey).some(r=>r.key===k))).flatMap(s=>{const i=s.levels.findIndex(id=>id===selectedArea.levelId),other=rooms.find(r=>r.key===s.rooms[1-i]);return other?[{room:other,direction:s.elevationsFeet[1-i]!>s.elevationsFeet[i]! ? "Up" as const : "Down" as const,flightId:s.stairElementId}]:[];})} onChoose={choose} onInspectDoor={inspectDoor}
          selectedRoom={selected} onSpaceUse={value=>{if(data&&selected){updateData({...data,annotations:data.annotations.map(r=>r.key===selected.key?{...r,spaceUse:value==="source"?undefined:{kind:value,evidence:"user-reported",notes:"User reviewed the use of this source area; its original name and boundary are retained."}}:r)});setMessage("Area use saved for this source record. Export rooms with edits to preserve it.");}}}
          onAccess={value=>{if(data&&selected){updateData({...data,annotations:data.annotations.map(r=>r.key===selected.key?{...r,access:value==="source"?undefined:{kind:value,evidence:"user-reported",notes:"Access reviewed by the user; source name and physical boundary retained."}}:r)});setMessage("Access review saved. Export rooms with edits to preserve it.");}}}
          onStairAccess={value=>{if(data){const keys=stairRoomsForSelection(floorRooms,selectedKey).map(r=>r.key);if(!keys.length)return;updateData({...data,annotations:data.annotations.map(r=>keys.includes(r.key)?{...r,stairAccess:value,stairAccessNotes:value==="local-only"?"User reviewed this as local steps / landing without access to another storey.":value==="up-flight-only"?"User confirmed that the upward flight connects to another storey, while downward steps are local and do not connect to a lower storey.":value==="flight-and-landing"?"User reviewed that only the stair flight connects storeys; the remaining outline is landing.":undefined}:r),navigation:data.navigation?{...data.navigation,stairLinks:value==="local-only"?data.navigation.stairLinks?.filter(l=>!l.rooms.some(k=>keys.includes(k))):value==="up-flight-only"?data.navigation.stairLinks?.filter(l=>l.rooms.every((k,i)=>!keys.includes(k)||(result.levels.find(v=>v.levelId===rooms.find(r=>r.key===l.rooms[1-i])?.levelId)?.elevation??-Infinity)>(result.levels.find(v=>v.levelId===rooms.find(r=>r.key===k)?.levelId)?.elevation??Infinity))):data.navigation.stairLinks}:undefined});setMessage("Stair review saved. Export rooms with edits to keep it.");}}}
          onWalkability={value=>{if(data){updateData({...data,annotations:data.annotations.map(r=>selectedArea.roomKeys.includes(r.key)?{...r,walkability:value,walkabilityNotes:value==="void"?"User marked this area as an open drop / void. Check its boundary against landings and railings.":undefined}:r)});setMessage("Walkability saved. Export rooms with edits to keep this review.");}}}
          related={selectedArea.kind === "atrium" ? buildingRooms.filter(r=>!floorIds.includes(r.levelId)&&roomBuilding(r)===selectedArea.building&&directoryAreaKind(r)==="atrium") : []} onRelated={choose}
          onSave={value=>{if(data){updateData({...data,areaMetadata:{...data.areaMetadata,[selectedArea.key]:value}});setMessage("Area metadata saved. Export rooms with edits to preserve these relationships.");}}} />}
        {!pickedDoor&&!selectedArea&&!pickedLocation&&<p className="directory-inspection-help">Select an area for its metadata. Click a door circle for its model information. Double-click the map to inspect a location.</p>}
        </aside>
        <div className="directory-map-scroll"><svg ref={svg} className="directory-map" viewBox={bounds.join(" ")} role="group" tabIndex={0} aria-label="Interactive room boundaries and hallway connections"
          onDoubleClick={e=>{if(editing||levelId==null)return;const p=pointer(e);if(!p)return;const location=directoryLocation(floorRooms,doors,p,Math.min(2,bounds[2]/100));const owner=floorRooms.find(r=>r.key===location.roomKeys[0]);setPickedLocation({...location,building,levelId:owner?.levelId??levelId});if(owner)choose(owner,false);const marker=(e.target as Element).closest('[data-door-id]');const id=marker?Number(marker.getAttribute('data-door-id')):location.doorId;if(id!=null)inspectDoor(id);}}
          onKeyDown={e=>{if(e.target!==e.currentTarget||editing)return;if(['+','=','-','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault();if(e.key==='+'||e.key==='=')zoomMap(.8);else if(e.key==='-')zoomMap(1.25);else if(e.key==='Home')resetMap(1);else{cancelGesture();const live=currentBounds();const delta:Record<string,RoomPoint>={ArrowLeft:[-live[2]*.1,0],ArrowRight:[live[2]*.1,0],ArrowUp:[0,-live[3]*.1],ArrowDown:[0,live[3]*.1]};const d=delta[e.key];if(d)setMapView({scope:viewScope,bounds:[live[0]+d[0],live[1]+d[1],live[2],live[3]]});}}}
          onPointerDown={e=>{if(editing||![0,1].includes(e.button))return;const inverse=svg.current?.getScreenCTM()?.inverse();if(!inverse)return;cancelGesture();const live=currentBounds();setMapView({scope:viewScope,bounds:[...live]});panMoved.current=false;pan.current={id:e.pointerId,start:[e.clientX,e.clientY],bounds:[...live],inverse,scope:viewScope};}}
          onClickCapture={e=>{if(panMoved.current){e.preventDefault();e.stopPropagation();panMoved.current=false;}}}
          onPointerMove={(e) => {
            if(dragging.current!=null&&draft){const p=pointer(e);if(p)setDraft(draft.map((v,i)=>i===dragging.current?p:v));return;}
            const drag=pan.current;if(!drag||drag.id!==e.pointerId||editing)return;const dx=e.clientX-drag.start[0],dy=e.clientY-drag.start[1];if(!panMoved.current&&Math.hypot(dx,dy)<3)return;panMoved.current=true;svg.current?.setPointerCapture(e.pointerId);setMapView({scope:drag.scope,bounds:[drag.bounds[0]-dx*drag.inverse.a-dy*drag.inverse.c,drag.bounds[1]-dx*drag.inverse.b-dy*drag.inverse.d,drag.bounds[2],drag.bounds[3]]});
          }}
          onPointerUp={e=>{dragging.current=null;pan.current=null;if(svg.current?.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{dragging.current=null;pan.current=null;panMoved.current=false;}}>
          <defs><pattern id="directory-void-hatch" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="2" fill="#f5e4e9"/><path d="M0 0V2" stroke="#b94c6f" strokeWidth=".25"/></pattern></defs>
          {!editing&&<g aria-label="Native local landing surfaces">{displayedLocalConnections.flatMap(c=>c.surfaces.map((surface,i)=><path key={`${c.report.id}:${i}`} d={surface.polygons.flatMap(p=>p.map(path)).join(' ')} fillRule="evenodd" className="directory-native-landing" role="button" tabIndex={0} aria-label={`Inspect Building ${c.endpoints[i]!.building} native landing`} onClick={()=>focusLocalConnection(c,c.endpoints[i])} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focusLocalConnection(c,c.endpoints[i]);}}}><title>Native floor #{surface.elementId} · {surface.elevation.toFixed(2)} ft · local context, not a room boundary</title></path>))}</g>}
          {!editing&&buildingContext&&<g aria-label="Adjoining building areas">{mapAdjoiningRooms.map(r=><g key={r.key}><path d={[path(r.polygonFeet),...(r.holesFeet??[]).map(path)].join(' ')} fillRule="evenodd" className={`directory-adjoining-room ${!showArea(r)?"directory-room-outline":""} ${!adjoiningRooms.some(a=>a.key===r.key)?"context-only":""} ${floorLocalConnections.some(c=>c.endpoints.some(e=>e.roomKey===r.key))?"local-to-storey":""}`} role="button" tabIndex={0} aria-label={`Open adjoining Building ${roomBuilding(r)} ${r.number}`} onClick={()=>openAdjoiningRoom(r)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openAdjoiningRoom(r);}}}><title>Building {roomBuilding(r)} · {r.number} · {r.name} · level #{r.levelId}</title></path>{labels&&showArea(r)&&<text className="directory-map-label" x={r.labelPointFeet[0]} y={-r.labelPointFeet[1]} fontSize={fontSize} textAnchor="middle">{r.number}</text>}</g>)}</g>}
          {!editing && modelFloor?.areas.filter(a=>a.kind!=="room").map(area=><path key={area.key} fillRule="evenodd" style={circulationOnly?{fill:"#8ad1c9"}:undefined} d={area.polygons.flatMap(p=>p.map(path)).join(" ")} className={`directory-room hallway ${circulationContext.has(area.key)?"circulation-context":""} ${area.roomKeys.some(k=>(floorRooms.find(r=>r.key===k)?.confidence??1)<.75)?"uncertain":""} ${selectedArea?.key===area.key?"selected":""}`} role="button" tabIndex={0} aria-label={`${campus?`Building ${area.building} · `:""}${area.title} area · ${area.roomKeys.length} source records`} aria-pressed={selectedArea?.key===area.key} onClick={()=>{const room=floorRooms.find(r=>r.key===area.roomKeys[0]);if(room)choose(room,false);}} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();const room=floorRooms.find(r=>r.key===area.roomKeys[0]);if(room)choose(room,false);}}}><title>{area.title} · {area.roomKeys.length} source records</title></path>)}
          {mapRooms.slice().sort((a,b)=>Number(directoryAreaKind(b)!=="room")-Number(directoryAreaKind(a)!=="room")).map((room) => <path key={room.key} fillRule="evenodd" d={[path((selectedKey === room.key || !!selected?.circulationGroup && selected.circulationGroup === room.circulationGroup) && draft ? draft : cleanRoomBoundary(room.polygonFeet)), ...(room.holesFeet ?? []).map(path)].join(" ")}
            className={`directory-room ${!showArea(room)?"directory-room-outline":""} ${!isWalkable(room) ? "void" : ""} ${flagged.has(room.key) ? "review" : ""}  ${isHallway(room) ? "hallway" : ""} ${(room.source as Record<string, unknown> | undefined)?.polygon === "native-floor-connection" ? "passage" : ""} ${room.confidence < .75 && (room.source as Record<string, unknown> | undefined)?.polygon !== "vector-walls" ? "uncertain" : ""} ${selectedKey === room.key || !!selected?.circulationGroup && selected.circulationGroup === room.circulationGroup ? "selected" : ""}`}
            tabIndex={0} role="button" aria-label={`${room.number ?? "Unnumbered"} ${room.name ?? "room"}`} aria-pressed={selectedKey === room.key}
            style={!showArea(room)?{fill:"transparent"}:circulationOnly&&!editing&&directoryAreaKind(room)==="room"&&circulationReviewKeys.has(room.key)?{fill:"#d5eae5"}:!isWalkable(room)?{fill:"url(#directory-void-hatch)"}:!editing&&directoryAreaKind(room)!=="room"?{fill:"transparent",stroke:"none"}:!editing&&circulationContext.has(`room:${room.key}`)?{fill:'#a7dcd7'}:undefined}
            onClick={() => { if (!editing) choose(room,false); }} onKeyDown={(e) => { if (!editing && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); choose(room,false); } }}>
            <title>{room.number} · {room.name} · boundary confidence {Math.round(room.confidence * 100)}%</title>
          </path>)}
          {!editing&&<g className="directory-stair-treads" aria-label="Recovered stair treads" pointerEvents="none">{stairFootprints.flatMap(f=>f.treads.filter(t=>(t.localToStorey||stairVisible)&&stairTreadVisibleInPlan(t,result.levels.find(l=>l.levelId===floorRooms.find(r=>r.key===f.roomKey)?.levelId)?.elevation??0)).map((t,i)=><path key={`${f.roomKey}:${i}`} d={t.polygons.flatMap(p=>p.map(path)).join(' ')} fillRule="evenodd" className={t.localToStorey?"local-to-storey":""}><title>{t.localToStorey?"Same-storey circulation step":"Stair flight step"} · model element #{t.elementId} · {t.elevation.toFixed(2)} ft</title></path>))}</g>}
          {!editing&&upperStairVisible&&<g className="directory-upper-stair-context" aria-label="Upper stair projections" pointerEvents="none">{upperStairContext.flatMap(c=>c.treads.map((t,i)=><path key={`${c.stairElementId}:${t.runId}:${i}`} data-stair-element-id={c.stairElementId} data-stair-elevation={t.elevation} d={path(t.polygon)}><title>Upper stair #{c.stairElementId} · run #{t.runId} · {t.elevation.toFixed(2)} ft · overhead context, not floor below</title></path>))}</g>}
          {(wallsVisible||circulationOnly&&!editing) && <g className={`directory-wall-reference ${!wallsVisible?"directory-wall-context":""}`} aria-label="Wall geometry" pointerEvents="none">{mapReferences.length
            ? mapReferences.map(section=><path key={section.sectionId} data-wall-segments={section.wallSegments.length} d={section.wallSegments.map(([a,b])=>`M${a[0]},${-a[1]} L${b[0]},${-b[1]}`).join(' ')} />)
            : nativeWalls.map((wall, i) => <path key={`${wall.elementId}:${i}`} d={path(wall.polygon)} />)}</g>}
          {!editing && connectedCirculation && <g className="directory-circulation-links" aria-label="Connected circulation openings" pointerEvents="none">{portals.filter(p=>(!hideStaff||p.rooms.every(k=>isPubliclyAccessible(rooms.find(r=>r.key===k)!)))&&p.rooms.every(k=>modelFloor?.areas.some(a=>circulationContext.has(a.key)&&a.roomKeys.includes(k)))).map(p=><path key={p.doorId} d={`M${p.from[0]},${-p.from[1]} L${p.point[0]},${-p.point[1]} L${p.to[0]},${-p.to[1]}`}><title>Circulation connection through door #{p.doorId}</title></path>)}</g>}
          {!editing&&<g className="directory-open-passages" aria-label="Verified open boundaries" pointerEvents="none">{openings.filter(o=>!hideStaff||o.rooms.every(k=>isPubliclyAccessible(rooms.find(r=>r.key===k)!))).map(o=><path key={o.openingId} d={path(o.footprint!)} fill="#a7dcd7" stroke="#087d7b" strokeWidth=".15"><title>Verified open boundary · {o.openingId}</title></path>)}</g>}
          {connections && nearbyReviews.filter(d=>!hideStaff||(d.portal?d.portal.rooms.every(k=>isPubliclyAccessible(rooms.find(r=>r.key===k)!)):d.candidates.every(k=>isPubliclyAccessible(rooms.find(r=>r.key===k)!)))).map(review => <g key={review.door.id} data-door-id={review.door.id} className={`directory-door-marker ${review.portal ? "linked" : "unresolved"} ${doorKey===review.door.id ? "picked" : ""}`} role="button" tabIndex={0} aria-label={`Inspect door ${review.door.id} ${review.portal?"linked":"needs review"}`} onClick={()=>inspectDoor(review.door.id)} onKeyDown={e=>{if(e.key==="Enter" || e.key===" "){e.preventDefault();inspectDoor(review.door.id);}}}>
            {review.portal && <path d={`M${review.portal.from[0]},${-review.portal.from[1]} L${review.door.point[0]},${-review.door.point[1]} L${review.portal.to[0]},${-review.portal.to[1]}`} />}
            {review.door.footprint && <path className="directory-door-footprint" d={path(review.door.footprint)} />}
            <circle cx={review.door.point[0]} cy={-review.door.point[1]} r={.8}><title>Door #{review.door.id} · {review.state}</title></circle><circle className="directory-door-hit" cx={review.door.point[0]} cy={-review.door.point[1]} r={2} />
          </g>)}
          {stairVisible&&stairFootprints.filter(f=>f.roomKey===selectedKey&&floorRooms.find(r=>r.key===f.roomKey)?.stairFlightIds?.length).map(f=><path key={f.roomKey} d={f.polygons.flatMap(p=>p.map(path)).join(' ')} fill="none" stroke="#8c75a5" strokeWidth=".15" strokeDasharray=".6 .4" pointerEvents="none"><title>Complete native stair projection; overhead treads remain above the plan cut</title></path>)}
          {stairVisible && floorRooms.filter(r=>isWalkable(r)&&isStaircase(r)).map(r=>{const footprint=stairFootprints.find(f=>f.roomKey===r.key),link=floorStairs.find(s=>s.rooms.includes(r.key)),linked=!!link;const p=(link?.stairElementId!=null?footprint?.markersByStair[link.stairElementId]:undefined)??footprint?.marker??r.routePointFeet??r.labelPointFeet;return <g key={r.key} className="directory-stair-marker" role="button" tabIndex={0} aria-label={`Inspect staircase ${r.number}`} onClick={()=>choose(r)} onKeyDown={e=>{if(e.key==="Enter" || e.key===" "){e.preventDefault();choose(r);}}}><text x={p[0]} y={-p[1]} fontSize={fontSize*1.5}>{linked?(r.stairAccess==="up-flight-only"?"↑":"⇅"):"?"}</text><title>{r.number} · {linked?(r.stairAccess==="up-flight-only"?"Upward flight connects storeys; downward steps are local":"Linked stair flight; surrounding area is landing"):footprint?"Actual steps; storey connection needs review":"Source stair area; native flight not recovered, arrival floor needs review"}</title></g>;})}
          {!editing&&<g aria-label="Local steps between buildings">{displayedLocalConnections.map(c=><g key={c.report.id}>{c.treads.map((t,i)=><path key={i} d={path(t.polygon)} className="directory-local-tread"><title>Same-storey circulation step · native element #{t.elementId} · {t.elevation.toFixed(2)} ft</title></path>)}<g role="button" tabIndex={0} aria-label={`View local steps Building ${c.endpoints[0].building} to ${c.endpoints[1].building}`} onClick={()=>focusLocalConnection(c)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focusLocalConnection(c);}}}><path className={`directory-local-link ${c.surfaceSupported?'supported':'pending'}`} d={c.samples.map((s,i)=>`${i?'L':'M'}${s.point[0]},${-s.point[1]}`).join(' ')}/>{c.endpoints.map((e,i)=><g key={i}><circle className="directory-local-link-dot" cx={e.point[0]} cy={-e.point[1]} r=".7"/><text className="directory-map-label" x={e.point[0]+1} y={-e.point[1]} fontSize={fontSize}>Building {e.building} · {e.elevation.toFixed(2)} ft</text></g>)}<title>Local steps #{c.report.nativeStairId} · {c.stepBands} step elevations · user reported local connection</title></g></g>)}</g>}
          {!editing&&(campus||buildingContext)&&<g aria-label="Connections between buildings">{floorBuildingConnections.map(c=><g key={c.door.door.id} role="button" tabIndex={0} aria-label={`View Building ${roomBuilding(c.rooms[0])} to Building ${roomBuilding(c.rooms[1])} connection through door ${c.door.door.id}`} onClick={()=>focusBuildingConnection(c)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focusBuildingConnection(c);}}}><path className="directory-building-link" d={`M${c.door.portal!.from[0]},${-c.door.portal!.from[1]} L${c.door.door.point[0]},${-c.door.door.point[1]} L${c.door.portal!.to[0]},${-c.door.portal!.to[1]}`}/><circle className="directory-building-link-dot" cx={c.door.door.point[0]} cy={-c.door.door.point[1]} r="1.3"/><title>Building connection · Door #{c.door.door.id}</title></g>)}</g>}
          {(campus||buildingContext)&&activeConnection?.route&&<polyline className="directory-route" aria-label="Verified local building crossing" points={activeConnection.route.points.map(([x,y])=>`${x},${-y}`).join(' ')}/>}
          {activeLegs.map((leg,i)=><polyline key={i} className="directory-route" points={leg.route.points.map(([x,y])=>`${x},${-y}`).join(" ")} />)}
          {labels && floorRooms.filter(showArea).filter(r=>sourceLabels||editing||directoryAreaKind(r)==="room").map((room) => <text key={room.key} className="directory-map-label" onClick={() => { if (!editing) choose(room,false); }} x={room.labelPointFeet[0]} y={-room.labelPointFeet[1]} fontSize={fontSize} textAnchor="middle">{room.number}</text>)}
          {labels&&!sourceLabels&&!editing&&modelFloor?.areas.filter(a=>a.kind!=="room").map(a=><text key={a.key} className="directory-map-label" x={a.labelPointFeet[0]} y={-a.labelPointFeet[1]} fontSize={fontSize*1.2} textAnchor="middle">{data?.areaMetadata?.[a.key]?.name||a.title}</text>)}
          {campus&&!editing&&campusLevel?.buildings.map(b=>{const members=floorRooms.filter(r=>roomBuilding(r)===b.building),points=members.flatMap(r=>r.polygonFeet),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return <text key={b.building} className="directory-campus-label" x={(Math.min(...xs)+Math.max(...xs))/2} y={-Math.max(...ys)-2} fontSize={Math.max(3,Math.max(bounds[2],bounds[3])/50)} textAnchor="middle" pointerEvents="none">{buildings.find(([id])=>id===b.building)?.[1]??`Building ${b.building}`}</text>;})}
          {georeferenceOpen&&data?.georeference?.modelFileName===result.fileName&&<g className="directory-geo-points" aria-label="Model georeference points" pointerEvents="none">{data.georeference.points.filter(p=>floorIds.includes(p.levelId)).map(p=><g key={p.id}><circle cx={p.modelFeet[0]} cy={-p.modelFeet[1]} r={Math.max(.4,bounds[2]/180)} fill="#087d7b" stroke="white" strokeWidth=".2"/><text x={p.modelFeet[0]} y={-p.modelFeet[1]} textAnchor="middle" dy=".35em" fontSize={Math.max(.5,bounds[2]/180)} fill="white">{data.georeference!.points.indexOf(p)+1}</text><title>{p.name} · WGS84 {p.geographic.latitude.toFixed(7)}, {p.geographic.longitude.toFixed(7)}</title></g>)}</g>}
          {startKey && floorRooms.filter((r) => r.key === startKey).map((r) => <circle key={r.key} className="directory-start" cx={r.labelPointFeet[0]} cy={-r.labelPointFeet[1]} r={1.2} />)}
          {pickedLocation&&floorIds.includes(pickedLocation.levelId)&&pickedLocation.building===building&&<g className="directory-location-pin" pointerEvents="none"><circle cx={pickedLocation.point[0]} cy={-pickedLocation.point[1]} r={Math.max(.25,bounds[2]/250)}/><path d={`M${pickedLocation.point[0]-bounds[2]/125},${-pickedLocation.point[1]} h${bounds[2]/62.5} M${pickedLocation.point[0]},${-pickedLocation.point[1]-bounds[2]/125} v${bounds[2]/62.5}`}/></g>}
          {editing && draft && <g className="directory-boundary-editor">
            {draft.map((p, i) => <g key={i}><path className="directory-edit-edge" d={`M${p[0]},${-p[1]} L${draft[(i + 1) % draft.length]![0]},${-draft[(i + 1) % draft.length]![1]}`} onDoubleClick={(e) => { e.stopPropagation(); const next = pointer(e); if (next) setDraft([...draft.slice(0, i + 1), next, ...draft.slice(i + 1)]); }} />
              <circle cx={p[0]} cy={-p[1]} r={bounds[2]! / 160} tabIndex={0} role="button" aria-label={`Boundary corner ${i + 1}`} onKeyDown={(e) => {
                if (e.key === "Delete" && draft.length > 3) { e.preventDefault(); setDraft(draft.filter((_, j) => j !== i)); return; }
                const move: Record<string, RoomPoint> = { ArrowLeft: [-.25, 0], ArrowRight: [.25, 0], ArrowUp: [0, .25], ArrowDown: [0, -.25] };
                const delta = move[e.key]; if (!delta) return; e.preventDefault();
                setDraft(draft.map((v, j) => j === i ? [v[0] + delta[0], v[1] + delta[1]] : v));
              }} onPointerDown={(e) => {
                e.stopPropagation(); if (e.altKey && draft.length > 3) { setDraft(draft.filter((_, j) => j !== i)); return; }
                dragging.current = i; svg.current?.setPointerCapture(e.pointerId);
              }} /></g>)}
          </g>}
        </svg></div>
        </div>
        {circulationOnly&&!editing&&<p className="directory-map-note" role="status">Circulation only: identified hallways, shared atriums and circulation remain visible. Light-blue room fills are hidden; the full architectural outlines remain visible. Hide staff-only areas also removes restricted fills, labels and crossing markers; reported restrictions exclude public routes. With Connected circulation enabled, pale green also shows named rooms with user-reported access; their boundaries remain separate and an access report does not verify a route. Enable Walls for stronger linework. Doors and stair flights use their own controls. This display option applies across buildings and campus storeys; source records and routes are retained.</p>}
        {upperStairVisible&&!editing&&<section className="directory-map-note" aria-label="Upper stair context details"><strong>Upper stair context</strong><p>Blue shading with dashed purple outlines shows recovered flights above the plan cut. They are overhead context and retain their native heights. Floor boundaries, room uses and walking routes remain unchanged. Show this floor in 3D raises the cut to include these flights.</p>{selectedUpperStairs.map(c=><p key={c.stairElementId}>Native stair #{c.stairElementId} · runs {[...new Set(c.treads.map(t=>t.runId))].map(id=>`#${id}`).join(" / ")} · {Math.min(...c.treads.map(t=>t.elevation)).toFixed(2)}–{Math.max(...c.treads.map(t=>t.elevation)).toFixed(2)} ft.{selected&&` Above ${selected.number} · ${selected.name}.`}</p>)}{selectedKey&&!selectedUpperStairs.length&&<p>No upper native stair flight overlaps this source area at the selected storey.</p>}</section>}
        <footer className="directory-legend"><span><i className="room" />Room boundary</span><span><i className="hallway" />Hallway</span><span><i className="reported-access" />Reported access</span><span><i className="uncertain" />Boundary to review</span><span><i className="door" />Recovered door</span><span><i className="staircase" />Stair flights</span><span><i className="upper-flight" />Overhead stair projection</span><span><i className="local-step" />Same-storey steps</span><span><i className="route" />Route</span><span><i className="void" />Void / no floor</span><span><i className="building-link" />Building connection</span></footer>
        <p className="directory-map-note">Scroll to zoom · drag to pan · double-click for location · click a door circle for information · Whole floor resets the view. Teal lines show recovered openings. Purple markers show connections between buildings. Green steps and landing patches show circulation within the same storey; purple shows stair flights or adjoining-building context. Dashed native landing edges are context surfaces, not room boundaries. Reported area connections retain their evidence and need an opening match before creating routes. Door position and access restrictions are not read from the model.</p>
      </> : <div className="directory-empty"><h2>A connected map of your building</h2><p>Import a room annotations JSON to browse buildings and floors, find a room, inspect its hallway access, and refine its outline.</p><button className="rv-button" onClick={() => input.current?.click()}>Choose rooms JSON</button></div>}
    </div>
  </section>;
}
