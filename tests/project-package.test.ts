import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { createProjectPackage, readProjectPackage, projectPackageName } from '../lib/reviter/project-package.ts';
import type { RoomDirectoryData } from '../lib/reviter/room-directory.ts';

const model = new File([new Uint8Array([1, 2, 3, 4, 5])], 'Campus original.rvt', { lastModified: 1234 });
const rooms: RoomDirectoryData = {
  format: 'reviter-room-annotations', version: 1, coordinateSystem: 'revit-model-feet',
  model: { fileName: 'unbc.rvt' },
  annotations: [{ key: 'a', number: '05-142', name: 'Plaza', levelId: 311, confidence: 1,
    polygonFeet: [[0, 0], [10, 0], [10, 10], [0, 10]], labelPointFeet: [5, 5],
    access: { kind: 'staff', evidence: 'user-reported', notes: 'Keep this review' } }],
  georeference: { format: 'reviter-georeference', version: 1, modelFileName: model.name,
    sourceModelFileName: 'unbc.rvt', coordinateSystem: 'WGS84', method: 'fixed-scale',
    points: [{ id: 'point-1', name: 'Corner', modelFeet: [166.17785613436897, 890.1439869835035],
      levelId: 311, geographic: { latitude: 53.89463582, longitude: -122.814055 } }] },
  customProvenance: { retain: 'unknown fields too' },
};

test('project round trip preserves original bytes, filenames, exact GIS coordinates and all floor fields', async () => {
  const before = JSON.stringify(rooms);
  const archive = await createProjectPackage(model, rooms);
  const restored = await readProjectPackage(archive);
  assert.equal(restored.model.name, model.name);
  assert.equal(restored.model.lastModified, model.lastModified);
  assert.deepEqual(new Uint8Array(await restored.model.arrayBuffer()), new Uint8Array(await model.arrayBuffer()));
  assert.deepEqual(JSON.parse(await restored.roomFile.text()), rooms);
  assert.deepEqual(restored.rooms, rooms);
  assert.equal(JSON.stringify(rooms), before);
  assert.deepEqual(Object.keys(unzipSync(archive)).sort(), ['manifest.json', `model/${model.name}`, 'floors/rooms.json', 'gis/reference-points.json'].sort());
  assert.equal(projectPackageName(model.name), 'Campus original.reviter.zip');
});

test('projects without GIS points remain importable', async () => {
  const data = { ...rooms, georeference: undefined };
  const restored = await readProjectPackage(await createProjectPackage(model, data));
  assert.equal(restored.rooms.georeference, undefined);
  assert.equal(restored.manifest.georeference, undefined);
});

test('a changed model or room file fails the manifest hash before import', async () => {
  const archive = await createProjectPackage(model, rooms);
  for (const path of [`model/${model.name}`, 'floors/rooms.json']) {
    const files = unzipSync(archive);
    files[path][0] ^= 1;
    await assert.rejects(readProjectPackage(zipSync(files)), /missing or damaged/);
  }
});

test('missing entries, unsupported versions, unexpected paths and excessive declared size are rejected', async () => {
  const archive = await createProjectPackage(model, rooms);
  const missing = unzipSync(archive); delete missing['floors/rooms.json'];
  await assert.rejects(readProjectPackage(zipSync(missing)), /missing or damaged/);
  const version = unzipSync(archive);
  const manifest = JSON.parse(strFromU8(version['manifest.json'])); manifest.version = 2;
  version['manifest.json'] = strToU8(JSON.stringify(manifest));
  await assert.rejects(readProjectPackage(zipSync(version)), /version 1/);
  const extra = unzipSync(archive); extra['../escape.json'] = strToU8('{}');
  await assert.rejects(readProjectPackage(zipSync(extra)), /unexpected/);
  const huge = zipSync({ 'floors/rooms.json': strToU8('{}') }, { level: 0 });
  // Change only the central-directory uncompressed size; no large allocation required.
  const view = new DataView(huge.buffer);
  for (let i = 0; i < huge.length - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 65 * 1024 * 1024, true); break; }
  }
  await assert.rejects(readProjectPackage(huge), /oversized/);
});

test('GIS model binding is checked and independently edited reference files cannot override floors', async () => {
  await assert.rejects(createProjectPackage(new File(['other'], 'Other.rvt'), rooms), /different Revit model/);
  const files = unzipSync(await createProjectPackage(model, rooms));
  const reference = JSON.parse(strFromU8(files['gis/reference-points.json'])); reference.points[0].modelFeet[0] += 1;
  files['gis/reference-points.json'] = strToU8(JSON.stringify(reference));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  manifest.georeference.bytes = files['gis/reference-points.json'].length;
  manifest.georeference.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', files['gis/reference-points.json'].slice().buffer as ArrayBuffer)).toString('hex');
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  await assert.rejects(readProjectPackage(zipSync(files)), /do not match/);
});
