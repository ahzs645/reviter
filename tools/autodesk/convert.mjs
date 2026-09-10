#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { checkCapture, compareViewerCounts, gltfCounts, packGlb, rawAssetPath, readCaptureTar, saveRaw, sha256 } from './files.mjs';

const help = `Usage: npm run autodesk:convert -- capture.tar --out work/autodesk/model [--keep-origin]

Preserves the original archive and complete raw SVF bundle, then writes model.glb,
intermediate glTF, fragment mapping, checksums, and validation reports.
Output must be a new directory. Default GLB coordinates: metres, Y-up, centred.
--keep-origin retains the original model origin (unit and axis conversion still apply).
--allow-streaming-differences records differences between a streaming viewer and its
separate SVF derivative. SVF-to-GLB geometry checks remain strict.
Install converter dependencies first: npm run autodesk:setup`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, 'keep-origin': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    'allow-streaming-differences': { type: 'boolean' },
  } });
  if (values.help) { console.log(help); return; }
  if (positionals.length !== 1 || !values.out) throw new Error(help);
  const input = path.resolve(positionals[0]), output = path.resolve(values.out);
  if (fs.existsSync(output)) throw new Error(`Output already exists; choose a new directory: ${output}`);
  const require = createRequire(import.meta.url);
  // These deprecated helpers were removed in newer Node releases.
  util.isNullOrUndefined ??= value => value == null;
  util.isUndefined ??= value => value === undefined;
  let SvfReader, GltfWriter, validateBytes;
  try {
    ({ SvfReader, GltfWriter } = require('forge-convert-utils'));
    ({ validateBytes } = require('gltf-validator'));
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') throw new Error('Run npm run autodesk:setup before converting.');
    throw error;
  }
  const original = fs.readFileSync(input);
  const entries = readCaptureTar(original);
  const { capture, svfPath } = checkCapture(entries);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output);
  const writeJson = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n');
  const log = message => { fs.appendFileSync(path.join(output, 'conversion.log'), message + '\n'); console.log(message); };
  try {
    const archiveName = original[0] === 31 && original[1] === 139 ? 'source.tar.gz' : 'source.tar';
    fs.writeFileSync(path.join(output, archiveName), original, { flag: 'wx' });
    const rawFiles = saveRaw(entries, path.join(output, 'raw'));
    writeJson('raw-manifest.json', { sourceArchive: archiveName, sourceSha256: sha256(original), svfPath, files: rawFiles });
    log(`Preserved ${rawFiles.length} raw files and the original capture archive.`);
    const reader = await SvfReader.FromFileSystem(path.join(output, 'raw', svfPath));
    const available = new Set(rawFiles.map(file => file.path));
    reader.resolve = async uri => {
      const asset = rawAssetPath(svfPath, uri);
      if (!available.has(asset)) throw new Error(`SVF references an uncaptured asset: ${asset}`);
      return fs.readFileSync(path.join(output, 'raw', asset));
    };
    // Fail before the converter can replace missing images with placeholders.
    for (const asset of (await reader.getManifest()).assets) {
      if (!asset.URI.startsWith('embed:') && !available.has(rawAssetPath(svfPath, asset.URI)))
        throw new Error(`SVF references an uncaptured asset: ${asset.URI}`);
    }
    const scene = await reader.read({ log });
    const fragments = [], source = { fragments: scene.getNodeCount(), meshNodes: 0, triangles: 0, lineSegments: 0, points: 0 };
    for (let i = 0; i < scene.getNodeCount(); i++) {
      const node = scene.getNode(i), geometry = scene.getGeometry(node.geometry);
      if (geometry.kind === 3) continue; // Empty SVF geometry has no rendered node.
      const count = geometry.getIndices?.()?.length ?? geometry.getVertices().length / 3;
      if (geometry.kind === 0) source.triangles += count / 3;
      else if (geometry.kind === 1) source.lineSegments += count / 2;
      else if (geometry.kind === 2) source.points += count;
      else throw new Error(`Unknown geometry kind: ${geometry.kind}`);
      source.meshNodes++;
      fragments.push({ fragmentId: i, dbId: node.dbid, geometryId: node.geometry, materialId: node.material });
    }
    const viewerComparison = compareViewerCounts(capture, source, values['allow-streaming-differences']);
    if (!viewerComparison.countsMatch) log(`Streaming/SVF differences recorded: ${JSON.stringify(viewerComparison.differences)}`);
    const gltfDir = path.join(output, 'gltf');
    await new GltfWriter({ skipUnusedUvs: true, center: !values['keep-origin'], log }).write(scene, gltfDir);
    const doc = JSON.parse(fs.readFileSync(path.join(gltfDir, 'output.gltf'), 'utf8'));
    let fragmentIndex = 0;
    for (const [nodeIndex, node] of doc.nodes.entries()) if (node.mesh !== undefined) {
      const fragment = fragments[fragmentIndex++];
      if (!fragment || node.name !== String(fragment.dbId)) throw new Error('Fragment identity changed during conversion');
      fragment.nodeIndex = nodeIndex;
      node.extras = { ...node.extras, autodeskDbId: fragment.dbId, autodeskFragmentId: fragment.fragmentId };
    }
    fs.writeFileSync(path.join(gltfDir, 'output.gltf'), JSON.stringify(doc, null, 2));
    writeJson('fragments.json', fragments);
    const packed = packGlb(doc, gltfDir), counts = gltfCounts(packed.document);
    for (const key of ['meshNodes', 'triangles', 'lineSegments', 'points']) {
      if (counts[key] !== source[key]) throw new Error(`Export lost ${key}: source ${source[key]}, GLB ${counts[key]}`);
    }
    const glbPath = path.join(output, 'model.glb');
    fs.writeFileSync(glbPath, packed.bytes);
    const validation = await validateBytes(new Uint8Array(packed.bytes), { uri: 'model.glb', maxIssues: 100000 });
    writeJson('validation.json', validation);
    const valid = !validation.issues.numErrors && !validation.issues.truncated;
    const summary = {
      status: valid ? 'complete' : 'validation-failed', createdAt: new Date().toISOString(),
      capture: { file: capture.file ?? capture.name ?? null, view: capture.view, viewerVersion: capture.viewerVersion, capturedAt: capture.capturedAt },
      source: { archive: archiveName, sha256: sha256(original), svf: `raw/${svfPath}`, ...source },
      output: { file: 'model.glb', bytes: packed.bytes.length, sha256: sha256(packed.bytes), ...counts,
        materials: doc.materials?.length ?? 0, images: doc.images?.length ?? 0,
        coordinates: { sourceUnits: capture.units, units: 'metres', up: 'Y', centred: !values['keep-origin'],
          rootMatrix: doc.nodes[0]?.matrix, placementMatrix: doc.nodes[1]?.matrix } },
      geometryCountsMatch: true, viewerComparison, validation: validation.issues,
      tools: { converter: require('forge-convert-utils/package.json').version, validator: validation.validatorVersion, node: process.version },
    };
    writeJson('summary.json', summary);
    if (!valid) throw new Error('GLB validation failed or was truncated; see validation.json. Raw files were retained.');
    log(`Complete: ${counts.meshNodes} fragments, ${counts.triangles} triangles, ${counts.lineSegments} line segments.`);
    log(`GLB: ${glbPath}\nRaw SVF: ${path.join(output, 'raw', svfPath)}`);
  } catch (error) {
    writeJson('failure.json', { status: 'failed', message: error.message, at: new Date().toISOString() });
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
