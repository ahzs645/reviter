"""Reuse guarded Reviter recognition for nearly circular DWG ellipse swings."""
import argparse,json,math,subprocess
from pathlib import Path
from shapely.geometry import LineString,box
from shapely.strtree import STRtree

def build(geometry,out,reviter):
    data=json.loads(geometry.read_text());groups=[]
    for f in data['floors']:
        used={h for d in f['doors'] for h in d['arcHandles']};straight=[]
        for p in f['primitives']:
            if p['type'] in ('ARC','ELLIPSE','CIRCLE'):continue
            for a,b in zip(p['pointsMetres'],p['pointsMetres'][1:]):
                if math.dist(a,b)>.001:straight.append(dict(sourceHandle=p['sourceHandle'],pointsMetres=[a,b]))
        shapes=[LineString(s['pointsMetres']) for s in straight];tree=STRtree(shapes)
        for p in f['primitives']:
            if p['type']!='ELLIPSE' or p['sourceHandle'] in used or abs(p['axisRatio']-1)>.0001:continue
            sweep=(p['endParameter']-p['startParameter'])%(2*math.pi)
            if not math.radians(82)<=sweep<=math.radians(98):continue
            c=p['centreMetres'];r=sum(math.dist(c,q) for q in p['pointsMetres'])/len(p['pointsMetres'])
            if not .27432<=r<=2.4384 or any(abs(math.dist(c,q)-r)>.003 for q in p['pointsMetres']):continue
            local=[straight[int(i)] for i in tree.query(box(c[0]-r-1,c[1]-r-1,c[0]+r+1,c[1]+r+1),predicate='intersects')]
            local.extend(dict(sourceHandle=p['sourceHandle'],pointsMetres=[a,b]) for a,b in zip(p['pointsMetres'],p['pointsMetres'][1:]))
            groups.append(dict(id=f"{f['id']}:ellipse-door:{p['sourceHandle']}",floorId=f['id'],arcHandle=p['sourceHandle'],segments=local))
    out.mkdir(parents=True,exist_ok=False);(out/'input.json').write_text(json.dumps(groups))
    subprocess.run(['node','--experimental-strip-types',str(reviter/'tools/dwg-analysis/abstract-door-symbols.mjs'),str(out/'input.json'),str(out/'output.json'),str(reviter)],check=True)
    doors=json.loads((out/'output.json').read_text());found=[];used=set()
    for d in doors:
        if d['arcHandle'] in used:continue
        f=next(f for f in data['floors'] if f['id']==d['floorId']);p=next(p for p in f['primitives'] if p['sourceHandle']==d['arcHandle'])
        d.update(swingPointsMetres=p['pointsMetres'],recognitionMethod='guarded-nearly-circular-ellipse',sourceEllipseAxisRatio=p['axisRatio'],sourceEllipseSweepRadians=(p['endParameter']-p['startParameter'])%(2*math.pi))
        found.append(d);used.add(d['arcHandle'])
    (out/'derived-door-symbols.json').write_text(json.dumps(dict(format='reviter-cad-derived-door-symbols',version=1,sourceSha256=data['sourceSha256'],doors=found),separators=(',',':')))
    print(json.dumps(dict(candidates=len(groups),recognized=len(found),byFloor={f['id']:sum(d['floorId']==f['id'] for d in found) for f in data['floors'] if any(d['floorId']==f['id'] for d in found)}),indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--geometry',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--reviter',type=Path,required=True);a=p.parse_args();build(a.geometry,a.out,a.reviter)
