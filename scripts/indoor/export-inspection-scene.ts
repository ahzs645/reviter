/** Export the complete original recovered scene for inspection, not routing. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deserialize } from "node:v8";
import { createHash } from "node:crypto";
import { makeGlb } from "../../lib/reviter/export-glb.ts";
import { sourceInspectionScene } from "../../lib/reviter/source-inspection-scene.ts";
const [recipeFile, output] = process.argv.slice(2);
if (!recipeFile || !output)
  throw Error("Usage: export-inspection-scene.ts RECIPE.json NEW-OUTPUT-DIRECTORY");
const recipe = JSON.parse(readFileSync(recipeFile, "utf8"));
const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const root = dirname(resolve(recipeFile));
const sourcePath = resolve(root, recipe.sourceModelPath), cachePath = resolve(root, recipe.modelCachePath);
const rawModel = readFileSync(sourcePath), rawCache = readFileSync(cachePath);
if (sha(rawModel) !== recipe.sourceModelSha256 || sha(rawCache) !== recipe.modelCacheSha256)
  throw Error("Original model/cache bytes do not match the inspection recipe");
const restored = sourceInspectionScene(deserialize(rawCache));
if (recipe.expectedVertices !== undefined && recipe.expectedVertices !== restored.vertices ||
    recipe.expectedTriangles !== undefined && recipe.expectedTriangles !== restored.triangles)
  throw Error("Recovered scene counts differ from the bound recipe");
const glb = new Uint8Array(makeGlb(restored.model));
const config = recipe.render;
if (!config || config.version !== 1 || !Array.isArray(config.views) || !config.views.length)
  throw Error("A versioned inspection camera recipe is required");
mkdirSync(output, { recursive: false });
writeFileSync(resolve(output, "source-scene.glb"), glb, { flag: "wx" });
writeFileSync(resolve(output, "render.json"), JSON.stringify(config, null, 2));
const receipt = { format: "source-scene-inspection-v1", sourceModelSha256: sha(rawModel),
  modelCacheSha256: sha(rawCache), sourceSceneSha256: sha(glb), bytes: glb.length,
  vertices: restored.vertices, triangles: restored.triangles, nonemptyMeshes: restored.nonemptyMeshes,
  originFeet: restored.model.origin, losslessMeshArrayRepackingVerified: true,
  completeSceneExported: true, sourceGeometryOrMaterialsModified: false,
  sourceUnits: "feet", cameraCoordinates: "original Revit model feet; subtract origin before rendering",
  renderConfigSha256: sha(readFileSync(resolve(output, "render.json"))),
  exporterSourceSha256: sha(readFileSync(new URL(import.meta.url))),
  sourceUnchanged: sha(readFileSync(sourcePath)) === sha(rawModel) && sha(readFileSync(cachePath)) === sha(rawCache),
  routeOrClearanceAuthorityGranted: false };
if (!receipt.sourceUnchanged) throw Error("Source bytes changed during scene export");
writeFileSync(resolve(output, "scene-export.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ output, vertices: restored.vertices, triangles: restored.triangles, sha256: receipt.sourceSceneSha256 }));
