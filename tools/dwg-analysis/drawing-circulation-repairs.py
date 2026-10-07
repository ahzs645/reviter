"""Source-bound CAD contact and leaf-symbol comparisons; never native geometry."""
import math
from shapely.geometry import LineString,Point
from shapely.strtree import STRtree

def segments(floor):
    return [dict(handle=p['sourceHandle'],index=i,a=list(a),b=list(b),type=p['type']) for p in floor['primitives'] if p['type'] in ('LINE','LWPOLYLINE') for i,(a,b) in enumerate(zip(p['pointsMetres'],p['pointsMetres'][1:])) if math.dist(a,b)>.000001]
def detect_leaf_doors(floor):
    ss=segments(floor);shapes=[LineString([s['a'],s['b']]) for s in ss];tree=STRtree(shapes);used={h for d in floor['doors'] for h in d['arcHandles']};out=[];candidates=[]
    for arc in floor['primitives']:
        if arc['type'] not in ('ARC','ELLIPSE') or arc['sourceHandle'] in used:continue
        arc=dict(arc)
        if arc['type']=='ELLIPSE':
            if abs(arc['axisRatio']-1)>.0001:continue
            arc['radiusMetres']=sum(math.dist(arc['centreMetres'],p) for p in arc['pointsMetres'])/len(arc['pointsMetres'])
            arc['sweepRadians']=(arc['endParameter']-arc['startParameter'])%(2*math.pi)
        if not .65<=arc['radiusMetres']<=2.45 or not math.radians(82)<=arc['sweepRadians']<=math.radians(98):continue
        c=arc['centreMetres'];local=[ss[int(i)] for i in tree.query(Point(c).buffer(arc['radiusMetres']+.6))];leaves=[]
        for s in local:
            length=math.dist(s['a'],s['b'])
            if not .65<=length<=2.45 or abs(length-arc['radiusMetres'])>.08:continue
            h,o=sorted([s['a'],s['b']],key=lambda p:math.dist(p,c));v=[(o[i]-h[i])/length for i in (0,1)]
            if math.dist(h,c)>.08 or min(math.dist(o,q) for q in [arc['pointsMetres'][0],arc['pointsMetres'][-1]])>.075:continue
            for sign in [-1,1]:
                u=[-sign*v[1],sign*v[0]];tip=[h[i]+length*u[i] for i in (0,1)];ends=[arc['pointsMetres'][0],arc['pointsMetres'][-1]]
                if min(max(math.dist(o,ends[j]),math.dist(tip,ends[1-j])) for j in (0,1))>.075:continue
                if max(abs(math.dist(q,h)-length) for q in arc['pointsMetres'])>.08:continue
                leaves.append((math.dist(h,c)+min(math.dist(o,q) for q in ends),s,h,o,u,length))
        if not leaves:continue
        _,leaf,h,o,u,width=min(leaves,key=lambda x:(x[0],x[1]['handle'],x[1]['index']));candidates.append(dict(arc=arc,leaf=leaf,hinge=h,open=o,u=u,width=width,local=local))
    def contact_pairs(h,u,width,local,leaves):
        n=[-u[1],u[0]];along=lambda p:sum((p[i]-h[i])*u[i] for i in (0,1));normal=lambda p:sum((p[i]-h[i])*n[i] for i in (0,1));before=[];after=[]
        for s in local:
            length=math.dist(s['a'],s['b'])
            if length<.04 or abs(sum((s['b'][i]-s['a'][i])*n[i] for i in (0,1)))/length>.002:continue
            pts=sorted([s['a'],s['b']],key=along);ts=[along(p) for p in pts];off=sum(map(normal,pts))/2
            if abs(off)>.22:continue
            if ts[0]<-.04 and -.25<=ts[1]<=.06:before.append((s,pts[1],off))
            if ts[1]>width+.04 and width-.06<=ts[0]<=width+.25:after.append((s,pts[0],off))
        pairs=[]
        for a,p,oa in before:
            for b,q,ob in after:
                if abs(oa-ob)>.0001:continue
                line=LineString([p,q]);blocked=False
                for s in local:
                    if s['handle'] in leaves or s['handle'] in [a['handle'],b['handle']]:continue
                    ls=LineString([s['a'],s['b']])
                    if ls.length>=width*.8 and abs(sum((s['b'][i]-s['a'][i])*n[i] for i in (0,1)))/ls.length<.002 and abs(normal(s['a'])-oa)<.0001 and min(along(s['a']),along(s['b']))<.05 and max(along(s['a']),along(s['b']))>width-.05:blocked=True;break
                if not blocked:pairs.append((a,b,p,q))
        return pairs
    for candidate in candidates:
        arc=candidate['arc'];h=candidate['hinge'];u=candidate['u'];width=candidate['width'];leaf=candidate['leaf'];leaves=[leaf];arcs=[arc];local=candidate['local'];method='finite-leaf-quarter-symbol';pairs=contact_pairs(h,u,width,local,{leaf['handle']})
        if not pairs:
            partners=[]
            for other in candidates:
                if other is candidate:continue
                delta=[other['hinge'][i]-h[i] for i in (0,1)];span=sum(delta[i]*u[i] for i in (0,1));normal=abs(delta[0]*u[1]-delta[1]*u[0]);opposite=sum(other['u'][i]*u[i] for i in (0,1));w=width+other['width']
                shared=min(math.dist(p,q) for p in [arc['pointsMetres'][0],arc['pointsMetres'][-1]] for q in [other['arc']['pointsMetres'][0],other['arc']['pointsMetres'][-1]])
                if opposite<-.999 and normal<.002 and 0<=w-span<=.15 and shared<.002:
                    locals={ (s['handle'],s['index']):s for s in local+other['local']};pp=contact_pairs(h,u,span,list(locals.values()),{leaf['handle'],other['leaf']['handle']})
                    if pp:partners.append((other,span,pp,list(locals.values())))
            if len(partners)!=1:continue
            other,width,pairs,local=partners[0];leaves.append(other['leaf']);arcs.append(other['arc']);method='finite-leaf-double-symbol'
        if any(a['sourceHandle'] in used for a in arcs):continue
        # Only original finite contacts supply selection spans. The original
        # radial strokes/nearby body lines remain symbol provenance, not walls.
        thresholds=[];proofs=[];supports=set()
        for a,b,p,q in pairs:
            if [p,q] in thresholds:continue
            thresholds.append([p,q]);proofs.append(dict(fromHandle=a['handle'],fromSegmentIndex=a['index'],fromPointMetres=p,toHandle=b['handle'],toSegmentIndex=b['index'],toPointMetres=q));supports.update([a['handle'],b['handle']])
        leaf_handles=set(s['handle'] for s in leaves);leaf_segments=[[s['a'],s['b']] for s in leaves]
        for s in local:
            # Paired leaf-body strokes next to an independently matched radial
            # leaf; retain exact source segments and do not remove furniture.
            for l in leaves:
                a,b=l['a'],l['b'];length=math.dist(a,b);v=[(b[i]-a[i])/length for i in (0,1)];n=[-v[1],v[0]]
                if abs(math.dist(s['a'],s['b'])-length)>.16:continue
                normal=max(abs(sum((p[i]-a[i])*n[i] for i in (0,1))) for p in [s['a'],s['b']]);along=sorted(sum((p[i]-a[i])*v[i] for i in (0,1)) for p in [s['a'],s['b']])
                if normal<=.06 and -.15<=along[0]<=.15 and length-.15<=along[1]<=length+.15:
                    leaf_handles.add(s['handle']);seg=[s['a'],s['b']]
                    if seg not in leaf_segments:leaf_segments.append(seg)
        d=dict(id=f'{floor["id"]}:reviewed-door:'+':'.join(sorted(a['sourceHandle'] for a in arcs)),floorId=floor['id'],arcHandle=arc['sourceHandle'],arcHandles=[a['sourceHandle'] for a in arcs],hingeMetres=h,widthMetres=width,closedLeafMetres=[h,[h[i]+width*u[i] for i in (0,1)]],thresholdSegmentsMetres=thresholds,leafHandles=sorted(leaf_handles),leafSegmentsMetres=leaf_segments,supportingWallHandles=sorted(supports),swingPointsMetres=arc['pointsMetres'],recognitionMethod=method,sourceLeafWitnesses=[dict(handle=s['handle'],segmentIndex=s['index']) for s in leaves],contactWitnesses=proofs,status='supported-drawing-symbol',routingEligible=False,nativeDoorId=None,access=None)
        out.append(d);used.update(d['arcHandles'])
    return out

def contact_repairs(floor,doors,max_gap=.002):
    ss=segments(floor);shapes=[LineString([s['a'],s['b']]) for s in ss];tree=STRtree(shapes);excluded={h for d in doors for h in d['leafHandles']+d['arcHandles']};excluded.update(h for s in floor['stairs'] for h in s['sourceHandles']);out=[];seen=set()
    for i,s in enumerate(ss):
        if s['handle'] in excluded or shapes[i].length<.04:continue
        for endpoint,p in enumerate([s['a'],s['b']]):
            hits=[]
            for j in tree.query(Point(p).buffer(max_gap)):
                j=int(j);t=ss[j]
                if j==i or t['handle'] in excluded or shapes[j].length<.04:continue
                d=shapes[j].distance(Point(p))
                if d<=1e-10:continue
                if not 1e-10<d<=max_gap:continue
                fraction=shapes[j].project(Point(p),normalized=True);q=list(shapes[j].interpolate(fraction,normalized=True).coords[0]);hits.append((d,j,fraction,q))
            if not hits:continue
            hits.sort(key=lambda x:(x[0],ss[x[1]]['handle'],ss[x[1]]['index']));d,j,t,q=hits[0]
            if any(abs(h[0]-d)<1e-9 and math.dist(h[3],q)>1e-8 for h in hits[1:]):continue
            key=tuple(sorted([tuple(p),tuple(q)]))
            if key in seen:continue
            seen.add(key);out.append(dict(id=f'{floor["id"]}:contact:{len(out)}',fromHandle=s['handle'],fromSegmentIndex=s['index'],fromEndpointIndex=endpoint,toHandle=ss[j]['handle'],toSegmentIndex=ss[j]['index'],toFraction=t,pointsMetres=[p,q],gapMetres=d,maximumGapMetres=max_gap,selectionOnly=True))
    return out


def stair_riser_witnesses(floor):
    """Exact paired riser strokes beside a previously recognized tread.

    This is symbol abstraction only. Endpoints must project onto the same
    finite tread span within 30 micrometres, with at most 25 mm separation.
    Railings run in a different direction and cannot satisfy this proof.
    """
    out=[]
    for seg in segments(floor):
        a,b=seg['a'],seg['b'];length=math.dist(a,b)
        if length<.3:continue
        for stair in floor['stairs']:
            for ti,tread in enumerate(stair.get('treads',[])):
                c,d=tread['pointsMetres'];width=math.dist(c,d)
                if width<.3 or abs(length-width)>.00003:continue
                v=[(d[i]-c[i])/width for i in [0,1]]
                normal=max(abs((p[0]-c[0])*-v[1]+(p[1]-c[1])*v[0]) for p in [a,b])
                ts=sorted(sum((p[i]-c[i])*v[i] for i in [0,1]) for p in [a,b])
                if normal<=.025 and abs(ts[0])<=.00003 and abs(ts[1]-width)<=.00003:
                    # The primary tread is already abstracted separately.
                    if normal>1e-8:
                        out.append(dict(handle=seg['handle'],segmentIndex=seg['index'],stairId=stair['id'],treadIndex=ti,pointsMetres=[a,b],comparisonOnly=True,routingEligible=False))
                    break
            else:continue
            break
    return out


def repaired_polygons(floor,doors,repairs,stair_symbols=None):
    from shapely.ops import polygonize,unary_union
    key=lambda ps:tuple(sorted(tuple(round(float(v),6) for v in p) for p in ps))
    removed={key(ps) for d in doors for ps in d.get('leafSegmentsMetres',[])}
    removed.update(key(t['pointsMetres']) for s in floor['stairs'] for t in s.get('treads',[]))
    removed.update(key(w['pointsMetres']) for w in stair_symbols or [])
    excluded={h for d in doors for h in d['arcHandles']};parts={}
    for c in repairs:
        parts.setdefault((c['toHandle'],c['toSegmentIndex']),[]).append((c['toFraction'],c['pointsMetres'][1]))
    lines=[]
    for p in floor['primitives']:
        if p['sourceHandle'] in excluded:continue
        for i,(a,b) in enumerate(zip(p['pointsMetres'],p['pointsMetres'][1:])):
            if math.dist(a,b)<1e-6 or key([a,b]) in removed:continue
            points=[(0,a),*parts.get((p['sourceHandle'],i),[]),(1,b)];points.sort(key=lambda x:x[0]);lines.append(LineString([q for _,q in points]))
    lines.extend(LineString(c['pointsMetres']) for c in repairs)
    lines.extend(LineString(t) for d in doors for t in d['thresholdSegmentsMetres'])
    return [p for p in polygonize(unary_union(lines)) if p.area>=1]


def open_entrance_candidates(floor,doors,polys):
    """Propose logical boundaries only when finite caps split shared identities.

    A parallel cap pair is not a door: window/column/fixture lookalikes remain
    possible. These records are deliberately excluded from path compilation.
    """
    from shapely.ops import split
    ss=segments(floor);excluded={h for d in doors for h in d['leafHandles']+d['arcHandles']}
    caps=[s for s in ss if .07<=math.dist(s['a'],s['b'])<=.65 and s['handle'] not in excluded]
    shapes=[LineString([s['a'],s['b']]) for s in ss];source_tree=STRtree(shapes);cap_tree=STRtree([LineString([s['a'],s['b']]) for s in caps]);poly_tree=STRtree(polys);out=[];seen=set()
    for i,a in enumerate(caps):
        length=math.dist(a['a'],a['b']);v=[(a['b'][k]-a['a'][k])/length for k in [0,1]];n=[-v[1],v[0]];p=[(a['a'][k]+a['b'][k])/2 for k in [0,1]]
        for j in cap_tree.query(Point(p).buffer(2.7)):
            j=int(j)
            if j<=i:continue
            b=caps[j];other_length=math.dist(b['a'],b['b']);bv=[(b['b'][k]-b['a'][k])/other_length for k in [0,1]]
            if abs(sum(v[k]*bv[k] for k in [0,1]))<.9999 or abs(length-other_length)>.02:continue
            q=[(b['a'][k]+b['b'][k])/2 for k in [0,1]];delta=[q[k]-p[k] for k in [0,1]];width=math.dist(p,q)
            if abs(sum(delta[k]*v[k] for k in [0,1]))>.002 or not .5<=abs(sum(delta[k]*n[k] for k in [0,1]))<=2.5:continue
            line=LineString([p,q]);key=tuple(sorted([tuple(p),tuple(q)]))
            if key in seen or any(LineString(d['closedLeafMetres']).distance(line)<.2 for d in doors):continue
            inner=LineString([[p[k]+.001*delta[k]/width for k in [0,1]],[q[k]-.001*delta[k]/width for k in [0,1]]])
            if any(ss[int(si)]['handle'] not in [a['handle'],b['handle']] and ss[int(si)]['handle'] not in excluded and shapes[int(si)].intersects(inner) for si in source_tree.query(inner)):continue
            midpoint=line.interpolate(.5,normalized=True);owners=[polys[int(pi)] for pi in poly_tree.query(midpoint) if polys[int(pi)].contains(midpoint)]
            if len(owners)!=1:continue
            owner=owners[0];labels=[r for r in floor['regions'] if owner.contains(Point(r['anchorMetres']))]
            if len(labels)<2:continue
            # Both original cap contacts lie on the area's source boundary;
            # never extend a freehand cut beyond the finite opening evidence.
            if max(owner.boundary.distance(Point(x)) for x in [p,q])>.002:continue
            parts=list(split(owner,line).geoms)
            groups=[[r['roomKey'] for r in labels if part.contains(Point(r['anchorMetres']))] for part in parts]
            if len([keys for keys in groups if keys])<2:continue
            pairs=min([[[a['a'],b['a']],[a['b'],b['b']]],[[a['a'],b['b']],[a['b'],b['a']]]],key=lambda pair:sum(math.dist(*ps) for ps in pair))
            if any(sorted(sorted(g) for g in c['roomGroups'])==sorted(sorted(g) for g in groups) and LineString(c['pointsMetres']).hausdorff_distance(line)<.2 for c in out):continue
            seen.add(key);out.append(dict(id=f'{floor["id"]}:logical-entrance:{len(out)}',capWitnesses=[dict(handle=c['handle'],segmentIndex=c['index']) for c in [a,b]],pointsMetres=[p,q],thresholdSegmentsMetres=pairs,widthMetres=width,roomGroups=groups,previewRingsMetres=[[list(map(list,part.exterior.coords))]+[list(map(list,r.coords)) for r in part.interiors] for part in parts],status='proposal-only',applied=False,physicalDoorId=None,routingEligible=False,access=None,reason='Original parallel cap pair divides a shared labelled area. Confirm wall/column/window ownership and intended doorless entrance before applying a logical partition; this is not a physical wall.'))
    return out
