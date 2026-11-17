import sys,re
p='/content/diag/reviter/lib/reviter/native-circulation-geometry.ts'
s=open(p).read()
def rep(old,new,count=1):
    global s
    n=s.count(old)
    assert n==count, (old[:70], n)
    s=s.replace(old,new)
rep('function nativeCellDoorApproach(','export function nativeCellDoorApproach(')
rep('function createDoorApproachContext(','export function createDoorApproachContext(')
rep('  for (const door of candidateDoors) {\n','  for (const door of candidateDoors) {\n    const DBG = door.nativeElementId === Number(process.env.DBG_DOOR);\n    const num=(parts:any)=>{try{return JSON.stringify(nativeExactPartsForProposals(parts).map((r:any)=>r.map((ring:any)=>ring.map((q:any)=>[+q[0].toFixed(3),+q[1].toFixed(3)]))));}catch(e){return "ERR "+String(e);}};\n    if (DBG) { const e0 = context.edges.get(door.id); console.log("DBG door", door.id, "cell", cell.id, JSON.stringify({hasEdge: !!e0, floorBlocked: context.floorBlockedDoors.has(door.id), kind: e0?.kind, enabled: e0?.enabled, edgeNative: e0?.nativeElementId, state: door.state, host: door.hostWallNativeElementId, edgeRooms: e0?.roomKeys, doorRooms: door.roomKeys, clearOpening: nativeDoorClearOpening(data, door, cell.elevationFeet) ?? null, local: !!local})); }\n')
rep('      if (!floors.length || !envelope.length) continue;\n','      if (DBG) console.log("DBG node", node!.id, JSON.stringify({point: node!.pointFeet, half, floors: floors.length, envelope: envelope.length, nearMasks: level.masks.filter(near).map((m:any)=>({id:m.nativeId,column:m.column,repair:m.repair,owned:m.nativeId!==undefined&&level.ownsAperture(door.hostWallNativeElementId,door.nativeElementId,m.nativeId),box:m.box}))}));\n      if (!floors.length || !envelope.length) continue;\n')
rep('        let parts=nativeRationalOverlay("intersection",nativeRationalThresholdHalf(footprint,normal,node!.pointFeet),floors);\n','        let parts=nativeRationalOverlay("intersection",nativeRationalThresholdHalf(footprint,normal,node!.pointFeet),floors);\n        if (DBG) console.log("DBG half∩floors", num(parts), "masks", masks.length);\n')
rep('        parts=nativeRationalOverlay("intersection",parts,envelope);\n','        parts=nativeRationalOverlay("intersection",parts,envelope);\n        if (DBG) console.log("DBG ∩envelope", num(parts));\n')
rep('        if(masks.length)parts=nativeRationalOverlay("difference",parts,masks);\n','        if(masks.length)parts=nativeRationalOverlay("difference",parts,masks);\n        if (DBG) console.log("DBG −masks", num(parts), "parts", parts.length);\n')
rep('            if(nativeLocalFaceJoins(local,[part],node!.pointFeet))acceptNativeLocalFacePiece(local,[part]);\n','            { const j=nativeLocalFaceJoins(local,[part],node!.pointFeet); if (DBG) console.log("DBG local joins", j, num([part])); if(j)acceptNativeLocalFacePiece(local,[part]); }\n')
rep('          const joined=context.exactDoorUnion.union(exactParts,[part]);\n','          const joined=context.exactDoorUnion.union(exactParts,[part]);\n          if (DBG) console.log("DBG union parts", joined.length, "contains node", nativeRationalPointInParts(node!.pointFeet,joined), "part", num([part]), "partContainsNode", nativeRationalPointInParts(node!.pointFeet,[part]));\n')
rep('      } catch { /* Unknown exact doorway support remains blocked. */ }\n','      } catch (e) { if (DBG) console.log("DBG catch", String(e)); }\n')
open(p,'w').write(s); print('patched')
