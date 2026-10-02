import test from "node:test";
import assert from "node:assert/strict";
import pc from "polygon-clipping";
import { prepareRoomBlocks } from "../lib/reviter/room-block-presentation.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";

type Point = [number, number];
type Rings = Point[][];
type Parts = Rings[];
const rect = (x0: number, y0: number, x1: number, y1: number): Rings => [[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]];
const wall = (id: number, ringsFeet: Rings, levelId = 1): IndoorDataset["walls"][number] => ({kind:"wall",nativeElementId:id,levelId,ringsFeet});
function area(parts: Parts): number {
  let total = 0;
  for (const polygon of parts) for (const [index, ring] of polygon.entries()) {
    let sum = 0;
    for (const [i,p] of ring.entries()) { const q=ring[(i+1)%ring.length]; sum += p[0]*q[1]-q[0]*p[1]; }
    total += (index ? -1 : 1)*Math.abs(sum)/2;
  }
  return total;
}
const covers = (parts: Parts, x: number, y: number) => area(pc.intersection(parts,rect(x-.01,y-.01,x+.01,y+.01))) > .00039;
function sameGeometry(a: Parts, b: Parts) {
  assert.ok(area(pc.xor(a,b)) < .0001, "Same geometric region independent of naming or ordering");
}

test("room roofs absorb native perimeter while corridors, doors and holes remain clear", () => {
  const rooms = [{roomKey:"room",levelId:1,ringsFeet:[...rect(0,0,10,10),rect(2,2,4,4)[0]]}];
  const walls = [wall(1,rect(-1,-1,0,11)),wall(2,rect(10,-1,11,11)),wall(3,rect(-1,-1,11,0)),wall(4,rect(-1,10,11,11)),
    {...wall(5,rect(4,4,5,5)),kind:"column" as const}];
  const doors: NonNullable<IndoorDataset["doors"]> = [{id:"door",levelId:1,nativeElementId:8,pointFeet:[10.5,5],footprintFeet:rect(9.8,4,11.2,6)[0],roomKeys:["room"],state:"connected"}];
  const protectedAreas = [{levelId:1,ringsFeet:rect(11,0,16,10)}];
  const before = JSON.stringify({rooms,walls,doors,protectedAreas});
  const blocks=prepareRoomBlocks(rooms,walls,doors,protectedAreas).get("room")!;
  assert.ok(covers(blocks,-.5,5));
  assert.ok(covers(blocks,10.5,8));
  assert.ok(covers(blocks,-.5,-.5),"Actual native corner material included");
  assert.ok(!covers(blocks,11.5,5),"Open corridor stays open");
  assert.ok(!covers(blocks,10.5,5),"Recovered doorway stays cut out");
  assert.ok(!covers(blocks,3,3),"Original polygon hole stays open");
  assert.equal(JSON.stringify({rooms,walls,doors,protectedAreas}),before);
});

test("opposite sides of straight shared wall meet at its centerline independent of names and ordering", () => {
  const rooms=[{roomKey:"left",levelId:1,ringsFeet:rect(0,0,10,10)}, {roomKey:"right",levelId:1,ringsFeet:rect(11,0,21,10)}];
  const walls=[wall(1,rect(10,0,11,10))];
  const blocks=prepareRoomBlocks(rooms,walls,[],[]);
  const left=blocks.get("left")!,right=blocks.get("right")!;
  assert.ok(covers(left,10.25,5));
  assert.ok(!covers(left,10.75,5));
  assert.ok(covers(right,10.75,5));
  assert.ok(!covers(right,10.25,5));
  assert.ok(area(pc.intersection(left,right)) < 1e-8);
  assert.equal(area(pc.union(left,right)),210,"Entire partition thickness owned without an overlap or neutral gap");
  const reversed=prepareRoomBlocks([...rooms].reverse(),[...walls].reverse(),[],[]);
  sameGeometry(left,reversed.get("left")!);
  sameGeometry(right,reversed.get("right")!);
  const renamed=prepareRoomBlocks([{...rooms[0],roomKey:"zzz"},{...rooms[1],roomKey:"aaa"}],walls,[],[]);
  sameGeometry(left,renamed.get("zzz")!);
  sameGeometry(right,renamed.get("aaa")!);
});

test("rotated shared walls preserve centerline ownership and native floor identities", () => {
  const angle=.47,c=Math.cos(angle),s=Math.sin(angle);
  const rotate=(rings:Rings):Rings=>rings.map(ring=>ring.map(([x,y])=>[x*c-y*s+50,x*s+y*c-20]));
  const rooms=[{roomKey:"a",levelId:1,ringsFeet:rotate(rect(0,0,10,10))},{roomKey:"b",levelId:1,ringsFeet:rotate(rect(11,0,21,10))},
    {roomKey:"other-floor",levelId:2,ringsFeet:rotate(rect(0,0,10,10))}];
  const walls=[wall(1,rotate(rect(10,0,11,10)))];
  const blocks=prepareRoomBlocks(rooms,walls,[],[]);
  assert.ok(Math.abs(area(blocks.get("a")!)-105)<.004);
  assert.ok(Math.abs(area(blocks.get("b")!)-105)<.004);
  assert.ok(area(pc.intersection(blocks.get("a")!,blocks.get("b")!))<1e-7);
  assert.ok(Math.abs(area(blocks.get("other-floor")!)-100)<.004,"Same XY on another native floor does not absorb walls");
  sameGeometry(blocks.get("a")!,prepareRoomBlocks([...rooms].reverse(),walls,[],[]).get("a")!);
});

test("ambiguous irregular shared material remains neutral rather than being assigned by first key", () => {
  const rooms=[{roomKey:"a",levelId:1,ringsFeet:rect(0,0,10,10)}, {roomKey:"b",levelId:1,ringsFeet:rect(11,0,21,10)}];
  const walls=[wall(1,[[[10,0],[11,0],[11,10],[10.7,10],[10.7,9],[10,9]]])];
  const blocks=prepareRoomBlocks(rooms,walls,[],[]);
  assert.ok(!covers(blocks.get("a")!,10.5,5));
  assert.ok(!covers(blocks.get("b")!,10.5,5));
  assert.ok(!covers(blocks.get("b")!,10.9,9.5),"Irregular multiply-claimed wall material stays neutral");
  assert.ok(area(pc.intersection(blocks.get("a")!,blocks.get("b")!))<1e-8);
  const reverse=prepareRoomBlocks([...rooms].reverse(),walls,[],[]);
  sameGeometry(blocks.get("a")!,reverse.get("a")!);
  sameGeometry(blocks.get("b")!,reverse.get("b")!);
});

test("straight partition junctions assign shared long perimeter walls without corner roof gaps", () => {
  const rooms=[{roomKey:"left",levelId:1,ringsFeet:rect(0,0,10,10)}, {roomKey:"right",levelId:1,ringsFeet:rect(11,0,21,10)}];
  const walls=[wall(1,rect(10,0,11,10)),wall(2,rect(0,10,21,11))];
  const blocks=prepareRoomBlocks(rooms,walls,[],[]);
  const left=blocks.get("left")!,right=blocks.get("right")!;
  assert.ok(covers(left,10.25,10.5),"Left roof extends cleanly through perimeter junction");
  assert.ok(covers(right,10.75,10.5),"Right roof extends cleanly through perimeter junction");
  assert.ok(area(pc.intersection(left,right))<1e-8);
  assert.equal(area(pc.union(left,right)),231,"Every native partition and perimeter face is covered once");
  const reverse=prepareRoomBlocks([...rooms].reverse(),[...walls].reverse(),[],[]);
  sameGeometry(left,reverse.get("left")!);
  sameGeometry(right,reverse.get("right")!);
});

test("blocks never fabricate missing free-space corners or claim a nearby detached wall", () => {
  const inset: Rings=[[[0,1],[1,0],[10,0],[10,10],[0,10]]];
  const rooms=[{roomKey:"bevel",levelId:1,ringsFeet:inset}];
  const walls=[wall(1,rect(-1,0,0,10)),wall(2,rect(0,-1,10,0)),wall(3,rect(-2,0,-1.5,10))];
  const blocks=prepareRoomBlocks(rooms,walls,[],[]).get("bevel")!;
  assert.ok(!covers(blocks,.2,.2),"Missing room floor is not invented by wall bands");
  assert.ok(!covers(blocks,-1.75,5),"Detached nearby wall is not room-owned");
  assert.ok(covers(blocks,-.5,5));
});

test("large coordinate offsets and explicit void cuts remain stable without editing source", () => {
  const shift=(rings:Rings):Rings=>rings.map(ring=>ring.map(([x,y])=>[x+10_000_000,y-20_000_000]));
  const rooms=[{roomKey:"large",levelId:1,ringsFeet:shift(rect(0,0,10,10))}];
  const walls=[wall(1,shift(rect(10,0,11,10)))];
  const protectedAreas=[{levelId:1,ringsFeet:shift(rect(8,8,12,12))}];
  const blocks=prepareRoomBlocks(rooms,walls,[],protectedAreas).get("large")!;
  const local=blocks.map(poly=>poly.map(ring=>ring.map(([x,y])=>[x-10_000_000,y+20_000_000] as Point)));
  assert.equal(area(local),104);
  assert.ok(!covers(local,9,9));
  assert.ok(covers(local,10.5,5));
});
