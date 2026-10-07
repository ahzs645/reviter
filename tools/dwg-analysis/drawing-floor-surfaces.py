"""Checked source-stroke floor comparisons with protected open-to-below rings."""
import hashlib, json, math
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union

def source_rings(floor, chains, maximum_join, envelope=None):
    if not 0 <= maximum_join <= .002 or len(chains)<1:
        raise ValueError('Floor comparison needs bounded source joins and protected inner rings')
    primitives={p['sourceHandle']:p for p in floor['primitives']}
    rings=[]
    for ring_index,chain in enumerate(chains):
        if ring_index==0 and envelope:
            rings.append(facade_envelope(floor,envelope));continue
        if len(chain)<2 or len(set(json.dumps(c,sort_keys=True) for c in chain))!=len(chain):raise ValueError('Invalid source chain')
        parts=[]
        for c in chain:
            if type(c['reverse']) is not bool:raise ValueError('Invalid chain direction')
            if 'doorId' in c:
                d=next((d for d in floor.get('doors',[]) if d['id']==c['doorId']),None)
                if not d or 'handle' in c or type(c.get('thresholdIndex')) is not int or not 0<=c['thresholdIndex']<len(d['thresholdSegmentsMetres']):raise ValueError('Unsupported door witness')
                pts=d['thresholdSegmentsMetres'][c['thresholdIndex']]
            else:
                pts=primitives[c['handle']]['pointsMetres']
                if 'segmentIndex' in c:
                    i=c['segmentIndex']
                    if type(i) is not int or not 0<=i<len(pts)-1:raise ValueError('Invalid finite source segment')
                    pts=pts[i:i+2]
            if 'interval' in c:
                interval=c['interval']
                if len(pts)!=2 or len(interval)!=2 or any(not math.isfinite(t) or not 0<=t<=1 for t in interval) or interval[0]==interval[1]:raise ValueError('Invalid finite source interval')
                a,b=pts;pts=[[a[i]+t*(b[i]-a[i]) for i in (0,1)] for t in interval]
            if len(pts)<2 or any(len(p)!=2 or not all(math.isfinite(v) for v in p) for p in pts):raise ValueError('Invalid source stroke')
            parts.append([list(p) for p in (list(reversed(pts)) if c['reverse'] else pts)])
        for index,(a,b) in enumerate(zip(parts,parts[1:]+parts[:1])):
            if math.dist(a[-1],b[0])>maximum_join+1e-12:raise ValueError('Unsupported floor source join')
            if math.dist(a[-1],b[0])<=.00002:
                b[0]=list(a[-1]);continue
            # An original end may already contact the next finite stroke. Trim its
            # tiny overlapping start instead of adding a self-crossing backtrack.
            u=[b[1][i]-b[0][i] for i in (0,1)];den=sum(v*v for v in u)
            if den:
                t=sum((a[-1][i]-b[0][i])*u[i] for i in (0,1))/den
                q=[b[0][i]+t*u[i] for i in (0,1)]
                if 0<=t<=1 and math.dist(a[-1],q)<=1e-12:b[0]=list(a[-1])
        ring=[list(p) for pts in parts for p in pts];ring.append(list(ring[0]));rings.append(ring)
    poly=Polygon(rings[0],rings[1:])
    if not poly.is_valid or poly.area<=0:raise ValueError('Invalid floor/opening topology')
    return rings

def validate_surfaces(value,geometry,geometry_hash):
    if value['format']!='reviter-cad-floor-surfaces' or value['version']!=1 or value['sourceSha256']!=geometry['sourceSha256'] or value['geometrySha256']!=geometry_hash or value['appliedToNativeGeometry'] is not False or value['routingEligible'] is not False or value['graphEdges']:
        raise ValueError('Stale or non-comparison floor surfaces')
    if len(set(s['id'] for s in value['surfaces']))!=len(value['surfaces']):raise ValueError('Duplicate floor surface')
    for s in value['surfaces']:
        f=next(f for f in geometry['floors'] if f['id']==s['floorId'])
        r=next(r for r in f['regions'] if r['roomKey']==s['roomKey'])
        if f['buildingCode']!=s['buildingCode'] or s['openToBelowConfirmed'] is not True or s['physicalSlabVerified'] is not False:raise ValueError('Unsupported floor approval')
        rings=source_rings(f,s['sourceChains'],s['maximumJoinMetres'],s.get('assumedFacadeEnvelope'))
        if rings!=s['ringsMetres'] or not Polygon(rings[0],rings[1:]).contains(Point(r['anchorMetres'])):raise ValueError('Floor witness mismatch')
        surface_polygon(f,s)
        for c in s.get('boundaryCells',[]):
            room=next(r for r in f['regions'] if r['roomKey']==c['roomKey'])
            rr=source_rings(f,c['sourceChains'],s['maximumJoinMetres'])
            if rr!=c['ringsMetres'] or not Polygon(rr[0],rr[1:]).contains(Point(room['anchorMetres'])) or any(Polygon(rr[0],rr[1:]).intersection(Polygon(h)).area>1e-8 for h in s['ringsMetres'][1:]):raise ValueError('Invalid reviewed boundary cell')
    return value

def reviewed_polygons(floor,polys,surfaces):
    additions=[]
    for s in surfaces:
        if s['floorId']!=floor['id']:continue
        poly=surface_polygon(floor,s)
        additions.extend(list(poly.geoms) if hasattr(poly,'geoms') else [poly])
    holes=[Polygon(hole) for s in surfaces if s['floorId']==floor['id'] for hole in s['ringsMetres'][1:]]
    if not additions:return polys
    boundary_cells=[(c,Polygon(c['ringsMetres'][0],c['ringsMetres'][1:])) for s in surfaces if s['floorId']==floor['id'] for c in s.get('boundaryCells',[])]
    reserved=unary_union(additions+holes+[p for _,p in boundary_cells])
    result=[]
    for p in polys:
        # Replace a previously shared/faulty area only when its exact room seed
        # has a separately checked original-stroke boundary reconstruction.
        if any(p.contains(Point(next(r['anchorMetres'] for r in floor['regions'] if r['roomKey']==c['roomKey']))) for c,_ in boundary_cells):continue
        remainder=p.difference(reserved)
        parts=list(remainder.geoms) if hasattr(remainder,'geoms') else [remainder]
        result.extend(p for p in parts if p.geom_type=='Polygon' and p.area>=1)
    result.extend(additions);result.extend(p for _,p in boundary_cells)
    # No cell, even an unrelated original cell, may fill the confirmed openings.
    if any(p.intersection(h).area>1e-8 for p in result for h in holes):raise ValueError('A floor cell fills a protected opening')
    return result

def facade_envelope(floor,e):
    if not e.get('reason','').strip():raise ValueError('Unsupported assumed facade floor envelope')
    primitives={p['sourceHandle']:p for p in floor['primitives']};values={};spans={}
    for side in ['left','right','bottom','top']:
        axis=0 if side in ['left','right'] else 1;other=1-axis;spans[side]=[]
        if not e.get(side):raise ValueError('Missing finite facade face')
        for c in e[side]:
            points=primitives[c['handle']]['pointsMetres'];i=c['segmentIndex']
            if type(i) is not int or not 0<=i<len(points)-1:raise ValueError('Invalid facade segment')
            a,b=points[i:i+2]
            if abs(a[axis]-b[axis])>.00002 or abs(a[other]-b[other])<.001:raise ValueError('Unsupported facade plane')
            values.setdefault(side,a[axis])
            if abs(a[axis]-values[side])>.00002:raise ValueError('Inconsistent facade plane')
            spans[side].append(sorted([a[other],b[other]]))
    l,r,b,t=[values[x] for x in ['left','right','bottom','top']]
    if not l<r or not b<t:raise ValueError('Invalid facade bounds')
    for side in spans:
        lo,hi=(b,t) if side in ['left','right'] else (l,r);end=lo;length=0
        for a,z in sorted((max(a,lo),min(z,hi)) for a,z in spans[side] if min(z,hi)>max(a,lo)):
            length+=max(0,z-max(a,end));end=max(end,z)
        if length/(hi-lo)<.35:raise ValueError('Insufficient finite facade evidence')
    return [[l,b],[r,b],[r,t],[l,t],[l,b]]

def surface_polygon(floor,s):
    walls={w['id']:w for w in floor.get('wallCandidates',[])};ids=s.get('excludedWallPairIds',[])
    if len(ids)!=len(set(ids)):raise ValueError('Duplicate surface obstacle')
    poly=Polygon(s['ringsMetres'][0],s['ringsMetres'][1:])
    if ids:poly=poly.difference(unary_union([Polygon(walls[id]['ringsMetres'][0],walls[id]['ringsMetres'][1:]) for id in ids]))
    return poly
