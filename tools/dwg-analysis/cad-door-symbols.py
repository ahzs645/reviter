"""Analytic quarter-door evidence with finite original jamb contacts.

Drawing thresholds are selection evidence only, never native doors or routes.
This supplements the tessellated recognizer for short jamb returns and doors
drawn with a closed leaf. Every threshold joins original matching face strokes.
"""
import math
import numpy as np


def detect_analytic_doors(primitives, floor_id, existing):
    used={h for d in existing for h in d['arcHandles']};segments=[];results=[]
    for p in primitives:
        if p['type'] not in ('LINE','LWPOLYLINE'):continue
        for i,(a,b) in enumerate(zip(p['pointsMetres'],p['pointsMetres'][1:])):
            length=math.dist(a,b)
            if length>.001:segments.append(dict(a=np.array(a),b=np.array(b),length=length,handle=p['sourceHandle'],index=i))
    for arc in primitives:
        if arc['type']!='ARC' or arc['sourceHandle'] in used:continue
        r=arc['radiusMetres']
        if not .65<=r<=2.4384 or not math.radians(88)<=arc['sweepRadians']<=math.radians(92):continue
        c=np.array(arc['centreMetres']);ends=[np.array(arc['pointsMetres'][0]),np.array(arc['pointsMetres'][-1])];solutions=[]
        local=[s for s in segments if min(np.linalg.norm(s['a']-c),np.linalg.norm(s['b']-c))<r+.7]
        for closed in (0,1):
            u=(ends[closed]-c)/r;n=np.array([-u[1],u[0]]);open_axis=(ends[1-closed]-c)/r
            leaves=[]
            for s in local:
                for state,axis in [('open',open_axis),('closed',u)]:
                    normal=np.array([-axis[1],axis[0]]);ts=sorted(float((p-c)@axis) for p in (s['a'],s['b']))
                    if s['length']>=r*.8 and max(abs(float((p-c)@normal)) for p in (s['a'],s['b']))<=.05 and -.05<=ts[0]<=.05 and r-.05<=ts[1]<=r+.05:
                        leaves.append((s,state))
            if not leaves:continue
            before=[];after=[]
            for s in local:
                if s['length']<.04 or abs(float((s['b']-s['a'])@n))/s['length']>.002:continue
                ts=sorted(float((p-c)@u) for p in (s['a'],s['b']));off=float(((s['a']+s['b'])/2-c)@n)
                if abs(off)>.18:continue
                if ts[0]<=-.04 and -.25<=ts[1]<=.05:before.append((s,ts[1],off))
                if ts[1]>=r+.04 and r-.05<=ts[0]<=r+.25:after.append((s,ts[0],off))
            contacts=[]
            for a,t0,o0 in before:
                for b,t1,o1 in after:
                    if abs(o0-o1)>.0001:continue
                    # Short jamb caps need an actual perpendicular continuation
                    # at their outer endpoint, rather than a floating annotation.
                    def supported(s,t,off):
                        if s['length']>=.12:return True
                        outer=s['a'] if float((s['a']-c)@u)!=t else s['b']
                        return any(q['length']>=.3 and abs(float((q['b']-q['a'])@u))/q['length']<.01 and min(np.linalg.norm(outer-q['a']),np.linalg.norm(outer-q['b']))<.001 for q in local)
                    if not supported(a,t0,o0) or not supported(b,t1,o1):continue
                    # A long source stroke crossing the opening disproves this
                    # face as an aperture; the radial leaf itself is allowed.
                    if any(q['handle'] not in {s['handle'] for s,_ in leaves} and q['length']>=r*.8 and abs(float((q['b']-q['a'])@n))/q['length']<.002 and abs(float((q['a']-c)@n)-o0)<.0001 and min(float((q['a']-c)@u),float((q['b']-c)@u))<.05 and max(float((q['a']-c)@u),float((q['b']-c)@u))>r-.05 for q in local):continue
                    contacts.append((a,b,t0,t1,o0))
            if contacts:solutions.append((closed,u,n,leaves,contacts))
        if len(solutions)!=1:continue
        closed,u,n,leaves,contacts=solutions[0];thresholds=[];supports=set()
        for a,b,t0,t1,off in contacts:
            ps=[(c+u*t+n*off).tolist() for t in (t0,t1)]
            if ps not in thresholds:thresholds.append(ps)
            supports.update([a['handle'],b['handle']])
        open_leaves=[s for s,state in leaves if state=='open']
        results.append(dict(id=f'{floor_id}:analytic-door:{arc["sourceHandle"]}',floorId=floor_id,arcHandle=arc['sourceHandle'],
                            hingeMetres=c.tolist(),widthMetres=r,closedLeafMetres=[c.tolist(),ends[closed].tolist()],
                            thresholdSegmentsMetres=thresholds,arcHandles=[arc['sourceHandle']],leafHandles=sorted(set(s['handle'] for s,_ in leaves)),
                            leafSegmentsMetres=[[s['a'].tolist(),s['b'].tolist()] for s in open_leaves],
                            supportingWallHandles=sorted(supports),swingPointsMetres=arc['pointsMetres'],
                            recognitionMethod='analytic-quarter-single-finite-jambs',leafDrawingState='open' if open_leaves else 'closed',
                            status='supported-drawing-symbol',routingEligible=False,nativeDoorId=None,access=None))
    return results
