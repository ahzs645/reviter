import { vertexNormals } from "./export-glb.ts";
import type { ConvertResult } from "./types.ts";
import type { PascalNode } from "./export-pascal.ts";

const FOOT = 0.3048;
// Small per-element parts remain suitable for unpatched Pascal editors.
const TRIANGLES_PER_BLOCK = 256;
const REVIEW_TRIANGLES_PER_BLOCK = 2048;
export type PascalDrawnGrouping = "element" | "review";
export type PascalSceneMaterial = {
  id: string;
  name: string;
  material: {
    preset: string;
    properties: {
      color: string;
      opacity: number;
      transparent: boolean;
      roughness: number;
      metalness: number;
      side: string;
    };
  };
};

export function drawnPascalBlocks(
  result: ConvertResult,
  mirrorPlan: boolean,
  levelFor: (elementId: number, elevation: number) => { id: string; elevation: number },
  grouping: PascalDrawnGrouping = "element",
): {
  nodes: PascalNode[];
  materials: Record<string, PascalSceneMaterial>;
  triangles: number;
  elementIds: Set<number>;
} {
  const nodes: PascalNode[] = [],
    materials: Record<string, PascalSceneMaterial> = {};
  const elementIds = new Set<number>();
  const records = new Map(result.elementBounds.map((r) => [r.elementId, r]));
  let triangles = 0;
  let sourceGlbMesh = -1;
  const channel = (linear: number) =>
    Math.round(
      255 *
        Math.max(
          0,
          Math.min(1, linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055),
        ),
    )
      .toString(16)
      .padStart(2, "0");
  result.meshes.forEach((mesh, meshIndex) => {
    if (!mesh.positions.length || !mesh.indices.length) return;
    sourceGlbMesh++;
    if (mesh.indices.length % 3) throw new Error("Pascal export: incomplete triangle list");
    if (mesh.elementIds && mesh.elementIds.length * 3 !== mesh.indices.length)
      throw new Error("Pascal export: incomplete triangle ownership");
    const sourceNormals = mesh.normals ?? vertexNormals(mesh.positions, mesh.indices);
    const sourceMaterial = result.materials[mesh.materialIndex];
    const materialId = `mat_reviter_${mesh.materialIndex}`;
    if (sourceMaterial)
      materials[materialId] = {
        id: materialId,
        name: sourceMaterial.name,
        material: {
          preset: "custom",
          properties: {
            color: `#${sourceMaterial.baseColorLinear.slice(0, 3).map(channel).join("")}`,
            opacity: sourceMaterial.baseColorLinear[3],
            transparent: sourceMaterial.baseColorLinear[3] < 1,
            roughness: sourceMaterial.roughness,
            metalness: sourceMaterial.metallic,
            side: sourceMaterial.doubleSided ? "double" : "front",
          },
        },
      };
    const byOwner = new Map<number, number[]>();
    for (let t = 0; t < mesh.indices.length / 3; t++) {
      const id = mesh.elementIds?.[t] ?? 0;
      const list = byOwner.get(id) ?? [];
      list.push(t);
      byOwner.set(id, list);
    }
    type Part = { id: string; elementId: number; triangleIds: number[]; level: ReturnType<typeof levelFor> };
    const parts: Part[] = [];
    const reviewByLevel = new Map<string, Part>();
    for (const [elementId, ownerTriangles] of byOwner) {
      for (let offset = 0; offset < ownerTriangles.length; offset += TRIANGLES_PER_BLOCK) {
        const triangleIds = ownerTriangles.slice(offset, offset + TRIANGLES_PER_BLOCK);
        let bottom = Infinity;
        for (const t of triangleIds) for (let c = 0; c < 3; c++) {
          const index = mesh.indices[t * 3 + c]!;
          if (!Number.isInteger(index) || index < 0 || index * 3 + 2 >= mesh.positions.length)
            throw new Error("Pascal export: triangle index outside positions");
          bottom = Math.min(bottom, mesh.positions[index * 3 + 2]! * FOOT);
        }
        const level = levelFor(elementId, bottom);
        if (grouping === "element") {
          parts.push({ id: `block_e${elementId}_m${meshIndex}_p${offset / TRIANGLES_PER_BLOCK}`, elementId, triangleIds, level });
        } else {
          let batch = reviewByLevel.get(level.id);
          if (!batch || batch.triangleIds.length + triangleIds.length > REVIEW_TRIANGLES_PER_BLOCK) {
            batch = { id: `block_review_m${meshIndex}_p${parts.length}`, elementId: 0, triangleIds: [], level };
            parts.push(batch);
            reviewByLevel.set(level.id, batch);
          }
          batch.triangleIds.push(...triangleIds);
        }
      }
    }
    for (const [partIndex, part] of parts.entries()) {
      const { elementId, level } = part;
      const vertexIndex = new Map<number | string, number>();
      const points: [number, number, number][] = [];
      const pointNormals: [number, number, number][] = [];
      const faces: { id: string; vertexIds: string[]; materialSlot?: string }[] = [];
      // Source indices keep ownership valid when Pascal reorders the editable face array.
      const sourceTriangleRanges: [number, number, number | null][] = [];
      const owners = new Set<number>();
      const vertexId = (index: number) => `v${grouping === "review" ? index.toString(36) : index}`;
      const edges = new Map<string, { id: string; vertexIds: [string, string] }>();
      const lo = [Infinity, Infinity, Infinity],
        hi = [-Infinity, -Infinity, -Infinity];
      for (const t of part.triangleIds) {
        const owner = mesh.elementIds?.[t] ?? 0;
        const faceIndices: number[] = [];
        for (let corner = 0; corner < 3; corner++) {
          const index = mesh.indices[t * 3 + corner]!;
          if (index * 3 + 2 >= mesh.positions.length)
            throw new Error("Pascal export: triangle index outside positions");
          const key = grouping === "review" ? `${owner}:${index}` : index;
          let target = vertexIndex.get(key);
          if (target == null) {
            target = points.length;
            vertexIndex.set(key, target);
            const p: [number, number, number] = [
              mesh.positions[index * 3]! * FOOT,
              mesh.positions[index * 3 + 2]! * FOOT,
              (mirrorPlan ? 1 : -1) * mesh.positions[index * 3 + 1]! * FOOT,
            ];
            if (!p.every(Number.isFinite))
              throw new Error("Pascal export: nonfinite triangle position");
            points.push(p);
            pointNormals.push([sourceNormals[index * 3]!, sourceNormals[index * 3 + 2]!, (mirrorPlan ? 1 : -1) * sourceNormals[index * 3 + 1]!]);
            p.forEach((value, axis) => {
              lo[axis] = Math.min(lo[axis]!, value);
              hi[axis] = Math.max(hi[axis]!, value);
            });
          }
          faceIndices.push(target);
        }
        if (mirrorPlan) faceIndices.reverse();
        const vertexIds = faceIndices.map(vertexId);
        if (new Set(vertexIds).size < 3) continue;
        // Pascal's schema fills the default body slot; omitting it saves one field per triangle.
        faces.push({ id: `f${t}`, vertexIds, ...(grouping === "element" ? { materialSlot: "body" } : {}) });
        const previous = sourceTriangleRanges[sourceTriangleRanges.length - 1];
        if (previous && previous[2] === (owner || null) && previous[0] + previous[1] === t) previous[1]++;
        else sourceTriangleRanges.push([t, 1, owner || null]);
        if (owner) { owners.add(owner); elementIds.add(owner); }
        for (let c = 0; c < 3; c++) {
          const a = faceIndices[c]!,
            b = faceIndices[(c + 1) % 3]!;
          const key = a < b ? `${a}_${b}` : `${b}_${a}`;
          if (!edges.has(key)) edges.set(key, { id: grouping === "review" ? `e${edges.size.toString(36)}` : `e${key}`, vertexIds: [vertexId(a), vertexId(b)] });
        }
      }
      if (!faces.length) continue;
      const centre = lo.map((v, a) => (v + hi[a]!) / 2);
      const record = records.get(elementId);
      nodes.push({
        object: "node",
        id: part.id,
        type: "block",
        name: grouping === "review" ? `${mesh.name} · review ${partIndex + 1}` : record?.typeName ?? record?.categoryName ?? mesh.name,
        parentId: level.id,
        visible: true,
        children: [],
        rotation: 0,
        position: [centre[0], centre[1]! - level.elevation, centre[2]],
        supportSlabId: "ground",
        topology: {
          vertices: points.map((p, i) => ({
            id: vertexId(i),
            position: p.map((v, a) => v - centre[a]!),
            normal: pointNormals[i],
          })),
          edges: [...edges.values()],
          faces,
        },
        slots: sourceMaterial ? { body: `scene:${materialId}` } : {},
        slotNames: { body: "Body" },
        metadata: {
          source: "reviter",
          ...(grouping === "review" ? {
            grouping: "level-and-source-material",
            revitElementIds: [...owners],
            sourceTriangleRanges,
          } : {
            revitElementId: elementId || null,
            revitCategoryId: record?.categoryId ?? null,
            revitCategory: record?.categoryName ?? null,
          }),
          geometry: "drawn-triangles",
          meshSource: mesh.source ?? null,
          sourceMesh: meshIndex,
          sourceGlbMesh,
          triangleCount: faces.length,
        },
      });
      triangles += faces.length;
    }
  });
  return { nodes, materials, triangles, elementIds };
}
