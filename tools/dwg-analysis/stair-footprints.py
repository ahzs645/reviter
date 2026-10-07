"""Exact source-bounded drawing stair areas and explicit unresolved coverage.

No hulls, buffered footprints, elevations, stair directions or routes are made.
The remainder outside measured tread bands is a landing *candidate*, not slab.
"""
import math
import numpy as np
from shapely.geometry import Polygon,LineString,Point
from shapely.ops import unary_union

def polygon_rings(p):
    return [list(map(list,p.exterior.coords))]+[list(map(list,h.coords)) for h in p.interiors]

def is_stair_room(room):
    return 'stair' in room.get('name','').lower() or '-S' in room.get('number','')

def finite_face_flight(floor,run,max_terminal_projection=.00002):
    """Intersect two finite source side faces with two original terminal risers.

    This is not a hull of points: all four sides must already exist and each
    corner must lie on BOTH finite measured source strokes, allowing 20 µm
    at a riser end for the intake's five-decimal metre coordinate rounding.
    Original strokes stay unchanged. Crossing labels
    remain a review conflict, rather than suppressing an evidenced flight.
    """
    if any('sourceHandle' not in t or 'sourceSegmentIndex' not in t for t in run['treads']):return None,[]
    first,last=run['treads'][0],run['treads'][-1]
    a,b=first['pointsMetres'];u=np.array(b)-a;u=u/np.linalg.norm(u);n=np.array([-u[1],u[0]])
    ps=np.array([p for t in run['treads'] for p in t['pointsMetres']]);lo,hi=min(ps@u),max(ps@u)
    planes=[float(np.mean(np.array(t['pointsMetres']),axis=0)@n) for t in (first,last)]
    ends=sorted(planes);faces=[];tread_keys={(t['sourceHandle'],t['sourceSegmentIndex']) for t in run['treads']}
    for p in floor['primitives']:
        if p['type'] not in ('LINE','LWPOLYLINE'):continue
        for i,(a,b) in enumerate(zip(p['pointsMetres'],p['pointsMetres'][1:])):
            if (p['sourceHandle'],i) in tread_keys:continue
            a,b=np.array(a),np.array(b);length=np.linalg.norm(b-a)
            if length<.3 or abs(float((b-a)@u))/length>.002:continue
            across=float(((a+b)/2)@u)
            if min(abs(across-lo),abs(across-hi))>.12:continue
            extent=sorted([float(a@n),float(b@n)])
            if extent[0]>ends[0]+.00002 or extent[1]<ends[1]-.00002:continue
            faces.append((across,a,b,p['sourceHandle']))
    candidates=[]
    for left in faces:
        for right in faces:
            if right[0]-left[0]<(hi-lo)*.85:continue
            corners=[];valid=True
            for face,t in [(left,first),(right,first),(right,last),(left,last)]:
                side=LineString([face[1],face[2]]);riser=LineString(t['pointsMetres'])
                if max_terminal_projection:
                    a,b=map(np.array,t['pointsMetres']);axis=(b-a)/np.linalg.norm(b-a)
                    riser=LineString([a-axis*max_terminal_projection,b+axis*max_terminal_projection])
                intersection=side.intersection(riser)
                if intersection.geom_type!='Point':valid=False;break
                corners.append(list(intersection.coords[0]))
            if not valid:continue
            p=Polygon(corners)
            if not p.is_valid or p.area<.1:continue
            # Preserve independently closed original inner profiles. Material
            # ownership is unresolved, so a closed obstacle is not filled.
            for source in floor['primitives']:
                if source.get('closed') or source['type']=='CIRCLE':
                    q=Polygon(source['pointsMetres'])
                    if q.is_valid and q.area>=.04 and p.contains(q):p=p.difference(q)
            if p.geom_type=='Polygon':candidates.append((p,[left[3],right[3],first['sourceHandle'],last['sourceHandle']]))
    return min(candidates,key=lambda x:x[0].area) if candidates else (None,[])

def recover_stair_areas(floor,polygons,capped_polygons=None):
    runs=floor['stairs'];rooms=floor['rooms'];matches={};areas=[];finite_proofs={}
    for run in runs:
        lines=unary_union([LineString(t['pointsMetres']) for t in run['treads']]);band=Polygon(run['ringsMetres'][0]);candidates=[]
        for p in polygons:
            if p.area>120 or p.area>max(16,band.area*4+6):continue
            if lines.length==0 or p.buffer(.001).intersection(lines).length/lines.length<.85:continue
            labels=[r for r in rooms if p.covers(Point(r['anchorMetres']))]
            if any(not is_stair_room(r) for r in labels):continue
            # A floor-sized polygon with no label is not a stair enclosure.
            if p.area<band.area*.85:continue
            candidates.append(p)
        if candidates:matches[run['id']]=min(candidates,key=lambda p:p.area)
        elif capped_polygons is not None:
            for p in capped_polygons:
                if p.area>max(16,band.area*4+6) or p.area<band.area*.85:continue
                if p.buffer(.001).intersection(lines).length/lines.length<.85:continue
                if any(not is_stair_room(r) and p.covers(Point(r['anchorMetres'])) for r in rooms):continue
                candidates.append(p)
            if candidates:
                p=min(candidates,key=lambda p:p.area);landings=[]
                # Only exact closed drawing cells sharing a substantial terminal
                # riser can suggest a landing. Never fill an unbounded remainder.
                for q in capped_polygons:
                    if q.equals(p) or q.area<.25 or q.area>max(16,band.area*2+4):continue
                    if q.intersection(p).area>.001:continue
                    if any(q.covers(Point(r['anchorMetres'])) and not is_stair_room(r) for r in rooms):continue
                    caps=[LineString(t['pointsMetres']) for t in (run['treads'][0],run['treads'][-1])]
                    if not any(q.boundary.intersection(cap).length>=run['widthMetres']*.5 for cap in caps):continue
                    if any(q.intersection(Polygon(s['ringsMetres'][0])).area>.01 for s in runs if s['id']!=run['id']):continue
                    landings.append(q)
                union=unary_union([p,*landings])
                if union.geom_type=='Polygon':matches[run['id']]=union
        if run['id'] not in matches:
            p,proof=finite_face_flight(floor,run)
            if p is not None:matches[run['id']]=p;finite_proofs[run['id']]=proof
    used=set()
    for run in runs:
        p=matches.get(run['id'])
        if p is None or p.wkb_hex in used:continue
        used.add(p.wkb_hex);owners=[s for s in runs if s['id'] in matches and matches[s['id']].equals(p)]
        bands=unary_union([Polygon(s['ringsMetres'][0]) for s in owners]);remainder=p.difference(bands)
        parts=[remainder] if remainder.geom_type=='Polygon' else list(getattr(remainder,'geoms',[]))
        landing=[polygon_rings(q) for q in parts if q.geom_type=='Polygon' and q.area>=.1]
        nearby=[r for r in rooms if is_stair_room(r) and p.covers(Point(r['anchorMetres']))]
        handles=[]
        for source in floor['primitives']:
            line=LineString(source['pointsMetres'])
            if p.boundary.intersection(line).length>.001:handles.append(source['sourceHandle'])
        conflicts=[r['key'] for r in rooms if not is_stair_room(r) and p.covers(Point(r['anchorMetres']))]
        handles+=sum([finite_proofs.get(s['id'],[]) for s in owners],[])
        areas.append(dict(id=f'{floor["id"]}:stair-area:{len(areas)+1}',ringsMetres=polygon_rings(p),
                          runIds=[s['id'] for s in owners],roomKeys=[r['key'] for r in nearby],sourceHandles=sorted(set(handles)),
                          conflictingRoomKeys=conflicts,finiteFaceProofs={s['id']:finite_proofs[s['id']] for s in owners if s['id'] in finite_proofs},
                          precisionContactToleranceMetres=.00002 if any(s['id'] in finite_proofs for s in owners) else 0,
                          areaSquareMetres=round(p.area,4),landingCandidatePartsMetres=landing,
                          status='source-bounded-drawing-stair-area',footprintSource='original-faces-terminal-risers-and-measured-door-thresholds',
                          floorSupportVerified=False,landingVerified=False,riseMetres=None,direction=None,routingEligible=False))
    for run in runs:run['stairAreaId']=next((a['id'] for a in areas if run['id'] in a['runIds']),None)
    unresolved=[dict(kind='stair-run',id=s['id'],reason='No bounded source cell without other room labels covers this tread run.') for s in runs if not s['stairAreaId']]
    unresolved+=[dict(kind='stair-area',id=a['id'],reason='Original finite faces bound this flight, but non-stair label(s) overlap it. Review label placement and stair ownership.',roomKeys=a['conflictingRoomKeys']) for a in areas if a['conflictingRoomKeys']]
    for r in rooms:
        if is_stair_room(r) and not any(r['key'] in a['roomKeys'] for a in areas):
            nearby=sorted([(Polygon(a['ringsMetres'][0],a['ringsMetres'][1:]).distance(Point(r['anchorMetres'])),a['id']) for a in areas])
            unresolved.append(dict(kind='stair-label',id=r['key'],number=r['number'],relatedAreaIds=[key for distance,key in nearby if distance<=2],
                                   reason='Stair label is outside the recovered flight footprint(s). Compare the nearby flights and landing boundary before assigning this complete stair-space identity.'))
    return areas,unresolved

def propose_floor_links(floors):
    links=[]
    for building in sorted(set(f['buildingCode'] for f in floors)):
        levels=[f for f in floors if f['buildingCode']==building]
        for a,b in zip(levels,levels[1:]):
            # The intake's local alignment is provisional; expose the comparison
            # rather than silently assigning a native stop or physical elevation.
            scores=[]
            for x in a['stairAreas']:
                p=Polygon(x['ringsMetres'][0],x['ringsMetres'][1:])
                for y in b['stairAreas']:
                    q=Polygon(y['ringsMetres'][0],y['ringsMetres'][1:]);ratio=p.intersection(q).area/min(p.area,q.area)
                    if ratio>=.3:scores.append((ratio,x,y))
            for ratio,x,y in scores:
                if sum(1 for _,u,v in scores if u['id']==x['id'])!=1 or sum(1 for _,u,v in scores if v['id']==y['id'])!=1:continue
                links.append(dict(buildingCode=building,fromFloorId=a['id'],toFloorId=b['id'],fromAreaId=x['id'],toAreaId=y['id'],
                                  overlapRatio=round(ratio,4),status='aligned-drawing-stair-link-needs-review',routingEligible=False,
                                  servedFloorsVerified=False,physicalElevations=None))
    return links
