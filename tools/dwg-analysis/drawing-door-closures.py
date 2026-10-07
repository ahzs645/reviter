"""Close drawing selections at original finite wall contacts; never extend a wall."""
import math
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

def recover_selection_closures(floor):
    source=[];handles=[];by_handle={}
    for p in floor['primitives']:
        by_handle.setdefault(p['sourceHandle'],[]).append(p)
        for a,b in zip(p['pointsMetres'],p['pointsMetres'][1:]):
            if math.dist(a,b)>1e-9:source.append(LineString([a,b]));handles.append(p['sourceHandle'])
    tree=STRtree(source) if source else None
    proofs=[];corrected=[]
    for d in floor['doors']:
        a,b=d['closedLeafMetres'];width=math.dist(a,b)
        if width<.1:corrected.append(d);continue
        ux,uy=(b[0]-a[0])/width,(b[1]-a[1])/width;nx,ny=-uy,ux
        replacement=[];contacts=[];frame_handles=set()
        for threshold in d['thresholdSegmentsMetres']:
            normal=sum((p[0]-a[0])*nx+(p[1]-a[1])*ny for p in threshold)/2
            before=[];after=[]
            for handle in d['supportingWallHandles']:
                for p in by_handle.get(handle,[]):
                    if p['type'] not in ('LINE','LWPOLYLINE'):continue
                    for left,right in zip(p['pointsMetres'],p['pointsMetres'][1:]):
                        length=math.dist(left,right)
                        if length<.04:continue
                        if abs((right[0]-left[0])*nx+(right[1]-left[1])*ny)/length>.002:continue
                        # Only sub-0.1 mm face-line discrepancy is corrected.
                        if max(abs((q[0]-a[0])*nx+(q[1]-a[1])*ny-normal) for q in (left,right))>.0001:continue
                        pts=sorted((left,right),key=lambda q:(q[0]-a[0])*ux+(q[1]-a[1])*uy)
                        ts=[(q[0]-a[0])*ux+(q[1]-a[1])*uy for q in pts]
                        if ts[0]<-.04 and -.4<=ts[1]<=.05:before.append((ts[1],pts[1],handle))
                        if ts[1]>width+.04 and width-.05<=ts[0]<=width+.4:after.append((ts[0],pts[0],handle))
            if not before or not after:continue
            # First original contact on either side; never skip to a farther support.
            before.sort(key=lambda x:-x[0]);after.sort(key=lambda x:x[0]);lo,hi=before[0],after[0]
            if any(abs(x[0]-lo[0])<1e-7 and math.dist(x[1],lo[1])>1e-6 for x in before[1:]) or any(abs(x[0]-hi[0])<1e-7 and math.dist(x[1],hi[1])>1e-6 for x in after[1:]):continue
            ps=[lo[1],hi[1]];line=LineString(ps)
            allowed=set(d['arcHandles']+d['leafHandles']+d['supportingWallHandles'])
            conflict=False;local_frames=set()
            for idx in tree.query(line) if tree else []:
                idx=int(idx)
                if handles[idx] in allowed:continue
                hit=line.intersection(source[idx])
                if hit.is_empty:continue
                if hit.geom_type=='Point' and min(hit.distance(Point(q)) for q in ps)<1e-8:continue
                segment=source[idx];points=list(segment.coords)
                # Original perpendicular jamb caps / parallel leaf-body strokes
                # may meet the closure only in a measured leaf endpoint band.
                ts=[(q[0]-a[0])*ux+(q[1]-a[1])*uy for q in points]
                across=abs((points[-1][0]-points[0][0])*ux+(points[-1][1]-points[0][1])*uy)/segment.length
                end_band=min(max(abs(t) for t in ts),max(abs(t-width) for t in ts))<=.1
                normals=[(q[0]-a[0])*nx+(q[1]-a[1])*ny for q in points]
                cap=segment.length<=.6 and min(abs(v-normal) for v in normals)<=.25
                leaf_body=segment.length<=width+.2 and min(abs(v) for v in normals)<=.2 and max(abs(v) for v in normals)>=width-.1
                if across<=.002 and end_band and (cap or leaf_body):local_frames.add(handles[idx]);continue
                conflict=True;break
            if conflict:continue
            frame_handles.update(local_frames)
            if ps not in replacement:
                replacement.append(ps);contacts.append(dict(handles=[lo[2],hi[2]],pointsMetres=ps,hingeMarginMetres=-lo[0],latchMarginMetres=hi[0]-width))
        if not replacement:corrected.append(d);continue
        if replacement==d['thresholdSegmentsMetres']:corrected.append(d);continue
        proof=dict(doorId=d['id'],originalThresholdSegmentsMetres=d['thresholdSegmentsMetres'],selectionThresholdSegmentsMetres=replacement,contacts=contacts,endpointFrameHandles=sorted(frame_handles),selectionOnly=True,physicalDoorWidthMetres=d['widthMetres'],maximumNormalCorrectionMetres=.0001,maximumEndMarginMetres=.4)
        proofs.append(proof);corrected.append(dict(d,thresholdSegmentsMetres=replacement))
    return corrected,proofs
