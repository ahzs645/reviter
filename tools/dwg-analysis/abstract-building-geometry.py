#!/usr/bin/env python3
"""Source-bound CAD abstraction, separate from native Revit geometry and routes."""
import argparse, hashlib, importlib.util, json, math, shutil, subprocess, zipfile
from pathlib import Path
from collections import Counter
import ezdxf
import numpy as np
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union, polygonize
from shapely.strtree import STRtree
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('intake_builder',HERE/'build-building-intake.py')
intake=importlib.util.module_from_spec(spec);spec.loader.exec_module(intake)
def helper(name):
    s=importlib.util.spec_from_file_location(name,HERE/(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
analytic_doors=helper('cad-door-symbols')
stair_footprints=helper('stair-footprints')

def write(p,d):p.write_text(json.dumps(d,separators=(',',':'),allow_nan=False))
def rings(p):return [list(map(list,p.exterior.coords))]+[list(map(list,r.coords)) for r in p.interiors]

def primitive(entity, floor, scale):
    """Analytic source geometry and its independent, bounded display tessellation."""
    kind=entity.dxftype();a=floor['alignment'];local=lambda p:intake.local_point([p[0],p[1]],a,scale)
    result=dict(id=entity.dxf.handle,type=kind,layer=entity.dxf.layer,sourceHandle=entity.dxf.handle)
    if kind=='ARC':
        centre=local(entity.dxf.center);r=entity.dxf.radius*scale
        start=math.radians(entity.dxf.start_angle+a['rotationDegrees']);sweep=math.radians((entity.dxf.end_angle-entity.dxf.start_angle)%360)
        # 2 mm chord sagitta, at least 16 samples for door quarter arcs.
        count=max(16,math.ceil(sweep/max(.01,2*math.acos(max(-1,1-.002/max(r,.002))))))
        result.update(centreMetres=centre,radiusMetres=r,startRadians=start,sweepRadians=sweep,
            pointsMetres=[[centre[0]+r*math.cos(start+sweep*i/count),centre[1]+r*math.sin(start+sweep*i/count)] for i in range(count+1)])
    else:
        ps=intake.recovery.flatten_entity_points(entity,.002/scale) # 2 mm tolerance from independently established scale
        result['pointsMetres']=[local(p) for p in ps]
        if kind=='CIRCLE':result.update(centreMetres=local(entity.dxf.center),radiusMetres=entity.dxf.radius*scale)
        if kind=='LWPOLYLINE':result.update(closed=bool(entity.closed),sourceVerticesDrawing=[list(v) for v in entity.get_points('xyb')])
        if kind=='ELLIPSE':result.update(centreMetres=local(entity.dxf.center),majorAxisDrawing=list(entity.dxf.major_axis),axisRatio=entity.dxf.ratio,startParameter=entity.dxf.start_param,endParameter=entity.dxf.end_param)
    return result

def wall_pairs(lines, excluded):
    """Measured paired-face candidates, never classify a whole CAD layer solid."""
    rows=[]
    for l in lines:
        if l['sourceHandle'] in excluded or l['type']!='LINE':continue
        ps=l['pointsMetres'];a=np.array(ps[0]);b=np.array(ps[-1]);length=np.linalg.norm(b-a)
        if length<1.2:continue
        u=(b-a)/length
        if u[0]<-1e-6 or (abs(u[0])<1e-6 and u[1]<0):a,b=b,a;u=-u
        rows.append(dict(a=a,b=b,u=u,length=length,handle=l['sourceHandle']))
    shapes=[LineString([s['a'],s['b']]) for s in rows];tree=STRtree(shapes);seen=set();out=[]
    for i,s in enumerate(rows):
        for j in tree.query(shapes[i].buffer(.65)):
            j=int(j)
            if j<=i:continue
            t=rows[j]
            if abs(s['u'][0]*t['u'][1]-s['u'][1]*t['u'][0])>.003:continue
            n=np.array([-s['u'][1],s['u'][0]]);offset=float((t['a']-s['a'])@n);width=abs(offset)
            if not .07<=width<=.65:continue
            lo=max(0,float((t['a']-s['a'])@s['u']));hi=min(s['length'],float((t['b']-s['a'])@s['u']))
            if hi-lo<1.2:continue
            key=tuple(sorted((s['handle'],t['handle'])))
            if key in seen:continue
            seen.add(key);p=s['a']+lo*s['u'];q=s['a']+hi*s['u']
            out.append(dict(id='wall-pair:'+':'.join(key),sourceHandles=list(key),widthMetres=round(width,6),
                axisMetres=[((p+offset*n/2)).tolist(),((q+offset*n/2)).tolist()],
                ringsMetres=[list(map(lambda v:v.tolist(),[p,q,q+offset*n,p+offset*n]))],
                status='measured-parallel-faces-needs-material-review',physicalWallVerified=False,routingEligible=False))
    return out

def drawing_polygons(primitives, doors, stairs):
    excluded_arcs={h for d in doors for h in d['arcHandles']}
    def segment_key(ps):return tuple(sorted(tuple(round(float(v),6) for v in p) for p in ps))
    removed={segment_key(ps) for d in doors for ps in d.get('leafSegmentsMetres',[])}
    removed.update(segment_key(t['pointsMetres']) for s in stairs for t in s.get('treads',[]))
    lines=[]
    for p in primitives:
        if p['sourceHandle'] in excluded_arcs:continue
        for a,b in zip(p['pointsMetres'],p['pointsMetres'][1:]):
            if math.dist(a,b)>.000001 and segment_key([a,b]) not in removed:lines.append(LineString([a,b]))
    lines += [LineString(s) for d in doors for s in d['thresholdSegmentsMetres']]
    return [p for p in polygonize(unary_union(lines)) if p.area>=1 and p.is_valid]

def regions(primitives, doors, stairs, rooms):
    polys=drawing_polygons(primitives,doors,stairs)
    result=[]
    for room in rooms:
        candidates=[p for p in polys if p.covers(Point(room['anchorMetres']))]
        p=min(candidates,key=lambda x:x.area) if candidates else None
        owners=[r['key'] for r in rooms if p and p.covers(Point(r['anchorMetres']))]
        result.append(dict(roomKey=room['key'],number=room['number'],name=room['name'],anchorMetres=room['anchorMetres'],
            ringsMetres=rings(p) if p else [],areaSquareMetres=round(p.area,3) if p else None,sharedRoomKeys=owners,
            status='closed-drawing-region-needs-review' if p and len(owners)==1 else 'shared-drawing-region' if p else 'not-recovered',
            enclosureVerified=False,routingEligible=False))
    return result

def build(args):
    original=args.intake/'intake.json';data=json.loads(original.read_text());doc=ezdxf.readfile(args.review/'stage/floorplans.dxf')
    if intake.sha(args.review/'stage/floorplans.dxf')!=data['conversionEvidence']['floorDxfSha256']:raise ValueError('DXF binding changed')
    for f in data['sourceFiles']:
        if intake.sha(args.intake/'source'/f['name'])!=f['sha256']:raise ValueError('Original DWG binding changed')
    scale=data['unitEvidence']['metresPerDrawingUnit'];all_floors=[];groups=[];counts=[]
    for b in data['buildings']:
        for floor in b['floors']:
            seen=set();ps=[]
            for l in floor['linework']:
                h=l['sourceHandle']
                if h in seen:continue
                seen.add(h);entity=doc.entitydb.get(h)
                if entity is None:raise ValueError('Missing source handle '+h)
                p=primitive(entity,dict(floor,alignment=l.get('sourceAlignment',floor['alignment'])),scale)
                if len(p['pointsMetres'])>=2:ps.append(p)
            straight=[]
            for p in ps:
                if p['type']=='ARC':continue
                for a,z in zip(p['pointsMetres'],p['pointsMetres'][1:]):
                    if math.dist(a,z)>.001:straight.append(dict(sourceHandle=p['sourceHandle'],pointsMetres=[a,z]))
            shapes=[LineString(l['pointsMetres']) for l in straight];tree=STRtree(shapes)
            candidates=[p for p in ps if p['type']=='ARC' and .27432<=p['radiusMetres']<=2.4384 and math.radians(82)<=p['sweepRadians']<=math.radians(98)]
            for arc in candidates:
                centre=arc['centreMetres'];r=arc['radiusMetres'];crop=box(centre[0]-r-1,centre[1]-r-1,centre[0]+r+1,centre[1]+r+1)
                segs=[straight[int(i)] for i in tree.query(crop,predicate='intersects')]
                segs += [dict(sourceHandle=arc['sourceHandle'],pointsMetres=[a,z]) for a,z in zip(arc['pointsMetres'],arc['pointsMetres'][1:])]
                groups.append(dict(id=f"{floor['id']}:door:{arc['id']}",floorId=floor['id'],arcHandle=arc['sourceHandle'],segments=segs))
            all_floors.append(dict(buildingCode=b['code'],id=floor['id'],name=floor['name'],alignment=floor['alignment'],elevationMetres=None,
                primitives=ps,rooms=floor['rooms'],stairHints=floor['stairSymbols'],doorCandidateCount=len(candidates)))
    args.out.mkdir(parents=True,exist_ok=True);write(args.out/'door-recognizer-input.json',groups)
    subprocess.run(['node','--experimental-strip-types',str(HERE/'abstract-door-symbols.mjs'),str(args.out/'door-recognizer-input.json'),str(args.out/'door-recognizer-output.json'),str(args.reviter)],check=True)
    doors=json.loads((args.out/'door-recognizer-output.json').read_text())
    for floor in all_floors:
        found=[d for d in doors if d['floorId']==floor['id']];seen=set();floor['doors']=[]
        for d in found:
            key=tuple(d['closedLeafMetres'][0]+d['closedLeafMetres'][1])
            if key in seen:continue
            seen.add(key);d['swingPointsMetres']=next(p['pointsMetres'] for p in floor['primitives'] if p['sourceHandle']==d['arcHandle']);floor['doors'].append(d)
        floor.pop('stairHints')
        floor['doors']+=analytic_doors.detect_analytic_doors(floor['primitives'],floor['id'],floor['doors'])
        floor['stairs']=[dict(**hint,riseMetres=None,direction=None,landingVerified=False) for hint in intake.stair_symbols.detect_tread_runs(floor['primitives'])]
        known={(t['sourceHandle'],t['sourceSegmentIndex']) for s in floor['stairs'] for t in s['treads']};short=[]
        for s in intake.stair_symbols.detect_tread_runs(floor['primitives'],min_treads=4):
            if s['treadCount']>5 or any((t['sourceHandle'],t['sourceSegmentIndex']) in known for t in s['treads']):continue
            band=Polygon(s['ringsMetres'][0])
            context=any(band.distance(Polygon(v['ringsMetres'][0]))<2 for v in floor['stairs']) or any(stair_footprints.is_stair_room(r) and band.distance(Point(r['anchorMetres']))<2 for r in floor['rooms'])
            if context:short.append(dict(**s,riseMetres=None,direction=None,landingVerified=False,recognitionMethod='short-regular-run-with-stair-context-and-source-cell'))
        if short:
            candidate=dict(floor,stairs=floor['stairs']+short)
            capped=[dict(s,treads=s['treads'][1:-1]) for s in candidate['stairs']]
            areas,_=stair_footprints.recover_stair_areas(candidate,drawing_polygons(floor['primitives'],floor['doors'],candidate['stairs']),drawing_polygons(floor['primitives'],floor['doors'],capped))
            accepted={a['id'] for a in areas if not a['conflictingRoomKeys']}
            floor['stairs']+=[s for s in short if s['stairAreaId'] in accepted]
        excluded={h for d in floor['doors'] for h in d['arcHandles']+d['leafHandles']};excluded.update(h for s in floor['stairs'] for h in s['sourceHandles'])
        floor['wallCandidates']=wall_pairs(floor['primitives'],excluded)
        floor['regions']=regions(floor['primitives'],floor['doors'],floor['stairs'],floor['rooms'])
        capped=[dict(s,treads=s['treads'][1:-1]) for s in floor['stairs']]
        floor['stairAreas'],floor['stairReview']=stair_footprints.recover_stair_areas(floor,drawing_polygons(floor['primitives'],floor['doors'],floor['stairs']),drawing_polygons(floor['primitives'],floor['doors'],capped))
        floor['unresolvedDoorArcHandles']=[g['arcHandle'] for g in groups if g['floorId']==floor['id'] and not any(g['arcHandle']==d['arcHandle'] for d in floor['doors'])]
        counts.append(dict(floorId=floor['id'],primitives=len(floor['primitives']),supportedDoorSymbols=len(floor['doors']),unresolvedDoorArcs=len(floor['unresolvedDoorArcHandles']),stairs=len(floor['stairs']),stairAreas=len(floor['stairAreas']),unresolvedStairItems=len(floor['stairReview']),wallPairs=len(floor['wallCandidates']),regions=dict(Counter(r['status'] for r in floor['regions']))))
    output=dict(format='openindoormaps-cad-geometry',version=1,sourceSha256=data['sourceSha256'],intakeEvidenceSha256=data['evidenceSha256'],intakeFileSha256=intake.sha(original),
        extractionEvidence=dict(pythonSha256=intake.sha(Path(__file__)),bridgeSha256=intake.sha(HERE/'abstract-door-symbols.mjs'),recognizerSha256=intake.sha(args.reviter/'lib/reviter/registered-single-door-swings.ts'),analyticDoorSha256=intake.sha(HERE/'cad-door-symbols.py'),stairFootprintSha256=intake.sha(HERE/'stair-footprints.py'),stairDetectorSha256=intake.sha(HERE/'stair-symbols.py'),schematicExporterSha256=intake.sha(HERE/'schematic-glb.py'),method='Reviter guarded single-door recognizer; analytic finite-jamb fallback; measured parallel faces; exact tread and bounded drawing stair areas'),
        conversionEvidence=data['conversionEvidence'],unitEvidence=data['unitEvidence'],coordinateSystem='building-local-metres',floors=all_floors,
        graphEdges=[],stairConnectionCandidates=stair_footprints.propose_floor_links(all_floors),appliedToNativeGeometry=False,notes=['Drawing symbols are authoring evidence, not native physical doors or access permissions.',
        'Wall pairs are measured candidate strips; material, window/frame ownership and wall joins require review.',
        'No physical elevation, stair rise, floor support or campus placement invented. No automatic gap repair.'])
    output['evidenceSha256']=hashlib.sha256(json.dumps(output,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    review=dict(format='openindoormaps-cad-detection-review',version=1,evidenceSha256=output['evidenceSha256'],floors=[])
    for f in all_floors:
        review['floors'].append(dict(floorId=f['id'],rooms=[dict(roomKey=r['roomKey'],number=r['number'],status=r['status'],sharedRoomKeys=r['sharedRoomKeys'],
                                                              reason='Original strokes and proved door contacts still connect multiple room identities.' if r['ringsMetres'] else 'No original closed drawing cell contains the room label.') for r in f['regions'] if r['status']!='closed-drawing-region-needs-review'],
                                    stairReview=f['stairReview'],unresolvedDoorArcHandles=f['unresolvedDoorArcHandles']))
    write(args.out/'detection-review.json',review)
    spec_glb=importlib.util.spec_from_file_location('schematic_glb',HERE/'schematic-glb.py');glb=importlib.util.module_from_spec(spec_glb);spec_glb.loader.exec_module(glb)
    (args.out/'models').mkdir(exist_ok=True)
    for floor in all_floors:glb.export_floor(args.out/'models'/f"{floor['id']}.schematic.glb",floor,output['evidenceSha256'])
    write(args.out/'geometry.json',output);write(args.out/'abstraction-report.json',dict(floors=counts,limitations=output['notes']))
    # Reviter analytic DWG entities (drawing coordinates) are an explicit handoff,
    # not BoundarySections with fabricated native level IDs or source floor support.
    handoff=[];seen=set()
    for f in all_floors:
        for p in f['primitives']:
            if p['sourceHandle'] in seen:continue
            seen.add(p['sourceHandle']);e=doc.entitydb[p['sourceHandle']]
            r=dict(type=p['type'],layer=p['layer'],sourceHandle=p['sourceHandle'])
            if p['type'] in ('ARC','CIRCLE'):
                r.update(centre=[float(e.dxf.center.x),float(e.dxf.center.y)],radius=float(e.dxf.radius))
                if p['type']=='ARC':r.update(startAngle=math.radians(e.dxf.start_angle),endAngle=math.radians(e.dxf.end_angle))
            elif p['type']=='ELLIPSE':
                r.update(centre=[float(e.dxf.center.x),float(e.dxf.center.y)],majorAxis=[float(e.dxf.major_axis.x),float(e.dxf.major_axis.y)],axisRatio=float(e.dxf.ratio),startAngle=float(e.dxf.start_param),endAngle=float(e.dxf.end_param))
            else:r['points']=[list(q) for q in intake.recovery.flatten_entity_points(e,.002/scale)]
            if 'closed' in p:r['closed']=p['closed']
            handoff.append(r)
    write(args.out/'reviter.dwg-entities.json',handoff)
    display=subprocess.run(['node','--experimental-strip-types',str(HERE/'emit-door-display.mjs'),str(args.reviter)],check=True,capture_output=True,text=True).stdout
    (args.out/'index.html').write_text((HERE/'building-geometry.html').read_text().replace('/*DOOR_DISPLAY_HELPER*/',display));shutil.copy2(original,args.out/'intake.json')
    shutil.copytree(args.intake/'source',args.out/'source',dirs_exist_ok=True)
    (args.out/'README.txt').write_text('Separate source-bound CAD shape reconstruction from the saved floor intake.\nServe this directory using python3 -m http.server --bind 127.0.0.1.\ngeometry.json: analytic shapes, guarded door symbols, measured wall-pair candidates, exact treads and closed drawing regions.\nDoor recognition reuses Reviter registered-single-door-swings.ts, supplemented by analytic finite-jamb checks for short jambs and closed leaves. Unmatched arcs remain in source geometry and the review queue.\nreviter.dwg-entities.json: analytic source-coordinate DwgEntity handoff; supply independently reviewed registrations/native floors before preparation. Not an RVT or routed native dataset.\n3D schematic uses an adjustable illustrative wall height. Stair rise/elevations remain unassigned; bounded adjacent drawing cells are possible landing candidates only.\nmodels/ contains review-only floor GLBs with illustrative 2.7 m wall and 2.1 m door heights, measured face pairs, flat tread strokes and provenance extras. They are not native source models.\nReproduce after installing pipeline/requirements.txt: python pipeline/abstract-building-geometry.py --intake . --review . --reviter pipeline/reviter --out ../cad-rerun\nNo model bytes, canonical master, access or routes changed. Original DWGs retained.\n')
    pipeline=args.out/'pipeline';pipeline.mkdir(exist_ok=True)
    for name in ['abstract-building-geometry.py','abstract-door-symbols.mjs','emit-door-display.mjs','cad-door-symbols.py','stair-footprints.py','build-building-intake.py','building-geometry.html','recover-room-polygons.py','stair-symbols.py','schematic-glb.py','config.unbc.json']:
        shutil.copy2(HERE/name,pipeline/name)
    (pipeline/'requirements.txt').write_text('ezdxf>=1.4\nshapely>=2.0\nnumpy>=2.0\n')
    helper=pipeline/'reviter/lib/reviter';helper.mkdir(parents=True,exist_ok=True)
    shutil.copy2(args.reviter/'lib/reviter/registered-single-door-swings.ts',helper/'registered-single-door-swings.ts')
    shutil.copy2(args.reviter/'lib/reviter/dwg-door-display.ts',helper/'dwg-door-display.ts')
    (args.out/'stage').mkdir(exist_ok=True)
    shutil.copy2(args.review/'stage/floorplans.dxf',args.out/'stage/floorplans.dxf')
    shutil.copy2(args.review/'stage/conversion.json',args.out/'stage/conversion.json')
    package(args.out)
    print(json.dumps(counts,indent=2))

def package(out):
    checksums={str(p.relative_to(out)):intake.sha(p) for p in out.rglob('*') if p.is_file() and p.suffix!='.zip' and p.name!='checksums.json'}
    write(out/'checksums.json',checksums)
    with zipfile.ZipFile(out/'UNBC.cad-geometry.zip','w',zipfile.ZIP_DEFLATED) as z:
        for name in [*checksums,'checksums.json']:z.write(out/name,name)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--intake',type=Path,required=True);p.add_argument('--review',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--reviter',type=Path,required=True);build(p.parse_args())
