import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import * as THREE from "three";

type AuditNode = {
  id: string;
  type: string;
  parentId: string;
  visible: boolean;
  children: string[];
  supportSlabId?: string;
  rotation?: number;
  position: [number, number, number];
  metadata?: { geometry?: string; sourceGlbMesh?: number; sourceMesh?: number };
};

const [editor, scenePath, glbPath, reportPath] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
];
const load = (path: string) => import(pathToFileURL(join(editor, path)).href);
const { validateBuildJson } = await load("packages/core/src/validation/validate-build-json.ts");
const { getLevelElevations } = await load("packages/core/src/services/storey.ts");
const { buildBlockGeometry } = await load("packages/nodes/src/block/geometry.ts");
const sceneBytes = readFileSync(scenePath);
let input = JSON.parse((sceneBytes[0] === 0x1f && sceneBytes[1] === 0x8b ? gunzipSync(sceneBytes) : sceneBytes).toString("utf8"));
const validation = validateBuildJson(input);
if (!validation.ok || validation.schemaIssueCount)
  throw new Error(
    `Pascal validation failed: ${JSON.stringify(validation.errors)} ${JSON.stringify(validation.schemaIssues.slice(0, 5))}`,
  );
// Exercise Pascal's actual load path as well as its schema. It normalizes roots,
// migrates nodes, and removes orphans; none of those may silently lose this scene.
const { default: useScene } = await load("packages/core/src/store/use-scene.ts");
useScene
  .getState()
  .setScene(validation.parsed.nodes, validation.parsed.rootNodeIds, {
    materials: validation.parsed.materials,
  });
const loaded = useScene.getState();
if (
  Object.keys(loaded.nodes).length !== Object.keys(input.nodes).length ||
  JSON.stringify(loaded.rootNodeIds) !== JSON.stringify(input.rootNodeIds)
)
  throw new Error("Pascal scene loading discarded nodes or roots");
input = { nodes: loaded.nodes, rootNodeIds: loaded.rootNodeIds, materials: loaded.materials };
if (input.rootNodeIds.length !== 1) throw new Error("Audit requires one building root");
const root = input.nodes[input.rootNodeIds[0]];
if (
  root.type !== "building" ||
  root.parentId !== null ||
  [...root.position, ...root.rotation].some((n: number) => n !== 0)
)
  throw new Error("Audit requires an untransformed building root");
for (const node of Object.values(input.nodes) as AuditNode[]) {
  if (!node.visible || !["building", "level", "block"].includes(node.type))
    throw new Error(
      "Audit does not permit hidden nodes or additional geometry such as a site ground",
    );
  if (node.type === "level" && node.parentId !== root.id)
    throw new Error("Unexpected level parent");
  if (
    node.type === "block" &&
    (input.nodes[node.parentId]?.type !== "level" ||
      node.supportSlabId !== "ground" ||
      node.children.length)
  )
    throw new Error("Unexpected block placement or children");
}
const levels = getLevelElevations(input.nodes);
const bytes = readFileSync(glbPath),
  jsonLength = bytes.readUInt32LE(12);
const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binary = bytes.subarray(28 + jsonLength);
const accessor = (index: number) => {
  const a = doc.accessors[index],
    b = doc.bufferViews[a.bufferView];
  const components = a.type === "VEC3" ? 3 : 1,
    width = a.componentType === 5123 ? 2 : a.componentType === 5121 ? 1 : 4;
  if (a.sparse || b.buffer > 0 || ![5121, 5123, 5125, 5126].includes(a.componentType))
    throw new Error("Unsupported source GLB accessor");
  const start = (b.byteOffset ?? 0) + (a.byteOffset ?? 0),
    stride = b.byteStride ?? width * components;
  return {
    count: a.count,
    value(i: number, c = 0) {
      const p = start + i * stride + c * width;
      return a.componentType === 5126
        ? binary.readFloatLE(p)
        : width === 2
          ? binary.readUInt16LE(p)
          : width === 1
            ? binary.readUInt8(p)
            : binary.readUInt32LE(p);
    },
  };
};
const meshes = new Map<
  number,
  {
    positions: ReturnType<typeof accessor>;
    indices: ReturnType<typeof accessor>;
    normals: ReturnType<typeof accessor>;
    matrix: THREE.Matrix4;
    seen: Set<number>;
  }
>();
const visit = (index: number, parent: THREE.Matrix4) => {
  const n = doc.nodes[index];
  const local = n.matrix
    ? new THREE.Matrix4().fromArray(n.matrix)
    : new THREE.Matrix4().compose(
        new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
      );
  const world = parent.clone().multiply(local);
  if (n.mesh != null) {
    const p = doc.meshes[n.mesh].primitives;
    if (
      p.length !== 1 ||
      (p[0].mode && p[0].mode !== 4) ||
      p[0].indices == null ||
      meshes.has(n.mesh)
    )
      throw new Error("Source must be a Reviter triangle GLB");
    meshes.set(n.mesh, {
      positions: accessor(p[0].attributes.POSITION),
      indices: accessor(p[0].indices),
      normals: accessor(p[0].attributes.NORMAL),
      matrix: world,
      seen: new Set(),
    });
  }
  for (const child of n.children ?? []) visit(child, world);
};
for (const root of doc.scenes[doc.scene ?? 0].nodes) visit(root, new THREE.Matrix4());
let rendered = 0,
  matched = 0,
  maxError = 0,
  missingRenderedFaces = 0;
let comparedNormals = 0, differingNormals = 0, maxNormalAngleDegrees = 0, generatedBackTriangles = 0, invalidBackTriangles = 0;
const failures: unknown[] = [];
const toleranceMetres = 0.00001;
for (const node of Object.values(input.nodes) as AuditNode[]) {
  if (node.type !== "block") continue;
  if (node.metadata?.geometry !== "drawn-triangles")
    throw new Error("This audit requires --pascal-geometry drawn");
  const source = meshes.get(node.metadata.sourceGlbMesh ?? node.metadata.sourceMesh ?? -1);
  if (!source) throw new Error(`Missing source mesh for ${node.id}`);
  const group = buildBlockGeometry(node, { materials: input.materials }, "rendered", true);
  const placement = new THREE.Matrix4()
    .makeRotationY(node.rotation ?? 0)
    .setPosition(
      node.position[0],
      node.position[1] + (levels.get(node.parentId)?.baseY ?? 0),
      node.position[2],
    );
  group.updateMatrixWorld(true);
  group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.userData.blockFaces) return;
    const position = mesh.geometry.getAttribute("position");
    const normal = mesh.geometry.getAttribute("normal");
    const actualNormalMatrix = new THREE.Matrix3().getNormalMatrix(placement.clone().multiply(mesh.matrixWorld));
    const sourceNormalMatrix = new THREE.Matrix3().getNormalMatrix(source.matrix);
    for (const face of mesh.geometry.userData.blockFaces) {
      const t = Number(face.faceId.slice(1));
      if (!Number.isSafeInteger(t) || t < 0 || t * 3 + 2 >= source.indices.count)
        throw new Error("Invalid source face identity");
      if ((face.frontCount ?? face.count) !== 3) {
        missingRenderedFaces++;
        if (failures.length < 30)
          failures.push({ nodeId: node.id, face: face.faceId, renderedVertices: face.count });
        continue;
      }
      if (source.seen.has(t)) throw new Error("Duplicate exported source triangle");
      source.seen.add(t);
      rendered++;
      const expected = [0, 1, 2].map((c) => {
        const i = source.indices.value(t * 3 + c);
        return new THREE.Vector3(
          source.positions.value(i, 0),
          source.positions.value(i, 1),
          source.positions.value(i, 2),
        )
          .applyMatrix4(source.matrix)
          .multiplyScalar(0.3048);
      });
      const actual = [0, 1, 2].map((c) =>
        new THREE.Vector3(
          position.getX(face.start + c),
          position.getY(face.start + c),
          position.getZ(face.start + c),
        )
          .applyMatrix4(mesh.matrixWorld)
          .applyMatrix4(placement),
      );
      const error = Math.min(
        ...[0, 1, 2].map((shift) =>
          Math.max(...actual.map((p, c) => p.distanceTo(expected[(c + shift) % 3]!))),
        ),
      );
      const shift = [0, 1, 2].reduce((best, shift) =>
        Math.max(...actual.map((p, c) => p.distanceTo(expected[(c + shift) % 3]!))) <
        Math.max(...actual.map((p, c) => p.distanceTo(expected[(c + best) % 3]!))) ? shift : best, 0);
      for (let c = 0; c < 3; c++) {
        const i = source.indices.value(t * 3 + (c + shift) % 3);
        const expectedNormal = new THREE.Vector3(source.normals.value(i,0),source.normals.value(i,1),source.normals.value(i,2)).applyMatrix3(sourceNormalMatrix);
        const actualNormal = new THREE.Vector3().fromBufferAttribute(normal,face.start+c).applyMatrix3(actualNormalMatrix);
        if (expectedNormal.lengthSq() < 1e-12 && actualNormal.lengthSq() < 1e-12) continue;
        const angle = expectedNormal.lengthSq() < 1e-12 || actualNormal.lengthSq() < 1e-12 ? 180 : expectedNormal.angleTo(actualNormal)*180/Math.PI;
        comparedNormals++;
        if (angle > 0.01) differingNormals++;
        maxNormalAngleDegrees = Math.max(maxNormalAngleDegrees,angle);
      }
      if (face.frontCount === 3 && face.count === 6) {
        generatedBackTriangles++;
        for (let c=0;c<3;c++) {
          const a=face.start+c,b=face.start+5-c;
          if (new THREE.Vector3().fromBufferAttribute(position,a).distanceTo(new THREE.Vector3().fromBufferAttribute(position,b)) > 1e-8 ||
            new THREE.Vector3().fromBufferAttribute(normal,a).add(new THREE.Vector3().fromBufferAttribute(normal,b)).length() > 1e-6) invalidBackTriangles++;
        }
      }
      maxError = Math.max(maxError, error);
      if (error <= toleranceMetres) matched++;
      else if (failures.length < 30)
        failures.push({ nodeId: node.id, face: face.faceId, errorMetres: error });
    }
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      material.dispose();
  });
}
let total = 0,
  missing = 0,
  degenerate = 0,
  subTolerance = 0,
  maxMissingAltitudeMetres = 0;
for (const source of meshes.values())
  for (let t = 0; t < source.indices.count / 3; t++) {
    total++;
    if (source.seen.has(t)) continue;
    const p = [0, 1, 2].map((c) => {
      const i = source.indices.value(t * 3 + c);
      return new THREE.Vector3(
        source.positions.value(i, 0),
        source.positions.value(i, 1),
        source.positions.value(i, 2),
      );
    });
    const cross = p[1]!.clone().sub(p[0]!).cross(p[2]!.clone().sub(p[0]!)).length();
    if (cross === 0) degenerate++;
    else {
      missing++;
      const longest = Math.max(
        p[0]!.distanceTo(p[1]!),
        p[1]!.distanceTo(p[2]!),
        p[2]!.distanceTo(p[0]!),
      );
      const altitude = (cross / longest) * 0.3048;
      maxMissingAltitudeMetres = Math.max(maxMissingAltitudeMetres, altitude);
      if (altitude <= toleranceMetres) subTolerance++;
      if (altitude > toleranceMetres && failures.length < 30)
        failures.push({
          sourceMesh: [...meshes].find(([, m]) => m === source)?.[0],
          sourceTriangle: t,
          missingAltitudeMetres: altitude,
        });
    }
  }
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const report = {
  schemaVersion: 2,
  sceneLoad: {
    nodesRetained: Object.keys(input.nodes).length,
    rootNodeIds: input.rootNodeIds,
    additionalSiteGround: false,
  },
  editorSource: editor,
  renderer: "packages/nodes/src/block/geometry.ts:buildBlockGeometry",
  inputHashes: {
    scene: hash(scenePath),
    sourceGlb: hash(glbPath),
    renderer: hash(join(editor, "packages/nodes/src/block/geometry.ts")),
  },
  validation: {
    ok: validation.ok,
    schemaIssueCount: validation.schemaIssueCount,
    warnings: validation.warnings,
  },
  toleranceMetres,
  sourceTriangles: total,
  renderedTriangles: rendered,
  matchedTriangles: matched,
  missingNondegenerateTriangles: missing,
  missingAboveToleranceTriangles: missing - subTolerance,
  missingSubToleranceTriangles: subTolerance,
  maxMissingAltitudeMetres,
  omittedDegenerateTriangles: degenerate,
  missingRenderedFaces,
  maxVertexErrorMetres: maxError,
  shading: { comparedNormals, differingNormals, maxNormalAngleDegrees, toleranceDegrees: 0.01, generatedBackTriangles, invalidBackTriangles },
  passes: rendered === matched && missing === subTolerance && missingRenderedFaces === 0 && differingNormals === 0 && invalidBackTriangles === 0,
  exactTriangleCountMatch: rendered === total,
  failures,
  caveat:
    "Geometry and winding checked through the supplied Pascal block renderer, with its actual storey stacking. Triangles narrower than the declared position tolerance are listed separately; zero-area triangles are excluded. Does not assert identical lighting, appearance, or semantic wall/door editability.",
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));

if (!report.passes) process.exitCode = 1;
