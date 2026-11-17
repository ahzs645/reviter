import { readFileSync } from "node:fs";
const R = "/content/diag/reviter/lib/reviter";
const g = await import(R + "/native-circulation-geometry.ts");
const { nativeRationalPointInParts } = await import(R + "/native-exact-planar-topology.ts");
try { const o = await import(R + "/native-exact-geos-overlay.ts"); await o.initializeNativeExactGeosOverlay?.(); console.log("geos overlay initialised"); } catch (e) { console.log("no geos init", String(e).slice(0, 200)); }
const data = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log("dataset loaded", data.nodes.length, data.edges.length, "geometryKeyOk", data.circulationGeometry.sourceGeometryKey === g.nativeCirculationGeometryKey(data));
const context = g.createDoorApproachContext(data);
for (const [cellId, doorId, nodeIds] of JSON.parse(process.argv[3]!) as [string, number, string[]][]) {
  process.env.DBG_DOOR = String(doorId);
  const cell = data.circulationGeometry.cells.find((c: any) => c.id === cellId);
  console.log("\n=== cell", cellId, "rooms", cell.roomKeys, "door", doorId);
  const rings = g.nativeCellDoorApproach(data, context, cell);
  const exact = context.exactApproaches.get(rings);
  console.log("approach ring bbox", [Math.min(...rings[0].map((p: any) => p[0])), Math.min(...rings[0].map((p: any) => p[1])), Math.max(...rings[0].map((p: any) => p[0])), Math.max(...rings[0].map((p: any) => p[1]))].map((v) => +v.toFixed(3)));
  for (const id of nodeIds) { const n = data.nodes.find((x: any) => x.id === id); console.log("node", id, n?.pointFeet, "in approach", n ? nativeRationalPointInParts(n.pointFeet, exact) : null); }
}
