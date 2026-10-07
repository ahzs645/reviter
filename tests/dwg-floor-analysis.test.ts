import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCadFloors, fitCadFloorControls, type CadAnalysisFloor, type CadFloorControl } from "../lib/reviter/dwg-floor-analysis.ts";
import { cadFloorAnalysisPreview } from "../lib/reviter/dwg-floor-analysis-view.ts";

const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
function floor(id: string, ordinal: number): CadAnalysisFloor {
  return { id, ordinal, buildingCode: "01", name: id, alignment: { status: ordinal === 0 ? "local-reference" : "provisional" },
    primitives: [{ sourceHandle: "outline", pointsMetres: ring }],
    stairAreas: [{ id: id + ":stair", ringsMetres: [ring], sourceHandles: ["outline"], runIds: [id + ":run"] }],
    stairs: [{ id: id + ":run", stairAreaId: id + ":stair" }], regions: [], stairReview: [] };
}
const control = (): CadFloorControl => ({ floorId: "upper", referenceFloorId: "base", pairs: [[0, 0], [4, 0], [0, 4]].map((p, i) => ({
  id: String(i), sourceHandle: "outline", referenceHandle: "outline", pointMetres: p as [number, number], referencePointMetres: p as [number, number],
})) });
test("floor comparison sorts explicit ordinals, retains weak alignment and never creates routes", () => {
  const base = floor("base", 0), upper = floor("upper", 1); upper.alignment.status = "needs-review";
  const report = analyzeCadFloors([upper, base]);
  assert.equal(report.candidates.length, 1); assert.equal(report.candidates[0]!.fromFloorId, "base");
  assert.equal(report.candidates[0]!.alignmentStatus, "alignment-needs-review");
  assert.equal(report.candidates[0]!.routingEligible, false); assert.deepEqual(report.graphEdges, []);
  assert.equal(report.appliedToNativeGeometry, false); assert.equal(report.floors[0]!.nativeLevelId, null);
});
test("holes, other buildings, missing floors and conflicting room ownership prevent correspondence", () => {
  const base = floor("base", 0), upper = floor("upper", 1);
  base.stairAreas[0]!.ringsMetres.push([[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]);
  upper.stairAreas[0]!.ringsMetres = [[[1.1, 1.1], [2.9, 1.1], [2.9, 2.9], [1.1, 2.9], [1.1, 1.1]]];
  assert.equal(analyzeCadFloors([base, upper]).candidates.length, 0);
  upper.stairAreas[0]!.ringsMetres = [ring]; upper.buildingCode = "02";
  assert.equal(analyzeCadFloors([base, upper]).candidates.length, 0);
  upper.buildingCode = "01"; upper.ordinal = 2;
  assert.match(analyzeCadFloors([base, upper]).unresolved[0]!.reason, /Intermediate/);
  upper.ordinal = 1; upper.stairAreas[0]!.conflictingRoomKeys = ["office"];
  assert.equal(analyzeCadFloors([base, upper]).candidates.length, 0);
});
test("multiple overlapping stair candidates are not resolved by choosing the highest score", () => {
  const upper = floor("upper", 1); upper.stairAreas.push({ ...upper.stairAreas[0]!, id: "other" });
  const report = analyzeCadFloors([floor("base", 0), upper]);
  assert.equal(report.candidates.length, 0); assert.ok(report.unresolved.some(v => v.reason.includes("ambiguous")));
});
test("distributed finite source contacts reuse the Reviter fitter and preserve original data", () => {
  const base = floor("base", 0), upper = floor("upper", 1);
  const before = JSON.stringify([base, upper]);
  const report = analyzeCadFloors([upper, base], [control()]);
  assert.equal(report.registrations[0]!.controlCount, 3); assert.equal(report.registrations[0]!.rmsMetres, 0);
  assert.equal(report.candidates[0]!.alignmentStatus, "control-checked-local");
  assert.equal(report.candidates[0]!.servedFloorsVerified, false); assert.equal(JSON.stringify([base, upper]), before);
});
test("rotation/translation corrects correspondence without rescaling or modifying strokes", () => {
  const base = floor("base", 0), upper = floor("upper", 1);
  const moved = ring.map(([x, y]): [number, number] => [10 - y, 20 + x]);
  upper.primitives[0]!.pointsMetres = moved; upper.stairAreas[0]!.ringsMetres = [moved];
  const c = control(); c.pairs.forEach(p => { const [x, y] = p.pointMetres; p.pointMetres = [10 - y, 20 + x]; });
  assert.equal(analyzeCadFloors([base, upper]).candidates.length, 0);
  const report = analyzeCadFloors([base, upper], [c]);
  assert.equal(report.candidates[0]!.overlapRatio, 1); assert.equal(report.registrations[0]!.uniformScaleCheck, 1);
  assert.deepEqual(upper.primitives[0]!.pointsMetres, moved);
});
test("controls reject stale handles, floating points, collinearity, unit drift and reflected fits", () => {
  const base = floor("base", 0), upper = floor("upper", 1);
  let c = control(); c.pairs[0]!.sourceHandle = "absent"; assert.throws(() => fitCadFloorControls(upper, base, c), /source/);
  c = control(); c.pairs[0]!.pointMetres = [1, 1]; assert.throws(() => fitCadFloorControls(upper, base, c), /source/);
  c = control(); c.pairs[2]!.pointMetres = [2, 0]; c.pairs[2]!.referencePointMetres = [2, 0]; assert.throws(() => fitCadFloorControls(upper, base, c), /distributed/);
  c = control(); upper.primitives[0]!.pointsMetres = ring.map(([x, y]) => [x * 2, y * 2]); c.pairs.forEach(p => { p.pointMetres = p.pointMetres.map(v => v * 2) as [number, number]; });
  assert.throws(() => fitCadFloorControls(upper, base, c), /stretch/);
  c = control(); upper.primitives[0]!.pointsMetres = ring.map(([x, y]) => [-x, y]); c.pairs.forEach(p => { p.pointMetres[0] *= -1; });
  assert.throws(() => fitCadFloorControls(upper, base, c));
});
test("duplicate identities, floor ordinals and chained controls fail closed", () => {
  assert.throws(() => analyzeCadFloors([floor("same", 0), floor("same", 1)]), /Unique/);
  assert.throws(() => analyzeCadFloors([floor("base", 0), floor("upper", 0)]), /ordinals/);
  const c = control(); c.referenceFloorId = "middle";
  assert.throws(() => analyzeCadFloors([floor("base", 0), floor("middle", 1), floor("upper", 2)], [c]), /base drawing/);
  assert.throws(() => analyzeCadFloors([floor("base", 0), floor("upper", 1)], [control(), control()]), /Duplicate/);
});
test("review preview escapes drawing strings and refuses stale template integration", () => {
  const f = floor("base", 0); f.name = "</script><script>bad()</script>";
  const report = analyzeCadFloors([f]);
  const template = '<p id="facts"></p><script>selection=null;$(\'selectedSpace\')</script></html>';
  const html = cadFloorAnalysisPreview(template, report);
  assert.ok(html.includes("Floor alignment and connections"));
  assert.ok(html.includes("renderFloorAnalysis();selection=null"));
  assert.ok(!html.includes("</script><script>bad()"));
  assert.throws(() => cadFloorAnalysisPreview("<html></html>", report), /template changed/);
});

test("label families retain unrepresented intermediate stops without creating skipped-floor routes", () => {
  const base=floor('a',0),middle=floor('b',1),upper=floor('c',2);
  base.rooms=[{key:'r0',number:'14-S103',name:'Stair',anchorMetres:[0,0],source:{handle:'original0'}}];
  middle.rooms=[];upper.rooms=[{key:'r2',number:'14-S303',name:'Stair',anchorMetres:[0,0],source:{handle:'original2'}}];
  for(const f of [base,middle,upper])f.buildingCode='14';
  const report=analyzeCadFloors([upper,base,middle]);
  assert.equal(report.stairFamilies.length,1);
  assert.deepEqual(report.stairFamilies[0]!.missingDrawingOrdinals,[1]);
  assert.equal(report.stairFamilies[0]!.servedFloorsVerified,false);
  assert.deepEqual(report.graphEdges,[]);
  assert.ok(!report.candidates.some(c=>c.fromFloorId==='a'&&c.toFloorId==='c'));
});

test("embedded review uses trusted code and defers inline-data initialization until comparison functions exist", async () => {
 const {readFile}=await import('node:fs/promises');
 const {cadFloorReviewDocument}=await import('../lib/reviter/dwg-floor-analysis-view.ts');
 const template=await readFile(new URL('../tools/dwg-analysis/building-geometry.html',import.meta.url),'utf8');
 const report=analyzeCadFloors([floor('a',0),floor('b',1)]);
 const result=cadFloorReviewDocument(template,{floors:[],sourceLabel:'</script><script>unsafe()</script>'},report);
 assert.ok(result.includes("window.addEventListener('DOMContentLoaded'"));
 assert.ok(result.includes("}})();});\n</script>"));
 assert.ok(result.includes('function renderFloorAnalysis()'));
 assert.ok(!result.includes('unsafe()</script>'));
 assert.ok(!result.includes("fetch('geometry.json'"));
});
