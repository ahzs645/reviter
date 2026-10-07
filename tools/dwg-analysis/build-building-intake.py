#!/usr/bin/env python3
"""Build unplaced, dimensioned CAD floor stacks and a campus reference companion.
CAD panels, schematic connectors and drawing edges never become native routes.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import shutil
import zipfile

import ezdxf
import numpy as np
from shapely.geometry import LineString, Point, box
from shapely.ops import unary_union, polygonize
from shapely.strtree import STRtree

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recovery', HERE/'recover-room-polygons.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False))


def unit_scale(registrations):
    scales = np.array([r['scale']*.3048 for r in registrations.values()])
    if len(scales) < 3 or not np.all(np.isfinite(scales)) or np.min(scales) <= 0:
        raise ValueError('At least three saved registrations must establish drawing scale')
    median = float(np.median(scales))
    if np.max(np.abs(scales-median))/median > .001:
        raise ValueError('Saved sections disagree on drawing unit scale')
    return median


def floor_text(text):
    text = text.strip().upper()
    if text == 'LOWER FLOOR': return 0, 'Lower floor'
    if text in ('MAIN FLOOR', 'UPPER FLOOR'): return 1, text.title()
    if text == 'SECOND FLOOR': return 2, 'Second floor'
    match = re.fullmatch(r'.*\b(?:LEVEL|LVL|FLOOR)\s*(-?\d+)', text)
    return (int(match[1]), text.title()) if match else None


def split_panels(lines, rooms, floor_labels, scale):
    """Group drafting panels only; the buffered network is never room geometry."""
    network = unary_union([LineString(r['points']).buffer(1/scale, cap_style=2) for r in lines])
    parts = list(network.geoms) if hasattr(network, 'geoms') else [network]
    parts = [p for p in parts if p.area*scale**2 >= 1]
    if not parts: raise ValueError('No physical wall panel found')
    owned = defaultdict(list)
    for room in rooms:
        point = Point(room['anchor'])
        # Closed panel bounds also contain labels far from the wall perimeter.
        containing = [i for i,p in enumerate(parts) if box(*p.bounds).covers(point)]
        i = min(containing or range(len(parts)), key=lambda n: parts[n].distance(point))
        owned[i].append(room)
    output = []
    for i, values in owned.items():
        p = parts[i]
        number_floor = Counter(r['roomNumberFloor'] for r in values).most_common(1)[0][0]
        centre = np.mean([r['anchor'] for r in values], axis=0)
        label = min(floor_labels, key=lambda t: math.dist(centre,t['point'])) if floor_labels else None
        # Explicit drawing titles win over room numbering (e.g. Bioenergy).
        use_label = label is not None and (len(floor_labels) > 1 or label['floor'] == number_floor)
        level = label['floor'] if use_label else number_floor
        name = label['name'] if use_label else f'Floor {level} · room-number hint'
        relevant = [r for r in lines if p.intersects(LineString(r['points']))]
        output.append(dict(floor=level,name=name,rooms=values,linework=relevant,
                           bounds=list(p.bounds),floorEvidence='drawing title' if use_label else 'room-number panel consensus',
                           label=label))
    return output


def sample_lines(lines, scale, origin):
    points = []
    for line in lines:
        if line['type'] == 'ARC': continue
        for a,b in zip(line['points'],line['points'][1:]):
            length = math.dist(a,b)*scale
            if length < 1.5: continue
            count = min(1000,max(2,math.ceil(length/.3)))
            points.extend((np.linspace(a,b,count)-origin)*scale)
    return np.array(points) if points else np.zeros((0,2))


def rotate(points, degrees):
    a = math.radians(degrees)
    return np.asarray(points) @ np.array([[math.cos(a), math.sin(a)],[-math.sin(a),math.cos(a)]])


def fit_stack(base, target, scale):
    """Translation/quarter-turn raster comparison; retain score and ambiguity.
    No reflection, scaling, elevation or route inference. Exact CAD stays intact.
    """
    origin = np.mean([r['anchor'] for r in base['rooms']], axis=0)
    target_origin = np.mean([r['anchor'] for r in target['rooms']], axis=0)
    a = sample_lines(base['linework'],scale,origin)
    b = sample_lines(target['linework'],scale,target_origin)
    if len(a)<10 or len(b)<10:
        return dict(rotationDegrees=0,translationMetres=[0,0],originDrawing=target_origin.tolist(),
                    status='needs-review',method='anchor-centre fallback',overlapScore=0,alternativeScore=0)
    cell=.3
    trials=[]
    # FFT gives all translations. Each target point must match base linework;
    # a partial upper footprint can align to a full ground drawing.
    for degrees in (0,90,180,270):
        bb=rotate(b,degrees)
        lo=np.minimum(a.min(axis=0),bb.min(axis=0))-2
        hi=np.maximum(a.max(axis=0),bb.max(axis=0))+2
        shape=np.ceil((hi-lo)/cell).astype(int)+1
        aa=np.zeros(tuple(shape)); bt=np.zeros(tuple(shape))
        ai=np.rint((a-lo)/cell).astype(int); bi=np.rint((bb-lo)/cell).astype(int)
        aa[ai[:,0],ai[:,1]]=1;bt[bi[:,0],bi[:,1]]=1
        # Tolerate sub-cell numerical rounding, not absent partitions.
        aa=np.maximum.reduce([aa,np.roll(aa,1,0),np.roll(aa,-1,0),np.roll(aa,1,1),np.roll(aa,-1,1)])
        fftshape=tuple(2**int(math.ceil(math.log2(2*s))) for s in shape)
        cross=np.fft.irfftn(np.fft.rfftn(aa,fftshape,axes=(0,1))*np.conj(np.fft.rfftn(bt,fftshape,axes=(0,1))),fftshape,axes=(0,1))
        at=np.unravel_index(np.argmax(cross),cross.shape)
        shift=np.array([v if v<=fftshape[i]//2 else v-fftshape[i] for i,v in enumerate(at)])*cell
        score=float(cross[at]/bt.sum())
        trials.append((score,degrees,shift.tolist()))
    trials.sort(reverse=True)
    score,degrees,translation=trials[0]
    return dict(rotationDegrees=degrees,translationMetres=translation,originDrawing=target_origin.tolist(),
                status='provisional' if score>=.6 and score-trials[1][0]>=.04 else 'needs-review',method='dimension-preserving wall linework correlation',
                overlapScore=round(score,4),alternativeScore=round(trials[1][0],4),
                note='Drawing alignment only; review shared stairs/structure before campus placement or route creation.')


def local_point(point, alignment, scale):
    p=rotate(np.array(point)-alignment['originDrawing'],alignment['rotationDegrees'])*scale
    return [round(float(p[i]+alignment['translationMetres'][i]),5) for i in (0,1)]


def campus_reference(review, campus_dxf, config):
    doc=ezdxf.readfile(campus_dxf)
    segments=[]
    for e in doc.modelspace():
        if e.dxf.layer != config['campus']['referenceLayer']:continue
        points=recovery.flatten_entity_points(e,100)
        if len(points)>=2:segments.append(LineString(points))
    polygons=[p for p in polygonize(unary_union(segments)) if p.area>config['campus']['componentAreaThreshold']]
    polygons.sort(key=lambda p:(-p.centroid.y,p.centroid.x))
    controls=config['campus']['componentControlPoints']
    if len(controls)<3:raise ValueError('Campus reference needs at least three control points')
    source=np.array([[polygons[c['componentIndex']-1].centroid.x,polygons[c['componentIndex']-1].centroid.y] for c in controls])
    target=np.array([c['geo'] for c in controls])
    origin=source.mean(axis=0)
    design=np.column_stack([source-origin,np.ones(len(source))])
    fit,_,rank,_=np.linalg.lstsq(design,target,rcond=None)
    if rank<3:raise ValueError('Degenerate campus controls')
    residual=(design@fit-target)*np.array([111320*math.cos(math.radians(float(target[:,1].mean()))),111320])
    rms=float(np.sqrt(np.mean(np.sum(residual**2,axis=1))))
    features=[]
    for e in doc.modelspace():
        if not re.search('sidewalk|trail',e.dxf.layer,re.I):continue
        points=recovery.flatten_entity_points(e,100)
        if len(points)<2:continue
        coordinates=(np.column_stack([np.array(points)-origin,np.ones(len(points))])@fit).tolist()
        features.append(dict(type='Feature',id=e.dxf.handle,properties=dict(sourceHandle=e.dxf.handle,
                             layer=e.dxf.layer,kind='trail' if 'trail' in e.dxf.layer.lower() else 'sidewalk',
                             evidence='drawing edge; not a route centreline',routingEligible=False),
                             geometry=dict(type='LineString',coordinates=coordinates)))
    source_file=next(f for f in review['sourceFiles'] if 'campus' in f['name'].lower())
    return dict(source=source_file,registration=dict(method='least-squares affine from existing configured building-centroid controls',
                surveyed=False,controlCount=len(controls),rmsMetres=round(rms,3),controls=[dict(**c,cad=source[i].tolist()) for i,c in enumerate(controls)],
                originDrawing=origin.tolist(),matrix=fit.tolist(),status='approximate reference'),
                routingEligible=False,graphEdges=[],geojson=dict(type='FeatureCollection',features=features))


spec_stairs = importlib.util.spec_from_file_location('stair_symbols', HERE/'stair-symbols.py')
stair_symbols = importlib.util.module_from_spec(spec_stairs)
spec_stairs.loader.exec_module(stair_symbols)


def build(args):
    review=json.loads((args.review/'review.json').read_text())
    source_dxf=args.review/'stage/floorplans.dxf'
    source_file=next(f for f in review['sourceFiles'] if 'floor' in f['name'].lower())
    for item in review['sourceFiles']:
        if sha(args.review/'source'/item['name'])!=item['sha256']:
            raise ValueError('Source drawing checksum mismatch: '+item['name'])
    conversion=json.loads((args.review/'stage/conversion.json').read_text())
    if conversion['sourceSha256']!=review['sourceSha256'] or conversion['convertedSha256']!=sha(source_dxf):
        raise ValueError('Converted floor drawing does not match its saved binding')
    scale=unit_scale(review['registrations'])
    config=json.loads((HERE/'config.unbc.json').read_text())
    doc=ezdxf.readfile(source_dxf)
    all_lines=[];texts=[]
    for e in doc.modelspace():
        if re.search('wall',e.dxf.layer,re.I):
            points=recovery.flatten_entity_points(e,100)
            if len(points)>=2:
                all_lines.append(dict(handle=e.dxf.handle,type=e.dxftype(),layer=e.dxf.layer,points=points))
        if e.dxftype() in ('TEXT','MTEXT'):
            value=e.dxf.text if e.dxftype()=='TEXT' else e.text
            title=floor_text(value)
            if title:texts.append(dict(point=[float(e.dxf.insert.x),float(e.dxf.insert.y)],floor=title[0],name=title[1],handle=e.dxf.handle))
    geometries=[LineString(l['points']) for l in all_lines]
    tree=STRtree(geometries)
    groups=defaultdict(list)
    for s in review['sheets']:
        if s['status']!='missing-building':continue
        crop=box(*s['bounds'])
        lines=[all_lines[int(i)] for i in tree.query(crop,predicate='intersects')]
        explicit=re.search(r'\bLVL\s*(-?\d+)',s['name'],re.I)
        if explicit:
            panels=[dict(floor=int(explicit[1]),name=f'Drawing level {explicit[1]}',rooms=s['candidates'],linework=lines,
                         bounds=s['bounds'],floorEvidence='named drawing sheet',label=None)]
        else:
            labels=[t for t in texts if crop.covers(Point(t['point']))]
            panels=split_panels(lines,s['candidates'],labels,scale)
        for panel in panels:
            panel['sheet']=s['name'];panel['svg']=s['svg'];groups[s['building']].append(panel)
    buildings=[]
    for code,panels in sorted(groups.items()):
        merged={}
        for p in panels:
            f=merged.setdefault(p['floor'],dict(floor=p['floor'],name=p['name'],rooms=[],linework=[],panels=[]))
            f['rooms'].extend(p['rooms']);f['linework'].extend(p['linework'])
            f['panels'].append({k:p[k] for k in ['sheet','bounds','floorEvidence','label']})
        floors=[];base=merged[min(merged)]
        for level,f in sorted(merged.items()):
            alignment=(dict(rotationDegrees=0,translationMetres=[0,0],originDrawing=np.mean([r['anchor'] for r in f['rooms']],axis=0).tolist(),
                            status='local-reference',method='base drawing axes',overlapScore=1,alternativeScore=0)
                       if f is base else fit_stack(base,f,scale))
            rooms=[]
            for r in f['rooms']:
                rooms.append(dict(key=r['id'],number=r['number'],name=r['name'],anchorMetres=local_point(r['anchor'],alignment,scale),
                                  ringsMetres=[[local_point(p,alignment,scale) for p in ring] for ring in r['rings']],
                                  matchMode=r['matchMode'],enclosureVerified=False,routingEligible=False,
                                  source=dict(handle=r['sourceHandle'],sheet=r['sheet'],anchorDrawing=r['anchor'],roomNumberFloor=r['roomNumberFloor'])))
            linework=[dict(sourceHandle=l['handle'],type=l['type'],layer=l['layer'],pointsMetres=[local_point(p,alignment,scale) for p in l['points']]) for l in f['linework']]
            floors.append(dict(id=f'cad-{code}-{level}',ordinal=level,name=f['name'],elevationMetres=None,nativeLevelId=None,
                               alignment=alignment,panels=f['panels'],rooms=rooms,linework=linework,stairSymbols=stair_symbols.detect_tread_runs(linework),
                               issues=['Elevation and native floor support unassigned','Recovered areas are tentative; source lines retained'],
                               numberFloorHints=sorted(set(r['roomNumberFloor'] for r in f['rooms']))))
        connectors=[]
        stair_families=defaultdict(list)
        for f in floors:
            for r in f['rooms']:
                if re.fullmatch('stairs?',r['name'].strip(),re.I):
                    stair_families[re.sub(r'S\d', 'S*',r['number'])].append((f,r))
        for family, occurrences in stair_families.items():
            for (a,ra),(b,rb) in zip(occurrences,occurrences[1:]):
                if a['id']==b['id']:continue
                distance=math.dist(ra['anchorMetres'],rb['anchorMetres'])
                connectors.append(dict(id=f"{ra['key']}:{rb['key']}",kind='stair',fromFloor=a['id'],toFloor=b['id'],
                                       fromRoom=ra['key'],toRoom=rb['key'],fromHint=None,toHint=None,
                                       fromPointMetres=ra['anchorMetres'],toPointMetres=rb['anchorMetres'],offsetMetres=round(distance,3),
                                       evidence='matching stair label family; anchors are labels, not landing positions',
                                       status='needs-landing-review',routingEligible=False))
        # Unique nearby regular tread runs can suggest a schematic link. They
        # are not room identities, physical landings or served route portals.
        for a,b in zip(floors,floors[1:]):
            for ha in a['stairSymbols']:
                near=[hb for hb in b['stairSymbols'] if math.dist(ha['centreMetres'],hb['centreMetres'])<=2]
                if len(near)!=1:continue
                hb=near[0]
                reverse=[h for h in a['stairSymbols'] if math.dist(h['centreMetres'],hb['centreMetres'])<=2]
                if len(reverse)!=1:continue
                # Avoid repeating a connector already suggested by stair names.
                if any(c['fromFloor']==a['id'] and c['toFloor']==b['id'] and
                       math.dist(c['fromPointMetres'],ha['centreMetres'])<5 and
                       math.dist(c['toPointMetres'],hb['centreMetres'])<5 for c in connectors):continue
                connectors.append(dict(id=f"{a['id']}:{ha['id']}:{b['id']}:{hb['id']}",kind='stair',
                                       fromFloor=a['id'],toFloor=b['id'],fromRoom=None,toRoom=None,
                                       fromHint=ha['id'],toHint=hb['id'],fromPointMetres=ha['centreMetres'],toPointMetres=hb['centreMetres'],
                                       offsetMetres=round(math.dist(ha['centreMetres'],hb['centreMetres']),3),
                                       evidence='unique nearby regular tread symbols after provisional floor alignment',
                                       status='needs-landing-review',routingEligible=False))
        name=config['buildings']['codeMap'].get(code,{}).get('name',f'Building {code}')
        buildings.append(dict(id=f'cad-building-{code}',code=code,name=name,placement=None,coordinateSystem='building-local-metres',
                              floors=floors,connectors=connectors,issues=['Campus position, elevation and routes are unassigned']+
                              ([] if connectors else ['No paired labelled stair connector recovered; inspect schematic stair/lift symbols'])))
    campus=campus_reference(review,args.review/'stage/campus.dxf',config)
    data=dict(format='openindoormaps-cad-intake',version=1,createdAt=datetime.now(timezone.utc).isoformat(),
              sourceFiles=review['sourceFiles'],conversionEvidence=dict(floorDxfSha256=sha(source_dxf),campusDxfSha256=sha(args.review/'stage/campus.dxf'),decoder=conversion['decoder']),masterComparisonSha256=review['masterSha256'],sourceSha256=review['sourceSha256'],
              unitEvidence=dict(metresPerDrawingUnit=scale,method='median of saved native drawing registrations',registrationCount=len(review['registrations'])),
              buildings=buildings,campusReference=campus,graphEdges=[],appliedToNativeGeometry=False)
    data['evidenceSha256']=hashlib.sha256(json.dumps({k:v for k,v in data.items() if k!='createdAt'},sort_keys=True,separators=(',',':')).encode()).hexdigest()
    args.out.mkdir(parents=True,exist_ok=True)
    write(args.out/'intake.json',data)
    for b in buildings:write(args.out/f"building-{b['code']}.json",dict(sourceSha256=review['sourceSha256'],unitEvidence=data['unitEvidence'],building=b))
    write(args.out/'campus-reference.json',campus)
    shutil.copy2(HERE/'building-intake.html',args.out/'index.html')
    (args.out/'source').mkdir(exist_ok=True)
    for item in review['sourceFiles']:shutil.copy2(args.review/'source'/item['name'],args.out/'source'/item['name'])
    (args.out/'README.txt').write_text('Separate CAD building intake: 02, 11, 12, 14 and 19. The canonical UNBC master is not modified.\n\nServe this directory: python3 -m http.server 8766 --bind 127.0.0.1 --directory /path/to/this/folder\nThen open http://127.0.0.1:8766/.\n\nintake.json holds all building-local metre drawings, floor order, provisional orientation and stair candidates. Individual building JSON files are provided. Campus reference edges have approximate geographic placement from existing configured controls, not surveyed control. No native elevations, floor support or route graph is created. Original DWGs are preserved under source/. Room labels and tentative polygons are distinct from verified enclosed rooms.\n\nUse the viewer to compare floors, zoom to each room and stair hint, and review orientation. Save floor adjustments locally, then Download floor reviews to preserve them in a separate JSON beside this ZIP. The original intake remains unchanged. Before merging, confirm floor panels/orientation, elevation, campus registration, openings/entrances and access; reconcile the latest main master and regenerate through Reviter.\n')
    checksums={str(p.relative_to(args.out)):sha(p) for p in args.out.rglob('*') if p.is_file() and p.suffix!='.zip' and p.name!='checksums.json'}
    write(args.out/'checksums.json',checksums)
    with zipfile.ZipFile(args.out/'UNBC.building-intake.zip','w',zipfile.ZIP_DEFLATED) as z:
        for name in [*checksums,'checksums.json']:z.write(args.out/name,name)
    print(json.dumps(dict(buildings=[dict(code=b['code'],floors=len(b['floors']),rooms=sum(len(f['rooms']) for f in b['floors']),
                                          alignments=[f['alignment']['overlapScore'] for f in b['floors']],connectors=len(b['connectors'])) for b in buildings],
                         campusEdges=len(campus['geojson']['features']),campusRegistrationRmsMetres=campus['registration']['rmsMetres']),indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--review',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    build(p.parse_args())
