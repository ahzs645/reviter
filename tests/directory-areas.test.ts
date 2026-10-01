import test from 'node:test';import assert from 'node:assert/strict';
import {directoryAreas,circulationAreaLinks,directoryAreaLinks,connectedCirculationAreas,type AreaRelationship} from '../lib/reviter/directory-areas.ts';import {parseRoomDirectory,type DirectoryRoom,type RoomPortal,findDirectoryRoute}from '../lib/reviter/room-directory.ts';
const room=(key:string,name:string,x0:number,x1:number,levelId=42):DirectoryRoom=>({key,number:`10-${key}`,name,levelId,confidence:1,polygonFeet:[[x0,0],[x1,0],[x1,10],[x0,10]],labelPointFeet:[(x0+x1)/2,5]});
test('adjacent atrium labels become one outline, retaining source IDs and excluding private rooms',()=>{
  const rs=[room('a','Atrium',0,5),room('b','Atrium',5,10),{...room('private','Office',3,7),polygonFeet:[[3,3],[7,3],[7,7],[3,7]] as [number,number][]}];const original=structuredClone(rs),areas=directoryAreas(rs),a=areas.find(a=>a.kind==='atrium')!;
  assert.deepEqual(a.roomKeys,['a','b']);assert.equal(a.polygons.length,1);assert.equal(a.polygons[0]!.length,2);assert.equal(a.areaFeet,84);assert.ok(a.polygons[0]![0]!.every(([x,y])=>x!==5||y===0||y===10));assert.deepEqual(rs,original);
});
test('display areas never fill gaps or combine floors, buildings, or split-level heights',()=>{
  const rs=[room('a','Corridor',0,5),room('b','Corridor',6,10),room('up','Atrium',0,10,43),room('low','Atrium',0,10),room('high','Atrium',10,20),{...room('other','Corridor',0,10),number:'08-100'}];
  const areas=directoryAreas(rs,{low:{elevation:20},high:{elevation:30}});assert.equal(areas.length,5);const hall=areas.find(a=>a.building==='10'&&a.kind==='hallway')!;assert.equal(hall.polygons.length,2);assert.equal(hall.areaFeet,90);
});
test('area names, notes and associated model IDs survive export/import with original source annotations',()=>{
  const data={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'model.rvt'},annotations:[room('a','Atrium',0,5)],areaMetadata:{'area:10:42:atrium:0.00':{name:'Teaching atrium',notes:'Review the glass entrance.',elementIds:[2471813],circulationDoorUse:'usually-open'}}};
  assert.deepEqual(parseRoomDirectory(JSON.stringify(data)),data);
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,areaMetadata:{a:{elementIds:['bad']}}})));
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,areaMetadata:{a:{notes:{invalid:true}}}})));
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,areaMetadata:{a:{circulationDoorUse:'currently-open'}}})));
});
test('upper atrium drawing context groups alcoves and corridors without absorbing enclosed rooms',()=>{
  const rs=[{...room('alcove','Alcove',0,5),dwg:{sectionId:'10 TandL Atrium LVL 4'}},{...room('corridor','Corridor',5,10),dwg:{sectionId:'10 TandL Atrium LVL 4'}},{...room('store','Storage',20,25),dwg:{sectionId:'10 TandL Atrium LVL 4'}}];
  const areas=directoryAreas(rs);assert.equal(areas.length,2);assert.deepEqual(areas.find(a=>a.kind==='atrium')!.roomKeys,['alcove','corridor']);assert.equal(areas.find(a=>a.kind==='atrium')!.areaFeet,100);
});
test('circulation context follows recovered openings while retaining separate area and door identities',()=>{
  const rs=[room('a','Atrium',0,5),room('b','Corridor',6,10),room('private','Office',11,15),room('upper','Atrium',0,5,43),{...room('other','Atrium',0,5),number:'08-100'},room('split','Atrium',20,25)];
  const areas=directoryAreas(rs,{split:{elevation:10}}),original=structuredClone(areas);
  const portal=(id:number,a:string,b:string):RoomPortal=>({doorId:id,rooms:[a,b],point:[5.5,5],from:[5,5],to:[6,5],halfWidth:1,halfHeight:1});
  const portals=[portal(1,'a','b'),portal(2,'b','a'),portal(3,'a','private'),portal(4,'a','upper'),portal(5,'a','other'),portal(6,'a','split')];
  const links=circulationAreaLinks(areas,portals);assert.equal(links.length,1);assert.deepEqual(links[0]!.doorIds,[1,2]);
  assert.deepEqual(connectedCirculationAreas(areas,portals,'a'),new Set(areas.filter(a=>a.roomKeys.includes('a')||a.roomKeys.includes('b')).map(a=>a.key)));
  assert.equal(connectedCirculationAreas(areas,portals,'private').size,3);
  assert.equal(circulationAreaLinks(areas,[]).length,0);assert.deepEqual(areas,original);
});
test('reported access includes named rooms without inventing doors or hallway routes through private rooms',()=>{
  const rs=[room('hall','Corridor',0,5),room('copy','Copy',7,12),room('office','Office',14,19)],areas=directoryAreas(rs);
  const reports:AreaRelationship[]=[{rooms:['hall','copy'],kind:'access',evidence:'user-reported'}];
  const links=directoryAreaLinks(areas,[],reports);assert.equal(links.length,1);assert.deepEqual(links[0]!.doorIds,[]);assert.deepEqual(links[0]!.reported,reports);
  assert.ok(connectedCirculationAreas(areas,[],'hall',reports).has('room:copy'));assert.ok(!connectedCirculationAreas(areas,[],'hall',reports).has('room:office'));
  assert.equal(findDirectoryRoute(rs,[],'hall','copy'),null);
  const data={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'test.rvt'},annotations:rs,areaRelationships:reports};
  assert.deepEqual(parseRoomDirectory(JSON.stringify(data)),data);
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,areaRelationships:[...reports,...reports]})));
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,areaRelationships:[{...reports[0],rooms:['hall','missing']}]})));
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,areaRelationships:[{...reports[0],evidence:'native'}]})));
});

test('a reported connection survives split-level display grouping and exposes the height change',()=>{
  const rs=[room('hall','Corridor',0,5),room('rotunda','Rotunda',6,10)],areas=directoryAreas(rs,{hall:{elevation:0},rotunda:{elevation:3.28}});
  const reports:AreaRelationship[]=[{rooms:['hall','rotunda'],kind:'access',evidence:'user-reported'}];
  const links=directoryAreaLinks(areas,[],reports);assert.equal(links.length,1);assert.equal(links[0]!.riseFeet,3.28);assert.deepEqual(links[0]!.doorIds,[]);
  rs[1]!.walkability='void';assert.equal(directoryAreaLinks(directoryAreas(rs),[],reports).length,0);
});

test('reviewed shared use joins differently named atrium sources while preserving original records',()=>{
  const rs=[room('street','Plaza Street',0,5),room('hall','Multi Purpose Hall',5,10),room('lounge','Multi Purpose Lounge',10,15),room('unnamed','',15,20)];
  assert.equal(directoryAreas(rs).length,4);assert.equal(findDirectoryRoute(rs,[],'street','unnamed'),null);
  const original=structuredClone(rs),reviewed=rs.map(r=>({...r,spaceUse:{kind:'atrium' as const,evidence:'user-reported' as const}}));
  const areas=directoryAreas(reviewed);assert.equal(areas.length,1);assert.equal(areas[0]!.polygons.length,1);assert.deepEqual(areas[0]!.roomKeys,rs.map(r=>r.key));assert.ok(findDirectoryRoute(reviewed,[],'street','unnamed'));
  assert.deepEqual(rs,original);assert.deepEqual(reviewed.map(r=>{const copy:DirectoryRoom={...r};delete copy.spaceUse;return copy;}),original);
  const data={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'model.rvt'},annotations:reviewed};assert.deepEqual(parseRoomDirectory(JSON.stringify(data)),data);
  for(const invalid of [{kind:'atrium',evidence:'native'},{kind:'office',evidence:'user-reported'},{kind:'atrium',evidence:'user-reported',notes:7}])assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,annotations:[{...reviewed[0],spaceUse:invalid}]})));
  const privateReviewed=reviewed.map(r=>r.key==='hall'?{...r,spaceUse:{kind:'room' as const,evidence:'user-reported' as const}}:r);assert.equal(directoryAreas(privateReviewed).length,2);assert.equal(findDirectoryRoute(privateReviewed,[],'street','unnamed'),null);
});

test('a reviewed lower atrium lounge stays associated but cannot create a flat route or shortcut',()=>{
  const rs=[room('west','Atrium',0,5),{...room('sunken','Lounge',5,10),spaceUse:{kind:'atrium' as const,evidence:'user-reported' as const}},room('east','Corridor',10,15)];
  const elevations={west:{elevation:0},sunken:{elevation:-3.28},east:{elevation:0}},areas=directoryAreas(rs,elevations);
  const reports:AreaRelationship[]=[{rooms:['west','sunken'],kind:'open-space',evidence:'user-reported'}];
  assert.equal(areas.length,3);assert.equal(directoryAreaLinks(areas,[],reports)[0]!.riseFeet,3.28);assert.ok(connectedCirculationAreas(areas,[],'west',reports).has(areas.find(a=>a.roomKeys.includes('sunken'))!.key));
  assert.equal(findDirectoryRoute(rs,[],'west','sunken',elevations),null);assert.equal(findDirectoryRoute(rs,[],'west','east',elevations),null);assert.ok(findDirectoryRoute(rs,[],'sunken','sunken',elevations));
  const portal:RoomPortal={doorId:1,rooms:['west','sunken'],point:[5,5],from:[4.9,5],to:[5.1,5],halfWidth:1,halfHeight:1};assert.equal(findDirectoryRoute(rs,[portal],'west','sunken',elevations),null);
  const voidRoom={...rs[1]!,walkability:'void' as const};assert.equal(directoryAreas([voidRoom],elevations)[0]!.kind,'room');assert.equal(findDirectoryRoute([rs[0]!,voidRoom],[],'west','sunken',elevations),null);
});

test('circulation filter includes reported access without absorbing named rooms or creating routes',async()=>{
  const {reportedCirculationRoomKeys}=await import('../lib/reviter/directory-areas.ts');
  const rs=[room('hall','Corridor',0,5),room('print','Print',7,12),room('storage','Storage',14,19),room('office','Office',21,26),room('unrelated','Office',28,33)];
  const reports:AreaRelationship[]=[{rooms:['storage','print'],kind:'access',evidence:'user-reported'},{rooms:['hall','print'],kind:'access',evidence:'user-reported'},{rooms:['office','storage'],kind:'access',evidence:'user-reported'}];
  const areas=directoryAreas(rs),before=structuredClone(areas);
  assert.deepEqual(reportedCirculationRoomKeys(areas,reports),new Set(['hall','print','storage','office']));
  assert.deepEqual(areas,before);assert.equal(areas.find(a=>a.roomKeys.includes('storage'))!.kind,'room');
  assert.equal(findDirectoryRoute(rs,[],'hall','storage'),null);
});
test('reported circulation display retains local rises and excludes voids and unrelated native levels',async()=>{
  const {reportedCirculationRoomKeys}=await import('../lib/reviter/directory-areas.ts');
  const rs=[room('hall','Corridor',0,5),room('rotunda','Rotunda',6,10),{...room('void','Rotunda',12,16),walkability:'void' as const},room('upper','Office',18,22,43)];
  const reports:AreaRelationship[]=['rotunda','void','upper'].map(k=>({rooms:['hall',k],kind:'access',evidence:'user-reported'}));
  assert.deepEqual(reportedCirculationRoomKeys(directoryAreas(rs,{rotunda:{elevation:3.28}}),reports),new Set(['hall','rotunda']));
});

test('staff circulation retains walkable geometry but cannot join public fills or routes',()=>{
  const staff={...room('staff','Corridor',5,10),access:{kind:'staff' as const,evidence:'user-reported' as const}};
  const rs=[room('west','Corridor',0,5),staff,room('east','Corridor',10,15)],before=structuredClone(rs),areas=directoryAreas(rs);
  assert.equal(areas.find(a=>a.roomKeys.includes('staff'))!.kind,'room');
  assert.deepEqual(areas.find(a=>a.kind==='hallway')!.roomKeys,['west','east']);
  assert.equal(areas.find(a=>a.kind==='hallway')!.polygons.length,2);
  const portal=(doorId:number,a:string,b:string):RoomPortal=>({doorId,rooms:[a,b],point:[doorId===1?5:10,5],from:[doorId===1?4:9,5],to:[doorId===1?6:11,5],halfWidth:1,halfHeight:1});
  assert.equal(findDirectoryRoute(rs,[portal(1,'west','staff'),portal(2,'staff','east')],'west','east'),null);
  assert.equal(findDirectoryRoute(rs,[],'staff','staff'),null);assert.deepEqual(rs,before);
  const data={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'model.rvt'},annotations:rs,accessReviewLocations:[{building:'10',levelId:42,point:[20,5],kind:'staff',evidence:'user-reported'}]};
  assert.deepEqual(parseRoomDirectory(JSON.stringify(data)),data);
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,annotations:[{...staff,access:{kind:'staff',evidence:'native'}}]})));
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,accessReviewLocations:[{...data.accessReviewLocations[0],point:[null,5]}]})));
});
