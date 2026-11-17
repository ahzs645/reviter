import { readFileSync, writeFileSync } from "node:fs";
const R = process.env.RV + "/lib/reviter";
const g = await import(R + "/native-circulation-geometry.ts");
const o = await import(R + "/native-exact-geos-overlay.ts"); await o.initializeNativeExactGeosOverlay?.();
const data = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const only = process.argv[4] ? new Set(process.argv[4].split(",")) : undefined;
if (only) data.circulationGeometry.cells = data.circulationGeometry.cells.filter((c: any) => only.has(c.id));
const t0 = Date.now();
const added = g.attachNativeCirculationCellRoutes(data);
const list = () => data.edges.filter((e: any) => e.nativeCellId || (e.kind === "walk" && e.reviewedCirculationLinkId === undefined)).map((e: any) => ({ id: e.id, from: e.from, to: e.to, m: e.lengthMetres, enabled: e.enabled }));
const walks = list();
let replay: any = null;
if (process.env.REPLAY) { try { const r = g.replayNativePhysicalCellRoutes(data); const after = list(); const ids = new Set(after.filter((w: any) => w.enabled !== false).map((w: any) => w.id)); replay = { keys: Object.keys(r ?? {}), lost: walks.filter((w: any) => !ids.has(w.id)).map((w: any) => w.id), survivedNew: [...ids].filter((i: any) => String(i).includes("2471813")) }; } catch (e) { replay = { error: String(e).slice(0, 400) }; } }
writeFileSync(process.argv[3]!, JSON.stringify({ added, seconds: (Date.now() - t0) / 1000, walks, replay }));
console.log("ATTACH_DONE added", added, "walks", walks.length, "seconds", (Date.now() - t0) / 1000, "replay", JSON.stringify(replay));
