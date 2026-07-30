export type AutodeskReferenceGlbPaletteEntry = {
  materialIndex: number;
  rgbaBytes: readonly [number, number, number, number];
  baseColorFactor: readonly [number, number, number, number];
  metallicFactor: number;
  roughnessFactor: number;
  alphaMode: "OPAQUE" | "BLEND";
};

/**
 * Material palette captured from public/autodesk-reference.glb.
 *
 * Keep the original PBR factors for rendering and byte colors for matching
 * decoded RVT material records while the recovery proof of concept evolves.
 */
export const AUTODESK_REFERENCE_GLB_PALETTE = [
  {
    materialIndex: 0,
    rgbaBytes: [192, 192, 192, 255],
    baseColorFactor: [0.752941, 0.752941, 0.752941, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 1,
    rgbaBytes: [127, 127, 127, 255],
    baseColorFactor: [0.498039, 0.498039, 0.498039, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 2,
    rgbaBytes: [216, 215, 207, 255],
    baseColorFactor: [0.847059, 0.843137, 0.811765, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 3,
    rgbaBytes: [235, 235, 235, 255],
    baseColorFactor: [0.921569, 0.921569, 0.921569, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 4,
    rgbaBytes: [191, 191, 191, 255],
    baseColorFactor: [0.74902, 0.74902, 0.74902, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 5,
    rgbaBytes: [178, 178, 178, 255],
    baseColorFactor: [0.698039, 0.698039, 0.698039, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 6,
    rgbaBytes: [162, 153, 144, 255],
    baseColorFactor: [0.635294, 0.6, 0.564706, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 7,
    rgbaBytes: [224, 178, 126, 255],
    baseColorFactor: [0.878431, 0.698039, 0.494118, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 8,
    rgbaBytes: [193, 160, 115, 255],
    baseColorFactor: [0.756863, 0.627451, 0.45098, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 9,
    rgbaBytes: [0, 255, 0, 255],
    baseColorFactor: [0, 1, 0, 1],
    metallicFactor: 0,
    roughnessFactor: 2 / 3,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 10,
    rgbaBytes: [210, 159, 95, 255],
    baseColorFactor: [0.823529, 0.623529, 0.372549, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 11,
    rgbaBytes: [247, 247, 247, 255],
    baseColorFactor: [0.968627, 0.968627, 0.968627, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 12,
    rgbaBytes: [112, 113, 115, 255],
    baseColorFactor: [0.439216, 0.443137, 0.45098, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 13,
    rgbaBytes: [247, 246, 246, 255],
    baseColorFactor: [0.968627, 0.964706, 0.964706, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 14,
    rgbaBytes: [0, 0, 0, 255],
    baseColorFactor: [0, 0, 0, 1],
    metallicFactor: 0,
    roughnessFactor: 2 / 3,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 15,
    rgbaBytes: [118, 70, 51, 255],
    baseColorFactor: [0.462745, 0.27451, 0.2, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 16,
    rgbaBytes: [210, 210, 210, 255],
    baseColorFactor: [0.823529, 0.823529, 0.823529, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 17,
    rgbaBytes: [40, 40, 40, 255],
    baseColorFactor: [0.156863, 0.156863, 0.156863, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 18,
    rgbaBytes: [120, 120, 120, 255],
    baseColorFactor: [0.470588, 0.470588, 0.470588, 1],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "OPAQUE",
  },
  {
    materialIndex: 19,
    rgbaBytes: [0, 128, 192, 26],
    baseColorFactor: [0, 0.501961, 0.752941, 0.10196099999999997],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "BLEND",
  },
  {
    materialIndex: 20,
    rgbaBytes: [0, 0, 255, 64],
    baseColorFactor: [0, 0, 1, 0.25098],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "BLEND",
  },
  {
    materialIndex: 21,
    rgbaBytes: [92, 99, 177, 77],
    baseColorFactor: [0.360784, 0.388235, 0.694118, 0.30196100000000003],
    metallicFactor: 0,
    roughnessFactor: 0.2,
    alphaMode: "BLEND",
  },
] as const satisfies readonly AutodeskReferenceGlbPaletteEntry[];
