#!/usr/bin/env python3
"""Source-bound drawing path comparisons; never creates native/public route edges."""
import argparse, hashlib, importlib.util, json, math, shutil, sys, zipfile
from pathlib import Path
from shapely.geometry import Point, LineString, Polygon
from shapely.ops import triangulate, unary_union
from shapely import constrained_delaunay_triangles
from shapely.strtree import STRtree

HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location('abstract',HERE/'abstract-building-geometry.py')
abstract=importlib.util.module_from_spec(spec);spec.loader.exec_module(abstract)
closure_spec=importlib.util.spec_from_file_location('closures',HERE/'drawing-door-closures.py');closures=importlib.util.module_from_spec(closure_spec);closure_spec.loader.exec_module(closures)
surface_spec=importlib.util.spec_from_file_location('surfaces',HERE/'drawing-floor-surfaces.py');surface_module=importlib.util.module_from_spec(surface_spec);surface_spec.loader.exec_module(surface_module)

repair_spec=importlib.util.spec_from_file_location('circulation_repairs',HERE/'drawing-circulation-repairs.py');repair_module=importlib.util.module_from_spec(repair_spec);repair_spec.loader.exec_module(repair_module)

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rings(p):return [list(map(list,p.exterior.coords))]+[list(map(list,r.coords)) for r in p.interiors]
def analyse_floor(f,surfaces=None,interpretation=None):
    if interpretation:f=dict(f,doors=f['doors']+interpretation['doors'])
    selection_doors,closure_proofs=closures.recover_selection_closures(f)
    polys=repair_module.repaired_polygons(f,selection_doors,interpretation['contacts'],interpretation.get('stairRiserWitnesses',[])) if interpretation else abstract.drawing_polygons(f['primitives'],selection_doors,f['stairs'])
    polys=surface_module.reviewed_polygons(f,polys,surfaces or [])
    # A closed outer cell can still contain dangling partitions. Do not let
    # triangulation create shortcuts through those original source strokes.
    excluded_symbols={h for d in f['doors'] for h in d.get('arcHandles',[])}
    segment_key=lambda a,b:tuple(sorted(tuple(round(float(v),6) for v in p) for p in [a,b]))
    removed_symbols={segment_key(*ps) for d in f['doors'] for ps in d.get('leafSegmentsMetres',[])}
    removed_symbols.update(segment_key(*t['pointsMetres']) for stair in f['stairs'] for t in stair.get('treads',[]))
    removed_symbols.update(segment_key(*w['pointsMetres']) for w in (interpretation or {}).get('stairRiserWitnesses',[]))
    interior_barriers=[LineString([a,b]) for p in f['primitives'] if p['sourceHandle'] not in excluded_symbols for a,b in zip(p['pointsMetres'],p['pointsMetres'][1:]) if math.dist(a,b)>1e-6 and segment_key(a,b) not in removed_symbols]
    # Expanded, user-confirmed floor comparisons may distinguish the old
    # source delineation from the physical inner opening. Keep this assumption
    # bound to that exact reviewed floor, never infer marks from line size.
    delineations={part['handle'] for surface in surfaces or [] if surface['floorId']==f['id'] and surface.get('transitConfirmed') is True and surface.get('assumedFacadeEnvelope') for part in surface['sourceChains'][0] if 'handle' in part}
    if delineations:
        interior_barriers=[LineString([a,b]) for p in f['primitives'] if p['sourceHandle'] not in excluded_symbols|delineations for a,b in zip(p['pointsMetres'],p['pointsMetres'][1:]) if math.dist(a,b)>1e-6 and segment_key(a,b) not in removed_symbols]
    interior_tree=STRtree(interior_barriers) if interior_barriers else None
    if interpretation and interior_tree is not None:
        # A 20 micrometre numerical exclusion allows constrained meshing around
        # original dangling barriers. This only subtracts comparison area. It
        # is not an inferred physical wall width or pedestrian clearance.
        protected=[]
        for poly in polys:
            strokes=[interior_barriers[int(i)] for i in interior_tree.query(poly) if poly.intersects(interior_barriers[int(i)]) and not poly.boundary.covers(interior_barriers[int(i)].intersection(poly))]
            reduced=poly.difference(unary_union(strokes).buffer(.00002,cap_style=2,join_style=2)) if strokes else poly
            parts=list(reduced.geoms) if hasattr(reduced,'geoms') else [reduced]
            protected.extend(p for p in parts if p.geom_type=='Polygon' and p.area>=1)
        polys=protected
    tree=STRtree(polys) if polys else None
    def owners_at(p):return [int(i) for i in tree.query(p) if polys[int(i)].contains(p)] if tree else []
    cells=[]; nodes=[]; edges=[]; doors=[]; rooms=[]; by_cell={}; triangles={}; rejected_edges=0
    def add_node(pt,cell,kind):
        pt=[round(float(v),8) for v in pt] if kind in ('triangle','triangle-seam') else list(pt)
        id=len(nodes);nodes.append(dict(id=id,pointMetres=list(pt),cellId=cell,kind=kind));by_cell.setdefault(cell,[]).append(id);return id
    def edge(a,b,kind,door=None):
        nonlocal rejected_edges
        if a==b:return
        segment=LineString([nodes[a]['pointMetres'],nodes[b]['pointMetres']])
        if kind=='interior' and not polys[nodes[a]['cellId']].covers(segment if segment.length>1e-12 else Point(nodes[a]['pointMetres'])):
            rejected_edges+=1;return
        if kind=='interior' and interior_tree is not None and segment.length>1e-8:
            # Ignore only endpoint rounding, not a narrow wall encountered in
            # the middle of a leg. Curves stay barriers until interpreted.
            inner=LineString([segment.interpolate(min(.00002,segment.length/4)),segment.interpolate(max(segment.length-.00002,segment.length*.75))])
            if any(interior_barriers[int(i)].intersects(inner) for i in interior_tree.query(inner)):
                rejected_edges+=1;return
        edges.append(dict(a=a,b=b,lengthMetres=round(math.dist(nodes[a]['pointMetres'],nodes[b]['pointMetres']),8),kind=kind,doorId=door))
    for i,p in enumerate(polys):
        labels=[r for r in f['regions'] if p.contains(Point(r['anchorMetres']))]
        confirmed=any(s['floorId']==f['id'] and s.get('transitConfirmed') is True and surface_module.surface_polygon(f,s).covers(p) for s in surfaces or [])
        circulation=confirmed or bool(labels) and all(any(t in r['name'].lower() for t in ['corridor','circulation','hallway','lobby','vestibule','walkway']) for r in labels)
        stair=any('stair' in r['name'].lower() for r in labels)
        cells.append(dict(id=i,ringsMetres=rings(p),areaSquareMetres=p.area,roomKeys=[r['roomKey'] for r in labels],transit=circulation and not stair,status='drawing-circulation' if circulation and not stair else 'endpoint-only' if labels else 'unlabelled-needs-review'))
        # Delaunay triangles are accepted only if wholly covered, including holes.
        reviewed=any(s['floorId']==f['id'] for s in surfaces or [])
        # The explicitly reviewed curved ring needs constrained triangulation:
        # unconstrained Delaunay can leave pieces beside an inner concave arc.
        candidates=list(constrained_delaunay_triangles(p).geoms) if reviewed or interpretation else triangulate(p)
        ts=[t for t in candidates if p.covers(t)]
        triangles[i]=ts
        cells[-1]['meshedAreaSquareMetres']=sum(t.area for t in ts)
        cells[-1]['meshCoverageRatio']=sum(t.area for t in ts)/p.area
        seams={}
        for t in ts:
            n=add_node(t.centroid.coords[0],i,'triangle')
            pts=list(t.exterior.coords)
            for a,b in zip(pts,pts[1:]):
                key=tuple(sorted((a,b)))
                if key in seams:
                    other=seams[key];mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
                    m=add_node(mid,i,'triangle-seam');edge(other,m,'interior');edge(n,m,'interior')
                else:seams[key]=n
    def attach(pt,cell,kind):
        point=Point(pt); hits=[j for j,t in enumerate(triangles[cell]) if t.covers(point)]
        if not hits:return None
        # Triangle nodes were inserted interleaved with seam nodes; locate containing centroid.
        target=triangles[cell][hits[0]].centroid
        candidates=[n for n in by_cell[cell] if nodes[n]['kind']=='triangle' and Point(nodes[n]['pointMetres']).distance(target)<1e-8]
        if not candidates:return None
        n=add_node(pt,cell,kind);edge(n,candidates[0],'interior');return n
    for r in f['regions']:
        hits=owners_at(Point(r['anchorMetres']))
        cell=hits[0] if len(hits)==1 else None
        n=attach(r['anchorMetres'],cell,'room') if cell is not None else None
        rooms.append(dict(roomKey=r['roomKey'],number=r['number'],name=r['name'],nodeId=n,cellId=cell,status=('shared-drawing-region' if len(cells[cell]['roomKeys'])>1 else 'drawing-anchor') if n is not None else 'boundary-not-recovered'))
    # Original source segments are barriers, except measured door parts/supports.
    source=[];handles=[]
    for primitive in f['primitives']:
        for a,b in zip(primitive['pointsMetres'],primitive['pointsMetres'][1:]):
            if math.dist(a,b)>1e-6:source.append(LineString([a,b]));handles.append(primitive['sourceHandle'])
    barriers=STRtree(source) if source else None
    for d in f['doors']:
        record=dict(id=d['id'],arcHandle=d['arcHandle'],widthMetres=d['widthMetres'],closedLeafMetres=d['closedLeafMetres'],supportingWallHandles=d['supportingWallHandles'],cellIds=[],nodeIds=[],status='unmatched-area',reason='No unique enclosed drawing area on both sides.',routingEligible=False,access=None)
        a,b=d['closedLeafMetres'];w=math.dist(a,b)
        if w<1e-6:doors.append(record);continue
        nx,ny=-(b[1]-a[1])/w,(b[0]-a[0])/w
        middle=((a[0]+b[0])/2,(a[1]+b[1])/2)
        offsets=[(q[0]-middle[0])*nx+(q[1]-middle[1])*ny for s in d['thresholdSegmentsMetres'] for q in s]
        points=[];sides=[]
        for sign in [-1,1]:
            samples=[];approach=None
            for fraction in [.35,.5,.65]:
                origin=(a[0]+fraction*(b[0]-a[0]),a[1]+fraction*(b[1]-a[1]))
                ray=LineString([origin,(origin[0]+sign*.8*nx,origin[1]+sign*.8*ny)])
                hits=[]
                for idx in tree.query(ray) if tree else []:
                    idx=int(idx);part=polys[idx].intersection(ray)
                    parts=list(part.geoms) if hasattr(part,'geoms') else [part]
                    for portion in parts:
                        if portion.geom_type!='LineString' or portion.length<.03:continue
                        lo=min(ray.project(Point(p)) for p in portion.coords)
                        hi=max(ray.project(Point(p)) for p in portion.coords)
                        depth=lo+min(.015,(hi-lo)/2)
                        pt=(origin[0]+sign*depth*nx,origin[1]+sign*depth*ny)
                        if polys[idx].contains(Point(pt)):hits.append((lo,idx,pt))
                hits.sort(key=lambda x:x[0])
                if not hits or (len(hits)>1 and abs(hits[0][0]-hits[1][0])<1e-6):samples.append(None)
                else:
                    samples.append(hits[0][1])
                    if fraction==.5:approach=hits[0][2]
            if any(s is None for s in samples) or len(set(samples))!=1:break
            sides.append(samples[0]);points.append(approach)
        if len(sides)!=2:doors.append(record);continue
        record['cellIds']=sides
        if sides[0]==sides[1]:record.update(status='same-area-bypass',reason='Both sides reach the same drawing region; another opening bypasses this door.');doors.append(record);continue
        segment=LineString(points)
        excluded=set(d['supportingWallHandles']+d['arcHandles']+d['leafHandles'])
        conflicts=[handles[int(i)] for i in barriers.query(segment) if handles[int(i)] not in excluded and source[int(i)].intersects(segment)] if barriers else []
        if conflicts:record.update(status='source-obstacle',reason='Threshold crosses other original strokes.',conflictingHandles=sorted(set(conflicts)));doors.append(record);continue
        ns=[attach(p,c,'door-approach') for p,c in zip(points,sides)]
        if any(n is None for n in ns):record.update(status='mesh-incomplete',reason='The exact polygon triangulation does not cover both approach points.');doors.append(record);continue
        record.update(status='two-sided-drawing-door',reason='Measured symbol has unique areas on both sides; floor support, physical access and accessibility remain unassigned.',nodeIds=ns,approachPointsMetres=list(map(list,points)))
        edge(ns[0],ns[1],'door',d['id']);doors.append(record)
    # Direct terminal visibility avoids artificial triangle-centroid detours.
    # Unsafe shortcuts fall back to the contained triangulation network.
    for cell,ids in by_cell.items():
        terminals=[n for n in ids if nodes[n]['kind'] in ('room','door-approach')]
        for j,a in enumerate(terminals):
            for b in terminals[j+1:]:
                segment=LineString([nodes[a]['pointMetres'],nodes[b]['pointMetres']])
                if polys[cell].covers(segment if segment.length>1e-12 else Point(nodes[a]['pointMetres'])):edge(a,b,'interior')
    counts={s:sum(d['status']==s for d in doors) for s in sorted(set(d['status'] for d in doors))}
    return dict(id=f['id'],buildingCode=f['buildingCode'],name=f['name'],cells=cells,nodes=nodes,previewEdges=edges,doors=doors,rooms=rooms,doorStatusCounts=counts,rejectedInteriorEdges=rejected_edges,unmatchedArcHandles=[h for h in f['unresolvedDoorArcHandles'] if h not in {h for d in (interpretation or {}).get('doors',[]) for h in d['arcHandles']}],selectionDoorClosures=closure_proofs,comparisonBarrierExclusionMetres=.00002 if interpretation else 0,sourceFloorDelineationHandles=sorted(delineations),graphEdges=[],routingEligible=False)

def build(package,out,recipe=None,interpret_building=None):
    if out.exists():raise ValueError('Output must be a new separate directory')
    checks=json.loads((package/'checksums.json').read_text())
    for name in ['geometry.json','intake.json','floor-analysis.json']:
        if digest(package/name)!=checks[name]:raise ValueError('Changed input '+name)
    geometry=json.loads((package/'geometry.json').read_text()); floors=[]
    surface_file=package/'floor-surfaces.json';surface_hash=None;surfaces=[];surface_text=None
    if surface_file.exists():
        surface_hash=digest(surface_file)
        if checks.get('floor-surfaces.json')!=surface_hash:raise ValueError('Changed floor surface evidence')
        surfaces=surface_module.validate_surfaces(json.loads(surface_file.read_text()),geometry,digest(package/'geometry.json'))['surfaces']
    if recipe:
        if surface_file.exists() and json.loads(recipe.read_text()).get('supersedesFloorSurfacesSha256')!=surface_hash:raise ValueError('Revision must bind the exact previous floor review')
        review=json.loads(recipe.read_text())
        if review['sourceSha256']!=geometry['sourceSha256'] or review['geometrySha256']!=digest(package/'geometry.json'):raise ValueError('Stale floor surface recipe')
        surfaces=review['surfaces']
        for s in surfaces:
            f=next(f for f in geometry['floors'] if f['id']==s['floorId'])
            s['ringsMetres']=surface_module.source_rings(f,s['sourceChains'],s['maximumJoinMetres'],s.get('assumedFacadeEnvelope'))
            for c in s.get('boundaryCells',[]):c['ringsMetres']=surface_module.source_rings(f,c['sourceChains'],s['maximumJoinMetres'])
        review.update(format='reviter-cad-floor-surfaces',version=1,appliedToNativeGeometry=False,routingEligible=False,graphEdges=[])
        surface_module.validate_surfaces(review,geometry,digest(package/'geometry.json'))
        surface_text=json.dumps(review,separators=(',',':'))+'\n';surface_hash=hashlib.sha256(surface_text.encode()).hexdigest()
    interpretation=None;interpretation_text=None
    if interpret_building:
        scoped=[f for f in geometry['floors'] if interpret_building=='all' or f['buildingCode']==interpret_building]
        if not scoped:raise ValueError('Unknown building interpretation scope')
        reviewed=[]
        for f in scoped:
            derived=repair_module.detect_leaf_doors(f);contacts=repair_module.contact_repairs(f,f['doors']+derived)
            stair_symbols=repair_module.stair_riser_witnesses(f)
            before=abstract.drawing_polygons(f['primitives'],f['doors'],f['stairs']);after=repair_module.repaired_polygons(f,f['doors']+derived,contacts,stair_symbols)
            owners={r['roomKey']:[p for p in after if p.contains(Point(r['anchorMetres']))] for r in f['regions']}
            assessment=dict(beforeClosedLabels=sum(any(p.contains(Point(r['anchorMetres'])) for p in before) for r in f['regions']),afterClosedLabels=sum(len(ps)==1 for ps in owners.values()),sharedLabels=[r['roomKey'] for r in f['regions'] if any(sum(p.contains(Point(other['anchorMetres'])) for other in f['regions'])>1 for p in owners[r['roomKey']])],missingLabels=[r['roomKey'] for r in f['regions'] if len(owners[r['roomKey']])!=1])
            entrances=repair_module.open_entrance_candidates(f,f['doors']+derived,after)
            reviewed.append(dict(floorId=f['id'],doors=derived,contacts=contacts,stairRiserWitnesses=stair_symbols,entranceCandidates=entrances,assessment=assessment))
        interpretation=dict(format='reviter-cad-circulation-review',version=1,sourceSha256=geometry['sourceSha256'],geometrySha256=digest(package/'geometry.json'),maximumContactGapMetres=.002,appliedToNativeGeometry=False,routingEligible=False,graphEdges=[],floors=reviewed)
        interpretation_text=json.dumps(interpretation,separators=(',',':'))+'\n'
    elif (package/'circulation-review.json').exists():
        if digest(package/'circulation-review.json')!=checks.get('circulation-review.json'):raise ValueError('Changed circulation interpretation evidence')
        interpretation=json.loads((package/'circulation-review.json').read_text());interpretation_text=(package/'circulation-review.json').read_text()
    for f in geometry['floors']:
        scoped_review=next((r for r in interpretation['floors'] if r['floorId']==f['id']),None) if interpretation else None
        result=analyse_floor(f,surfaces,scoped_review);floors.append(result)
        if scoped_review:
            scoped_review['assessment'].update(afterClosedLabels=sum(r['nodeId'] is not None for r in result['rooms']),sharedLabels=[r['roomKey'] for r in result['rooms'] if r['status']=='shared-drawing-region'],missingLabels=[r['roomKey'] for r in result['rooms'] if r['nodeId'] is None])
        print(f['id'],len(result['cells']),result['doorStatusCounts'],flush=True)
    if interpretation:interpretation_text=json.dumps(interpretation,separators=(',',':'))+'\n'
    report=dict(format='reviter-cad-drawing-paths',version=1,sourceSha256=geometry['sourceSha256'],geometrySha256=digest(package/'geometry.json'),appliedToNativeGeometry=False,graphEdges=[],routingEligible=False,implementationSha256=digest(Path(__file__)),computedMeshPrecisionMetres=1e-8,floors=floors,limits=['Drawing comparison only; native floor support, elevations, access and accessibility remain unverified.','Only measured doors connect different cells. No gap filling, exterior guessing or stair edges.','Only named circulation is an intermediate area by default; other areas need explicit review.','Triangulation retains polygon holes; unmeshed pieces remain unreachable.'])
    if interpretation_text:report['circulationReviewSha256']=hashlib.sha256(interpretation_text.encode()).hexdigest();report['limits'].append('Source-bound derived leaf recognition and sub-2-mm comparison contacts are reversible interpretations; shared doorless areas need logical entrance review.')
    if surface_hash:report['floorSurfacesSha256']=surface_hash;report['limits'].append('Source-bound reviewed floor comparisons protect confirmed open-to-below inner rings. Remaining perimeter and bridge floor need review.')
    shutil.copytree(package,out,ignore=shutil.ignore_patterns('*.zip'))
    if surface_text:
        if surface_file.exists():
            history=out/'evidence/floor-surface-history';history.mkdir(exist_ok=True)
            shutil.copy2(surface_file,history/(digest(surface_file)+'.json'))
            if (package/'evidence/floor-surface-recipe.json').exists():shutil.copy2(package/'evidence/floor-surface-recipe.json',history/(digest(surface_file)+'.recipe.json'))
        (out/'floor-surfaces.json').write_text(surface_text)
        (out/'evidence/floor-surface-recipe.json').write_bytes(recipe.read_bytes())
    if interpretation_text:(out/'circulation-review.json').write_text(interpretation_text)
    (out/'drawing-paths.json').write_text(json.dumps(report,separators=(',',':'))+'\n')
    (out/'pipeline').mkdir(exist_ok=True)
    shutil.copy2(__file__,out/'pipeline/build-drawing-paths.py')
    abstract.package(out)
    summary=dict(floors=len(floors),doors=sum(len(f['doors']) for f in floors),twoSidedDoors=sum(f['doorStatusCounts'].get('two-sided-drawing-door',0) for f in floors),anchoredRooms=sum(r['nodeId'] is not None for f in floors for r in f['rooms']),missingRooms=sum(r['nodeId'] is None for f in floors for r in f['rooms']),nativeRouteEdges=0,buildings=[dict(code=code,floors=[dict(id=f['id'],doorStatusCounts=f['doorStatusCounts'],missingRooms=[dict(number=r['number'],name=r['name'],roomKey=r['roomKey']) for r in f['rooms'] if r['nodeId'] is None]) for f in floors if f['buildingCode']==code]) for code in sorted(set(f['buildingCode'] for f in floors))])
    (out/'drawing-paths-summary.json').write_text(json.dumps(summary,indent=2)+'\n');abstract.package(out)
    print(json.dumps({k:summary[k] for k in ['floors','doors','twoSidedDoors','anchoredRooms','missingRooms','nativeRouteEdges']},indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--surface-recipe',type=Path);p.add_argument('--interpret-building',help='Run source-bound leaf/contact interpretation for one building code or all');a=p.parse_args();build(a.package,a.out,a.surface_recipe,a.interpret_building)
