"""Explicit, reversible stair-continuity assumptions at shared source footprints."""
import argparse,hashlib,json
from pathlib import Path
from shapely.geometry import Polygon
from shapely.affinity import affine_transform

def build(package,building):
    geometry=json.loads((package/'geometry.json').read_text());analysis=json.loads((package/'floor-analysis.json').read_text())
    gh=hashlib.sha256((package/'geometry.json').read_bytes()).hexdigest()
    if gh!=analysis['geometrySha256']:raise ValueError('Changed source geometry')
    transforms={f['id']:f['additionalTransform'] for f in analysis['floors']};floors={f['id']:f for f in geometry['floors']}
    def transform(t):return [t['a'],t['c'],t['b'],t['d'],t['e'],t['f']]
    def polygon(a,id):return affine_transform(Polygon(a['ringsMetres'][0],a['ringsMetres'][1:]),transform(transforms[id]))
    def local(p,id):
        t=transforms[id];den=t['a']*t['d']-t['b']*t['c'];x,y=p[0]-t['e'],p[1]-t['f'];return [(t['d']*x-t['c']*y)/den,(-t['b']*x+t['a']*y)/den]
    connections=[];unresolved=[]
    for family in analysis['stairFamilies']:
        if family['buildingCode']!=building:continue
        occurrences=sorted(family['occurrences'],key=lambda o:o['ordinal'])
        for left,right in zip(occurrences,occurrences[1:]):
            candidates=[]
            for a in floors[left['floorId']]['stairAreas']:
                if a['id'] not in left['nearbyAreaIds']:continue
                for b in floors[right['floorId']]['stairAreas']:
                    if b['id'] not in right['nearbyAreaIds']:continue
                    pa,pb=polygon(a,left['floorId']),polygon(b,right['floorId']);intersection=pa.intersection(pb)
                    ratio=intersection.area/min(pa.area,pb.area)
                    if intersection.area<.1 or ratio<.5:continue
                    # Do not move a floor or align room text; use one shared point
                    # contained by both original footprints, including holes.
                    candidates.append((ratio,intersection.area,a,b,intersection))
            if not candidates:
                unresolved.append(dict(buildingCode=building,family=family['family'],fromFloorId=left['floorId'],toFloorId=right['floorId'],reason='The labelled stair contexts do not share a recovered source footprint. Keep alignment/shaft ownership flagged; no connecting line or route invented.'));continue
            candidates.sort(key=lambda c:(-c[0],-c[1]));ratio,area,a,b,intersection=candidates[0];point=list(intersection.representative_point().coords[0])
            connections.append(dict(id='assumed:'+left['floorId']+':'+right['floorId']+':'+family['family'],buildingCode=building,family=family['family'],fromFloorId=left['floorId'],toFloorId=right['floorId'],fromAreaId=a['id'],toAreaId=b['id'],fromPointMetres=local(point,left['floorId']),toPointMetres=local(point,right['floorId']),sharedFootprintAreaSquareMetres=area,overlapRatio=ratio,missingIntermediateOrdinals=list(range(left['ordinal']+1,right['ordinal'])),assumedContinuous=True,servedStopsVerified=False,physicalElevations=None,reason='User requested a temporary continuity assumption. Shared source-footprint XY aligns both endpoints. Intermediate stops, flight rise, floor support and access remain unverified.'))
    output=dict(format='reviter-cad-stair-assumptions',version=1,sourceSha256=geometry['sourceSha256'],geometrySha256=gh,userAssumed=True,routingEligible=False,graphEdges=[],connections=connections,unresolved=unresolved)
    (package/'stair-assumptions.json').write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(dict(alignedAssumptions=len(connections),unresolved=unresolved),indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,required=True);p.add_argument('--building',required=True);p.add_argument('--user-assumed',action='store_true',required=True);a=p.parse_args()
    if (a.package/'stair-assumptions.json').exists():raise ValueError('Assumptions already exist; preserve them and create another candidate package.')
    build(a.package,a.building)
