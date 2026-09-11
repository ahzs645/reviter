#!/usr/bin/env node

/**
 * Instantiate a Pascal build JSON as a GLB, so the exported building can be
 * measured against a reference export.
 *
 * `export-pascal.ts` writes typed nodes, not geometry, which leaves the obvious
 * question — is the building it describes the right building? — unanswerable by
 * the export's own tests. This closes that: it builds the masses the node data
 * determines and hands them to `glb-surface-diff.ts`, which already knows how to
 * compare a recovered scene with an Autodesk one.
 *
 * A wall becomes a box on its centreline, a slab a prism inside its outline and
 * holes, a column a box, a stair its steps, and a block its bounding prism.
 * Levels are stacked by Pascal's own rule: ordinal order, running total, plus
 * each level's `baseElevation`.
 *
 * It is deliberately not a reimplementation of Pascal's renderers. There is no
 * wall mitering and no door or window opening cut out, because those refine a
 * surface without moving a building, and what is under test is the data the
 * export writes rather than a second renderer's fidelity.
 *
 * Usage:
 *   node --experimental-strip-types scripts/pascal-scene-glb.ts model.pascal.json out.glb
 *   node --experimental-strip-types scripts/glb-surface-diff.ts out.glb reference.glb
 */
import { readFileSync, writeFileSync } from "node:fs";

import * as THREE from "three";

type PascalNode = Record<string, unknown> & { id: string; type: string; parentId: string | null };

/** One buffer per Pascal node kind, so the diff can attribute its residual. */
const groups = new Map<string, { positions: number[]; indices: number[] }>();
let positions: number[] = [];
let indices: number[] = [];

function selectGroup(name: string): void {
  let group = groups.get(name);
  if (!group) {
    group = { positions: [], indices: [] };
    groups.set(name, group);
  }
  positions = group.positions;
  indices = group.indices;
}
selectGroup("wall");

function pushGeometry(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
  const applied = geometry.clone().applyMatrix4(matrix);
  const attribute = applied.getAttribute("position");
  const index = applied.getIndex();
  const base = positions.length / 3;
  for (let i = 0; i < attribute.count; i += 1) {
    positions.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
  }
  if (index) {
    for (let i = 0; i < index.count; i += 1) indices.push(base + index.getX(i));
  } else {
    for (let i = 0; i < attribute.count; i += 1) indices.push(base + i);
  }
  applied.dispose();
}

function box(
  width: number,
  height: number,
  depth: number,
  centre: [number, number, number],
  rotationY = 0,
): void {
  const matrix = new THREE.Matrix4()
    .makeRotationY(rotationY)
    .setPosition(centre[0], centre[1], centre[2]);
  // setPosition after makeRotationY keeps the rotation and places the centre.
  pushGeometry(new THREE.BoxGeometry(width, height, depth), matrix);
}

function prism(
  outline: [number, number][],
  holes: [number, number][][],
  bottom: number,
  top: number,
): void {
  if (outline.length < 3 || top <= bottom) return;
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const hole of holes) {
    if (hole.length < 3) continue;
    shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, z))));
  }
  let geometry: THREE.ExtrudeGeometry;
  try {
    geometry = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false });
  } catch {
    return;
  }
  // ExtrudeGeometry builds in XY and extrudes along +Z. Standing it up with a
  // +90 degree X rotation sends the shape's Y to the scene's Z unchanged and
  // the extrusion downward, so the placement anchors at the top.
  // A -90 degree rotation sends it to -Z instead, which mirrors every surface.
  const matrix = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  matrix.setPosition(0, top, 0);
  pushGeometry(geometry, matrix);
  geometry.dispose();
}

const [scenePath, outputPath] = process.argv.slice(2);
if (!scenePath || !outputPath) {
  console.error("usage: pascal-scene-glb.ts <model.pascal.json> <out.glb>");
  process.exit(2);
}

const scene = JSON.parse(readFileSync(scenePath, "utf8")) as {
  nodes: Record<string, PascalNode>;
};
const nodes = scene.nodes;

const numberField = (node: PascalNode, field: string, fallback: number): number => {
  const value = node[field];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};
const pairField = (node: PascalNode, field: string): [number, number] => {
  const value = node[field];
  return Array.isArray(value) && value.length >= 2
    ? [Number(value[0]), Number(value[1])]
    : [0, 0];
};
const tripleField = (node: PascalNode, field: string): [number, number, number] => {
  const value = node[field];
  return Array.isArray(value) && value.length >= 3
    ? [Number(value[0]), Number(value[1]), Number(value[2])]
    : [0, 0, 0];
};
const ringsField = (node: PascalNode, field: string): [number, number][][] => {
  const value = node[field];
  if (!Array.isArray(value)) return [];
  return value as [number, number][][];
};

// Pascal's own storey stacking: ordinal order, running total, plus baseElevation.
const levelBaseY = new Map<string, number>();
{
  let running = 0;
  const levels = Object.values(nodes)
    .filter((node) => node.type === "level")
    .sort((a, b) => numberField(a, "level", 0) - numberField(b, "level", 0));
  for (const level of levels) {
    const baseY = running + numberField(level, "baseElevation", 0);
    levelBaseY.set(level.id, baseY);
    running = baseY + numberField(level, "height", 0);
  }
}
const baseYOf = (node: PascalNode): number =>
  (node.parentId ? levelBaseY.get(node.parentId) : undefined) ?? 0;

let walls = 0;
let slabs = 0;
let columns = 0;
let stairs = 0;
let blocks = 0;

for (const node of Object.values(nodes)) {
  // Curtain panels are walls, but they are the part of the export worth
  // measuring separately, so they get their own bucket by node id.
  selectGroup(node.id.startsWith("wall_panel_") ? "curtain-panel" : node.type);
  switch (node.type) {
    case "wall": {
      const [x0, z0] = pairField(node, "start");
      const [x1, z1] = pairField(node, "end");
      const length = Math.hypot(x1 - x0, z1 - z0);
      if (length < 1e-6) break;
      const base = baseYOf(node) + numberField(node, "supportOffset", 0);
      const height = numberField(node, "height", 2.5);
      box(
        length,
        height,
        numberField(node, "thickness", 0.2),
        [(x0 + x1) / 2, base + height / 2, (z0 + z1) / 2],
        Math.atan2(-(z1 - z0), x1 - x0),
      );
      walls += 1;
      break;
    }
    case "slab":
    case "ceiling": {
      const base = baseYOf(node);
      const top = node.type === "slab"
        ? base + numberField(node, "elevation", 0)
        : base + numberField(node, "height", 2.4);
      const thickness = node.type === "slab" ? numberField(node, "thickness", 0.05) : 0.02;
      const outline = ringsField(node, "polygon") as unknown as [number, number][];
      prism(outline, ringsField(node, "holes"), top - thickness, top);
      slabs += 1;
      break;
    }
    case "column": {
      const [x, y, z] = tripleField(node, "position");
      const base = baseYOf(node) + y;
      const height = numberField(node, "height", 2.5);
      box(
        numberField(node, "width", 0.44),
        height,
        numberField(node, "depth", 0.44),
        [x, base + height / 2, z],
        numberField(node, "rotation", 0),
      );
      columns += 1;
      break;
    }
    case "stair": {
      const [x, y, z] = tripleField(node, "position");
      const base = baseYOf(node) + y;
      const segment = Object.values(nodes).find(
        (candidate) => candidate.type === "stair-segment" && candidate.parentId === node.id,
      );
      const length = segment ? numberField(segment, "length", 3) : 3;
      const rise = numberField(node, "totalRise", segment ? numberField(segment, "height", 2.5) : 2.5);
      const width = numberField(node, "width", 1);
      const steps = Math.max(1, Math.round(numberField(node, "stepCount", 10)));
      // The flight runs along the group's local +Z and rises with it.
      const rotation = numberField(node, "rotation", 0);
      const forward: [number, number] = [Math.sin(rotation), Math.cos(rotation)];
      for (let step = 0; step < steps; step += 1) {
        const along = ((step + 0.5) / steps) * length;
        const treadTop = base + ((step + 1) / steps) * rise;
        box(
          width,
          Math.max(rise / steps, 0.02),
          length / steps,
          [
            x + forward[0] * along,
            treadTop - rise / steps / 2,
            z + forward[1] * along,
          ],
          rotation,
        );
      }
      stairs += 1;
      break;
    }
    case "block": {
      const [x, y, z] = tripleField(node, "position");
      const base = baseYOf(node) + y;
      const vertices = (node.topology as { vertices?: { position: [number, number, number] }[] } | undefined)
        ?.vertices;
      if (!vertices?.length) break;
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (const vertex of vertices) {
        minX = Math.min(minX, vertex.position[0]);
        maxX = Math.max(maxX, vertex.position[0]);
        minY = Math.min(minY, vertex.position[1]);
        maxY = Math.max(maxY, vertex.position[1]);
        minZ = Math.min(minZ, vertex.position[2]);
        maxZ = Math.max(maxZ, vertex.position[2]);
      }
      box(
        Math.max(maxX - minX, 0.01),
        Math.max(maxY - minY, 0.01),
        Math.max(maxZ - minZ, 0.01),
        [x + (minX + maxX) / 2, base + (minY + maxY) / 2, z + (minZ + maxZ) / 2],
        numberField(node, "rotation", 0),
      );
      blocks += 1;
      break;
    }
    default:
      break;
  }
}

const accessors: Record<string, unknown>[] = [];
const bufferViews: Record<string, unknown>[] = [];
const meshes: Record<string, unknown>[] = [];
const sceneNodes: number[] = [];
const gltfNodes: Record<string, unknown>[] = [];
const chunks: Buffer[] = [];
let offset = 0;
const overallMin = [Infinity, Infinity, Infinity];
const overallMax = [-Infinity, -Infinity, -Infinity];
let totalTriangles = 0;

for (const [name, group] of groups) {
  if (group.indices.length === 0) continue;
  const positionArray = new Float32Array(group.positions);
  const indexArray = new Uint32Array(group.indices);
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positionArray.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis]!, positionArray[i + axis]!);
      maximum[axis] = Math.max(maximum[axis]!, positionArray[i + axis]!);
      overallMin[axis] = Math.min(overallMin[axis]!, positionArray[i + axis]!);
      overallMax[axis] = Math.max(overallMax[axis]!, positionArray[i + axis]!);
    }
  }
  const positionView = bufferViews.length;
  bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: positionArray.byteLength,
    target: 34962,
  });
  chunks.push(Buffer.from(positionArray.buffer, positionArray.byteOffset, positionArray.byteLength));
  offset += positionArray.byteLength;
  const indexView = bufferViews.length;
  bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: indexArray.byteLength,
    target: 34963,
  });
  chunks.push(Buffer.from(indexArray.buffer, indexArray.byteOffset, indexArray.byteLength));
  offset += indexArray.byteLength;

  const positionAccessor = accessors.length;
  accessors.push({
    bufferView: positionView,
    componentType: 5126,
    count: positionArray.length / 3,
    type: "VEC3",
    min: minimum,
    max: maximum,
  });
  const indexAccessor = accessors.length;
  accessors.push({
    bufferView: indexView,
    componentType: 5125,
    count: indexArray.length,
    type: "SCALAR",
  });
  gltfNodes.push({ mesh: meshes.length, name });
  sceneNodes.push(gltfNodes.length - 1);
  meshes.push({
    name,
    primitives: [{ attributes: { POSITION: positionAccessor }, indices: indexAccessor, material: 0 }],
  });
  totalTriangles += indexArray.length / 3;
}

const minimum = overallMin;
const maximum = overallMax;
const gltf = {
  asset: { version: "2.0", generator: "reviter pascal-scene verification" },
  scene: 0,
  scenes: [{ nodes: sceneNodes }],
  nodes: gltfNodes,
  meshes,
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1] } }],
  accessors,
  bufferViews,
  buffers: [{ byteLength: offset }],
};

const jsonText = JSON.stringify(gltf);
const jsonPadding = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
const jsonChunk = Buffer.concat([
  Buffer.from(jsonText, "utf8"),
  Buffer.alloc(jsonPadding, 0x20),
]);
const binaryChunk = Buffer.concat(chunks);
const header = Buffer.alloc(12);
header.write("glTF", 0, "ascii");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binaryChunk.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.write("JSON", 4, "ascii");
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(binaryChunk.length, 0);
binaryHeader.write("BIN\0", 4, "ascii");
writeFileSync(outputPath, Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]));

console.log(
  `${walls} walls, ${slabs} surfaces, ${columns} columns, ${stairs} stairs, ${blocks} blocks → ` +
    `${totalTriangles.toLocaleString()} triangles in ${meshes.length} meshes`,
);
console.log(`bounds min ${minimum.map((value) => value.toFixed(2)).join(", ")}`);
console.log(`bounds max ${maximum.map((value) => value.toFixed(2)).join(", ")}`);
