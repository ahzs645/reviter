"""Regular parallel tread runs as schematic hints, never certified stairs."""
import math
import numpy as np


def detect_tread_runs(lines,min_treads=6):
    segments=[]
    for line in lines:
        if line.get('type') == 'ARC':continue
        for segment_index,(a,b) in enumerate(zip(line['pointsMetres'],line['pointsMetres'][1:])):
            dx,dy=b[0]-a[0],b[1]-a[1]
            length=math.hypot(dx,dy)
            if not .65<=length<=4.5:continue
            angle=math.atan2(dy,dx)%math.pi
            segments.append(dict(a=a,b=b,length=length,angle=angle,mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],handle=line['sourceHandle'],segmentIndex=segment_index))
    used=set();runs=[]
    for i,s in enumerate(segments):
        if i in used:continue
        u=np.array([math.cos(s['angle']),math.sin(s['angle'])]);n=np.array([-u[1],u[0]])
        candidates=[]
        for j,t in enumerate(segments):
            delta=np.array(t['mid'])-s['mid']
            angle=abs(t['angle']-s['angle']);angle=min(angle,math.pi-angle)
            if angle<.004 and abs(t['length']-s['length'])<.08 and abs(delta@u)<.035 and abs(delta@n)<15:
                candidates.append((float(np.array(t['mid'])@n),j))
        candidates.sort();chains=[];chain=[]
        for value,j in candidates:
            if chain and value-chain[-1][0]>.5:chains.append(chain);chain=[]
            if not chain or value-chain[-1][0]>.03:chain.append((value,j))
        chains.append(chain)
        for chain in chains:
            if len(chain)<min_treads or all(j in used for _,j in chain):continue
            distances=np.diff([v for v,_ in chain])
            if not .12<=np.median(distances)<=.4 or np.std(distances)>.075:continue
            rows=[segments[j] for _,j in chain]
            ps=np.array([p for t in rows for p in (t['a'],t['b'])])
            us,ns=ps@u,ps@n
            corners=[(u*x+n*y).tolist() for x,y in [(min(us),min(ns)),(max(us),min(ns)),(max(us),max(ns)),(min(us),max(ns))]]
            runs.append(dict(id='tread-run:'+rows[0]['handle']+':'+str(i),kind='stair-symbol',
                             centreMetres=ps.mean(axis=0).tolist(),ringsMetres=[corners],treadCount=len(rows),
                             medianSpacingMetres=round(float(np.median(distances)),4),
                             sourceHandles=sorted(set(t['handle'] for t in rows)),
                             treads=[dict(sourceHandle=t['handle'],sourceSegmentIndex=t['segmentIndex'],pointsMetres=[t['a'],t['b']]) for t in rows],
                             widthMetres=round(float(max(us)-min(us)),5),runAxisMetres=[(u*((min(us)+max(us))/2)+n*y).tolist() for y in (min(ns),max(ns))],status='schematic-hint',routingEligible=False))
            used.update(j for _,j in chain)
    # A terminal riser can extend through a stringer/cap while the regular
    # interior treads stop at its inside face. Recover at most one measured
    # stroke at either end, never bridge an arbitrary landing or missing line.
    for run in runs:
        a,b=run['treads'][0]['pointsMetres'];u=np.array(b)-a;u=u/np.linalg.norm(u)
        n=np.array([-u[1],u[0]])
        ps=np.array([p for t in run['treads'] for p in t['pointsMetres']])
        lo,hi=float(min(ps@u)),float(max(ps@u));width=hi-lo
        positions=[float(np.mean(np.array(t['pointsMetres']),axis=0)@n) for t in run['treads']]
        spacing=run['medianSpacingMetres'];added=[]
        for target in (min(positions)-spacing,max(positions)+spacing):
            candidates=[]
            for j,t in enumerate(segments):
                if j in used:continue
                angle=abs(float((np.array(t['b'])-t['a'])@n))/t['length']
                if angle>.004 or abs(float(np.array(t['mid'])@n)-target)>.02:continue
                ends=sorted(float(np.array(p)@u) for p in (t['a'],t['b']))
                overlap=max(0,min(hi,ends[1])-max(lo,ends[0]))
                if abs(t['length']-width)>.12 or overlap/min(width,t['length'])<.9:continue
                if min(abs(ends[0]-lo),abs(ends[1]-hi))>.025:continue
                candidates.append((j,t))
            if len(candidates)!=1:continue
            j,t=candidates[0];used.add(j);added.append(t)
            run['treads'].append(dict(sourceHandle=t['handle'],sourceSegmentIndex=t['segmentIndex'],pointsMetres=[t['a'],t['b']]))
        if not added:continue
        run['terminalVariantTreads']=[dict(sourceHandle=t['handle'],sourceSegmentIndex=t['segmentIndex']) for t in added]
        run['treads'].sort(key=lambda t:float(np.mean(np.array(t['pointsMetres']),axis=0)@n))
        ps=np.array([p for t in run['treads'] for p in t['pointsMetres']]);us,ns=ps@u,ps@n
        run.update(treadCount=len(run['treads']),sourceHandles=sorted(set(t['sourceHandle'] for t in run['treads'])),
                   centreMetres=ps.mean(axis=0).tolist(),widthMetres=round(float(max(us)-min(us)),5),
                   ringsMetres=[[(u*x+n*y).tolist() for x,y in [(min(us),min(ns)),(max(us),min(ns)),(max(us),max(ns)),(min(us),max(ns))]]],
                   runAxisMetres=[(u*((min(us)+max(us))/2)+n*y).tolist() for y in (min(ns),max(ns))])
    return runs
