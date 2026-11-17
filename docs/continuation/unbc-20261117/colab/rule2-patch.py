# Candidate rule (fallback form): when a door's envelope-cut threshold half fails to join its
# cell, retry once with the door's own host material counted as indoors. Usage: rule2-patch.py FILE
import sys,re
p=sys.argv[1]; s=open(p).read()
start='      try {\n        let parts=nativeRationalOverlay("intersection",nativeRationalThresholdHalf(footprint,normal,node!.pointFeet),floors);\n'
end='      } catch { /* Unknown exact doorway support remains blocked. */ }\n'
i=s.index(start); j=s.index(end,i)+len(end)
assert s.count(start)==1
new='''      try {
        const halfOnFloor=nativeRationalOverlay("intersection",nativeRationalThresholdHalf(footprint,normal,node!.pointFeet),floors);
        const tryJoin=(inside:any):boolean=>{
          let parts=inside,joinedAny=false;
          if(masks.length)parts=nativeRationalOverlay("difference",parts,masks);
          for(const part of parts){
            if(local){
              // Same exact decision as the global union below, made in a window.
              if(nativeLocalFaceJoins(local,[part],node!.pointFeet)){acceptNativeLocalFacePiece(local,[part]);joinedAny=true;}
              continue;
            }
            const joined=context.exactDoorUnion.union(exactParts,[part]);
            if(joined.length===1&&nativeRationalPointInParts(node!.pointFeet,joined)){
              exactParts=freezeNativeRationalParts(joined);rings=nativeExactPartsForProposals(joined)[0];context.exactApproaches.set(rings,exactParts);joinedAny=true;
            }
          }
          return joinedAny;
        };
        if(!tryJoin(nativeRationalOverlay("intersection",halfOnFloor,envelope))){
          // The door's own host material inside its aperture is indoors. Used only when the
          // envelope-cut half does not join: the envelope strip can miss the cell by a float residue.
          const ownHost=level.masks.filter((p:any)=>!p.column&&!p.repair&&p.nativeId!==undefined&&level.ownsAperture(door.hostWallNativeElementId,door.nativeElementId,p.nativeId)&&near(p)).map((p:any)=>p.rings);
          if(ownHost.length)tryJoin(nativeRationalOverlay("intersection",halfOnFloor,nativeRationalOverlay("union",envelope,ownHost)));
        }
      } catch { /* Unknown exact doorway support remains blocked. */ }
'''
open(p,'w').write(s[:i]+new+s[j:]); print('fallback rule patched',p)
