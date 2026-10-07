/** Reproduce CAD room/stair analysis through Reviter without changing the native master. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, rename, access, copyFile, cp } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCadFloors, type CadAnalysisFloor, type CadFloorControl } from "../lib/reviter/dwg-floor-analysis.ts";
import { cadFloorAnalysisPreview } from "../lib/reviter/dwg-floor-analysis-view.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
async function run(command: string, args: string[]) {
  await new Promise<void>((done, fail) => {
    const process = spawn(command, args, { stdio: "inherit", cwd: root });
    process.on("error", fail);
    process.on("close", code => code === 0 ? done() : fail(new Error(`CAD extraction exited with code ${code}.`)));
  });
}
async function main() {
  const args = process.argv.slice(2), options = new Map<string, string>();
  if (args.includes("--help")) {
    console.log("npm run cad:analyze -- --intake /absolute/cad-package --out /new/analysis-folder [--review /dxf-folder] [--python /venv/bin/python] [--controls /floor-controls.json]\nThe intake folder needs intake.json, preserved source/ DWGs and bound stage/floorplans.dxf. Review defaults to intake. Output must be new. No native geometry or routes are applied.");
    return;
  }
  for (let i = 0; i < args.length; i += 2) {
    if (!["--intake", "--out", "--review", "--python", "--controls"].includes(args[i]!) || !args[i + 1] || args[i + 1]!.startsWith("--") || options.has(args[i]!)) throw new Error("Unknown, duplicate or incomplete option. Use --help.");
    options.set(args[i]!, args[i + 1]!);
  }
  if (!options.has("--intake") || !options.has("--out")) throw new Error("--intake and --out are required.");
  const intakePath = resolve(options.get("--intake")!), reviewPath = resolve(options.get("--review") ?? intakePath);
  const output = resolve(options.get("--out")!), python = options.get("--python") ?? "python3";
  try { await access(output); throw new Error("Output already exists; choose a separate candidate folder."); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const intakeBytes = await readFile(resolve(intakePath, "intake.json")), intake = JSON.parse(intakeBytes.toString());
  if (intake.format !== "openindoormaps-cad-intake" || intake.version !== 1) throw new Error("Unsupported CAD intake format.");
  if (!Number.isFinite(intake.unitEvidence?.metresPerDrawingUnit) || intake.unitEvidence.metresPerDrawingUnit <= 0) throw new Error("Drawing units need bound evidence.");
  const boundFiles: { path: string; sha256: string }[] = [{ path: resolve(intakePath, "intake.json"), sha256: hash(intakeBytes) }];
  for (const file of intake.sourceFiles) {
    if (basename(file.name) !== file.name || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid source file identity.");
    boundFiles.push({ path: resolve(intakePath, "source", file.name), sha256: file.sha256 });
  }
  boundFiles.push({ path: resolve(reviewPath, "stage/floorplans.dxf"), sha256: intake.conversionEvidence.floorDxfSha256 });
  const checkBindings = async () => { for (const file of boundFiles) if (hash(await readFile(file.path)) !== file.sha256) throw new Error(`Source binding changed: ${file.path}`); };
  await checkBindings();
  const controlsBytes = options.has("--controls") ? await readFile(resolve(options.get("--controls")!)) : null;
  const controls = controlsBytes ? JSON.parse(controlsBytes.toString()) : null;
  if (controls && (controls.format !== "reviter-cad-floor-controls" || controls.version !== 1
    || controls.sourceSha256 !== intake.sourceSha256 || controls.intakeSha256 !== hash(intakeBytes)
    || !Array.isArray(controls.floors))) throw new Error("Controls do not match this exact source intake.");
  await mkdir(dirname(output), { recursive: true });
  const candidate = await mkdtemp(resolve(dirname(output), ".reviter-cad-candidate-"));
  // Leave a failed candidate recoverable; never replace the user's current preview.
  console.log(`Building separate CAD candidate: ${candidate}`);
  await run(python, [resolve(root, "tools/dwg-analysis/abstract-building-geometry.py"), "--intake", intakePath,
    "--review", reviewPath, "--reviter", root, "--out", candidate]);
  const geometryPath = resolve(candidate, "geometry.json"), geometryBytes = await readFile(geometryPath), geometry = JSON.parse(geometryBytes.toString());
  if (geometry.graphEdges.length || geometry.appliedToNativeGeometry || geometry.sourceSha256 !== intake.sourceSha256) throw new Error("CAD output violated drawing-only contract.");
  const ordinal = new Map<string, number>(intake.buildings.flatMap((b: { floors: { id: string; ordinal: number }[] }) => b.floors.map(f => [f.id, f.ordinal])));
  const floors: CadAnalysisFloor[] = geometry.floors.map((f: CadAnalysisFloor) => ({ ...f, ordinal: ordinal.get(f.id) }));
  const analysis = { ...analyzeCadFloors(floors, (controls?.floors ?? []) as CadFloorControl[]),
    sourceSha256: intake.sourceSha256, intakeSha256: hash(intakeBytes), geometrySha256: hash(geometryBytes),
    controlsSha256: controlsBytes ? hash(controlsBytes) : null,
    implementation: { analyzerSha256: hash(await readFile(resolve(root, "lib/reviter/dwg-floor-analysis.ts"))),
      previewSha256: hash(await readFile(resolve(root, "lib/reviter/dwg-floor-analysis-view.ts"))),
      cliSha256: hash(await readFile(fileURLToPath(import.meta.url))) } };
  const save = async (name: string, data: unknown) => writeFile(resolve(candidate, name), JSON.stringify(data, null, 2) + "\n");
  await save("floor-analysis.json", analysis);
  if (intake.coverageAudit) await save("coverage-audit.json", { ...intake.coverageAudit,
    pendingPanels: intake.pendingPanels, buildings: analysis.floors.reduce((result: Record<string, unknown[]>, f) => {
      (result[f.buildingCode] ??= []).push(f); return result;
    }, {}) });
  await save("floor-controls.template.json", { format: "reviter-cad-floor-controls", version: 1,
    sourceSha256: intake.sourceSha256, intakeSha256: hash(intakeBytes),
    guidance: "Add at least three distributed original source-stroke control pairs per floor. Coordinates are in geometry.json's existing building-local metres, not raw sheet units. Reference the lowest ordinal drawing directly. Empty pairs intentionally fail validation. These controls do not approve a physical stair route.",
    floors: floors.filter(f => f.ordinal !== Math.min(...floors.filter(v => v.buildingCode === f.buildingCode).map(v => v.ordinal))).map(f => ({ floorId: f.id,
      referenceFloorId: floors.filter(v => v.buildingCode === f.buildingCode).sort((a, b) => a.ordinal - b.ordinal)[0]!.id, pairs: [] })) });
  try { await copyFile(resolve(intakePath, "source-review.json"), resolve(candidate, "source-review.json")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  try { await cp(resolve(intakePath, "plans"), resolve(candidate, "plans"), { recursive: true }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  if (controlsBytes) await writeFile(resolve(candidate, "floor-controls.reviewed.json"), controlsBytes);
  const viewer = resolve(candidate, "index.html");
  await writeFile(viewer, cadFloorAnalysisPreview(await readFile(viewer, "utf8"), analysis).replace('<a href="intake.json" download>', '<a href="floor-analysis.json" download>Reviter floor correspondence analysis</a><br><a href="floor-controls.template.json" download>Floor control template</a><br><a href="intake.json" download>'));
  await writeFile(resolve(candidate, "REVITER-ANALYSIS.txt"), "Reviter drawing-only CAD analysis.\nRun npm run cad:analyze -- --help in the Reviter repository.\nRoom and stair recovery reuses the OpenIndoorMaps CAD analysis helpers and Reviter's current guarded single-door recognizer.\nFloor control fitting reuses Reviter floor-reference-overlay.ts, with dimension-preserving rigid transforms and source contact checks.\nSee floor-analysis.json for unique adjacent-floor correspondences, orientation review and missing/ambiguous matches.\nControl fits and drawing correspondences never create native stops, elevations, campus placement or navigation edges.\n");
  // Preserve the exact analysis implementation beside the original source files.
  const snapshot = resolve(candidate, "pipeline/reviter");
  for (const file of ["scripts/analyze-dwg-floors.ts", "lib/reviter/dwg-floor-analysis.ts", "lib/reviter/dwg-floor-analysis-view.ts", "lib/reviter/dwg-door-display.ts", "lib/reviter/dwg-path-regions.ts", "lib/reviter/dwg-stair-assumptions.ts", "lib/reviter/dwg-drawing-paths.ts", "lib/reviter/dwg-floor-surfaces.ts",
    "lib/reviter/floor-reference-overlay.ts", "docs/dwg-floor-analysis.md"]) {
    await mkdir(dirname(resolve(snapshot, file)), { recursive: true });
    await copyFile(resolve(root, file), resolve(snapshot, file));
  }
  for (const file of ["abstract-building-geometry.py", "abstract-door-symbols.mjs", "emit-door-display.mjs", "cad-door-symbols.py", "stair-footprints.py",
    "build-building-intake.py", "build-campus-floor-intake.py", "recover-room-polygons.py", "stair-symbols.py", "schematic-glb.py", "building-geometry.html", "config.unbc.json", "requirements.txt"]) {
    await mkdir(resolve(snapshot, "tools/dwg-analysis"), { recursive: true });
    await copyFile(resolve(root, "tools/dwg-analysis", file), resolve(snapshot, "tools/dwg-analysis", file));
  }
  await writeFile(resolve(snapshot, "package.json"), JSON.stringify({ private: true, type: "module", engines: { node: ">=22.13.0" },
    scripts: { "cad:analyze": "node --experimental-strip-types scripts/analyze-dwg-floors.ts" }, dependencies: { "polygon-clipping": "0.15.7" } }, null, 2) + "\n");
  await checkBindings();
  await run(python, ["-c", "import importlib.util,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('cad',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.package(Path(sys.argv[2]))", resolve(root, "tools/dwg-analysis/abstract-building-geometry.py"), candidate]);
  await rename(candidate, output);
  console.log(JSON.stringify({ output, floors: floors.length, stairCorrespondences: analysis.candidates.length,
    needsAlignmentReview: analysis.candidates.filter(c => c.alignmentStatus === "alignment-needs-review").length,
    controlCheckedAlignments: analysis.registrations.length, routeEdgesCreated: 0 }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
