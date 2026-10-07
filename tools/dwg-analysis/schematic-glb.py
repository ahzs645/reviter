"""Export a review-only floor schematic, with every assumption in glTF extras."""
import json, struct
from shapely.geometry import Polygon
from shapely.ops import triangulate

WALL_HEIGHT=2.7
DOOR_HEIGHT=2.1

def cuboid(ring,height):
    # Paired source faces always form a four-corner footprint.
    a,b,c,d=[(p[0],0,-p[1]) for p in ring[:4]]
    top=[(p[0],height,p[2]) for p in (a,b,c,d)];base=[a,b,c,d]
    faces=[(0,1,2,3)]
    positions=[]
    for i in range(4):
        q=[base[i],base[(i+1)%4],top[(i+1)%4],top[i]]
        positions.extend([q[0],q[1],q[2],q[0],q[2],q[3]])
    positions.extend([top[0],top[1],top[2],top[0],top[2],top[3]])
    return positions

def export_floor(path,floor,evidence_sha):
    binary=bytearray();views=[];accessors=[];meshes=[];nodes=[]
    def mesh(name,positions,material,extras,mode=4):
        if not positions:return
        flat=[v for p in positions for v in p];offset=len(binary)
        binary.extend(struct.pack('<'+'f'*len(flat),*flat))
        views.append(dict(buffer=0,byteOffset=offset,byteLength=len(flat)*4,target=34962))
        accessors.append(dict(bufferView=len(views)-1,componentType=5126,count=len(positions),type='VEC3',min=[min(p[i] for p in positions) for i in range(3)],max=[max(p[i] for p in positions) for i in range(3)]))
        meshes.append(dict(name=name,primitives=[dict(attributes=dict(POSITION=len(accessors)-1),mode=mode,material=material)]))
        nodes.append(dict(name=name,mesh=len(meshes)-1,extras=dict(**extras,routingEligible=False,physicalGeometryVerified=False)))
    for w in floor['wallCandidates']:
        mesh(w['id'],cuboid(w['ringsMetres'][0],WALL_HEIGHT),0,dict(kind='measured-wall-pair-candidate',sourceHandles=w['sourceHandles'],measuredWidthMetres=w['widthMetres'],illustrativeHeightMetres=WALL_HEIGHT))
    seen=set()
    for r in floor['regions']:
        if not r['ringsMetres']:continue
        key=json.dumps(r['ringsMetres'])
        if key in seen:continue
        seen.add(key);p=Polygon(r['ringsMetres'][0],r['ringsMetres'][1:]);positions=[]
        for t in triangulate(p):
            # Full polygon containment, not centroid sampling, protects holes.
            if p.covers(t):positions.extend((float(x),.002,-float(y)) for x,y in list(t.exterior.coords)[:3])
        mesh('region:'+r['roomKey'],positions,1,dict(kind='drawing-region-not-native-slab',roomKeys=r['sharedRoomKeys'],regionStatus=r['status']))
    for d in floor['doors']:
        a,b=d['closedLeafMetres'];q=[(a[0],0,-a[1]),(b[0],0,-b[1]),(b[0],DOOR_HEIGHT,-b[1]),(a[0],DOOR_HEIGHT,-a[1])]
        mesh(d['id'],[q[0],q[1],q[2],q[0],q[2],q[3]],2,dict(kind='door-symbol-preview',sourceHandles=d['arcHandles']+d['leafHandles'],openingWidthMetres=d['widthMetres'],illustrativeHeightMetres=DOOR_HEIGHT,nativeDoorId=None))
    for s in floor['stairs']:
        mesh(s['id'],[(p[0],.01,-p[1]) for t in s['treads'] for p in t['pointsMetres']],3,dict(kind='schematic-tread-run',sourceHandles=s['sourceHandles'],riseMetres=None,landingVerified=False),1)
    for a in floor.get('stairAreas',[]):
        p=Polygon(a['ringsMetres'][0],a['ringsMetres'][1:]);positions=[]
        for t in triangulate(p):
            if p.covers(t):positions.extend((float(x),.006,-float(y)) for x,y in list(t.exterior.coords)[:3])
        mesh(a['id'],positions,4,dict(kind='source-bounded-drawing-stair-area',sourceHandles=a['sourceHandles'],runIds=a['runIds'],floorSupportVerified=False,landingVerified=False,riseMetres=None))
    colours=[[.72,.51,.25,1],[.38,.72,.59,1],[.12,.51,.71,1],[.65,.15,.63,1],[.55,.4,.75,1]]
    gltf=dict(asset=dict(version='2.0',generator='OpenIndoorMaps separate CAD schematic'),scene=0,scenes=[dict(nodes=list(range(len(nodes))))],nodes=nodes,meshes=meshes,
        materials=[dict(doubleSided=True,pbrMetallicRoughness=dict(baseColorFactor=c,metallicFactor=0,roughnessFactor=1)) for c in colours],
        buffers=[dict(byteLength=len(binary))],bufferViews=views,accessors=accessors,
        extras=dict(format='openindoormaps-cad-schematic',floorId=floor['id'],evidenceSha256=evidence_sha,physicalElevationMetres=None,routingEligible=False,wallHeightMetres=WALL_HEIGHT,doorHeightMetres=DOOR_HEIGHT,heightsAreIllustrative=True,notes='Paired wall faces may be windows/frames. Regions are not native slabs. Stair rise and physical elevations are unknown.'))
    encoded=json.dumps(gltf,separators=(',',':'),allow_nan=False).encode();encoded+=b' '*((-len(encoded))%4);binary.extend(b'\0'*((-len(binary))%4))
    result=struct.pack('<4sII',b'glTF',2,12+8+len(encoded)+8+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(binary),b'BIN\0')+binary
    path.write_bytes(result)
