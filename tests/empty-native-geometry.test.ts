import assert from "node:assert/strict";
import test from "node:test";
import { createRevit2027NativeMeshCollector, isExplicitEmptyGeometryDefinition } from "../lib/reviter/revit-2027-native-mesh-bridge.ts";
import { decodeRevit2027FramedGRepRoot, REVIT_2027_GELEMENT_OBJECT_MARKER } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT, type Revit2027GeometryStatic } from "../lib/reviter/revit-2027-geometry.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";

test("an explicitly empty symbol is a complete closure leaf but emits no triangles", () => {
  const data = new Uint8Array(212), v = new DataView(data.buffer);
  v.setBigUint64(0, 100n, true); v.setUint32(12,192,true); v.setUint16(16,REVIT_2027_GELEMENT_OBJECT_MARKER,true);
  v.setUint32(38,1,true); v.setInt32(42,3,true); v.setInt16(46,REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,true);
  for(const at of [48,96]) for(let i=0;i<6;i++) v.setFloat64(at+i*8,i<3?1e30:-1e30,true);
  v.setBigUint64(144,100n,true); v.setInt32(152,3,true); v.setUint32(156,2,true); v.setUint32(208,192,true);
  const root = decodeRevit2027FramedGRepRoot(data,{offset:0,elementId:100,objectLength:192,marker:REVIT_2027_GELEMENT_OBJECT_MARKER,typeCode:0},2027);
  assert.ok(root.ok); const replay = replayRevit2027GRepFifo(data,root.value); assert.ok(replay.ok);
  assert.equal(isExplicitEmptyGeometryDefinition(root.value,replay.value),true);
  assert.equal(isExplicitEmptyGeometryDefinition({...root.value,flags:0},replay.value),false);
  const collector = createRevit2027NativeMeshCollector(2027); collector.scanOwnedFrame(data);
  const result = collector.snapshot([100]);
  assert.equal(result.owners.size,0); assert.equal(result.storedTriangles,0);
  assert.equal(result.incompleteOwners,0);
  const geometry = replay.value.spans[0]!.value as Revit2027GeometryStatic;
  geometry.faces.count = 1;
  assert.equal(isExplicitEmptyGeometryDefinition(root.value,replay.value),false);
});
