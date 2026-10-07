import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { prepareIndoorDataset, sha256Bytes } from '../lib/reviter/indoor-pipeline.ts';
import { parseRoomDirectory, type RoomDirectoryData } from '../lib/reviter/room-directory.ts';
import { createProjectPackage, readProjectPackage } from '../lib/reviter/project-package.ts';
import { nativeDisplayRegionHash, nativeDisplayScopeParts, type NativeDisplayScopes } from '../lib/reviter/native-display-scopes.ts';
import type { ConvertResult } from '../lib/reviter/types.ts';

const modelFile = new File(['source bytes remain unchanged'], 'Scope.rvt');
const model = {
  fileName: modelFile.name, origin: { x: 0, y: 0, z: 0 },
  levels: [{ levelId: 1, elevation: 0, candidates: 1, name: 'Ground' }],
  elementBounds: [], nativeAssociatedLevelRelations: [{ elementId: 100, levelId: 1 }], nativeStairAssemblies: [],
} as unknown as ConvertResult;
const rooms: RoomDirectoryData = {
  format: 'reviter-room-annotations', version: 1, coordinateSystem: 'revit-model-feet', model: { fileName: modelFile.name },
  annotations: [{ key: 'hall', number: '01-001', name: 'Corridor', levelId: 1, confidence: 1,
    polygonFeet: [[0, 0], [20, 0], [20, 20], [0, 20]], labelPointFeet: [10, 10] }],
  georeference: { format: 'reviter-georeference', version: 1, coordinateSystem: 'WGS84', method: 'fixed-scale', modelFileName: modelFile.name,
    points: [{ id: 'p', name: 'Origin', modelFeet: [0, 0], levelId: 1, geographic: { longitude: -122, latitude: 53 } },
      { id: 'q', name: 'Second', modelFeet: [100, 0], levelId: 1, geographic: { longitude: -121.999545, latitude: 53 } }] },
};
const rings: [number, number][][] = [
  [[0, 0], [20, 0], [20, 20], [0, 20]],
  [[6, 6], [8, 6], [8, 8], [6, 8]],
];
async function scope(modelSha256: string): Promise<NativeDisplayScopes> {
  return { version: 1, sourceModelSha256: modelSha256, scopes: [{ id: 'reviewed-indoor', levelId: 1, regionId: 'native-region:1:0',
    regionRingsSha256: await nativeDisplayRegionHash(rings),
    partsFeet: [[[[-2, -2], [22, -2], [22, 22], [-2, 22]]]], evidence: 'reviewed-source-enclosure' }] };
}
const area = (ring: number[][]) => Math.abs(ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length]!; return sum + a[0]! * b[1]! - a[1]! * b[0]!;
}, 0)) / 2;

test('display scopes preserve exact source metadata, model and physical graph through compiler and package round trip', async () => {
  const hash = await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const input = { ...rooms, nativeDisplayScopes: await scope(hash) };
  const before = structuredClone(input);
  assert.deepEqual(parseRoomDirectory(JSON.stringify(input)).nativeDisplayScopes, input.nativeDisplayScopes);
  const baseline = await prepareIndoorDataset(model, rooms, hash);
  const compiled = await prepareIndoorDataset(model, input, hash);
  assert.deepEqual(input, before);
  assert.deepEqual(compiled.nativeDisplayScopes, input.nativeDisplayScopes);
  for (const key of ['records', 'nodes', 'edges', 'doors', 'walls', 'presentation', 'stairDisplay', 'walkingSupport', 'circulationGeometry', 'issues'] as const)
    assert.deepEqual(compiled[key], baseline[key], `${key} cannot change from a display scope`);
  const unpacked = await readProjectPackage(await createProjectPackage(modelFile, input, { indoor: compiled }));
  assert.equal(await unpacked.model.text(), await modelFile.text());
  assert.deepEqual(unpacked.rooms.nativeDisplayScopes, input.nativeDisplayScopes);
  assert.deepEqual(unpacked.indoor?.nativeDisplayScopes, input.nativeDisplayScopes);
});

test('display scope compiler rejects another model while parser rejects malformed hash or duplicated identities', async () => {
  const hash = await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const value = await scope('b'.repeat(64));
  await assert.rejects(prepareIndoorDataset(model, { ...rooms, nativeDisplayScopes: value }, hash), /display scope.*binding/);
  value.sourceModelSha256 = 'invalid';
  assert.throws(() => parseRoomDirectory(JSON.stringify({ ...rooms, nativeDisplayScopes: value })), /display scope/);
  value.sourceModelSha256 = hash;
  value.scopes.push(structuredClone(value.scopes[0]!));
  assert.throws(() => parseRoomDirectory(JSON.stringify({ ...rooms, nativeDisplayScopes: value })), /display scope/);
});

test('source-only archives reject display evidence bound to another model on creation and checksum-correct import', async () => {
  const hash = await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  await assert.rejects(createProjectPackage(modelFile, { ...rooms, nativeDisplayScopes: await scope('b'.repeat(64)) }), /display scope.*binding/i);
  const input = { ...rooms, nativeDisplayScopes: await scope(hash) };
  const files = unzipSync(await createProjectPackage(modelFile, input));
  const savedRooms = JSON.parse(strFromU8(files['floors/rooms.json']!));
  savedRooms.nativeDisplayScopes.sourceModelSha256 = 'b'.repeat(64);
  files['floors/rooms.json'] = strToU8(JSON.stringify(savedRooms));
  const manifest = JSON.parse(strFromU8(files['manifest.json']!));
  manifest.floors.bytes = files['floors/rooms.json'].length;
  manifest.floors.sha256 = await sha256Bytes(files['floors/rooms.json']);
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  await assert.rejects(readProjectPackage(zipSync(files)), /display scope.*binding/i);
});

test('replayed display scope clips to actual native floor and retains native holes, with stale regions omitted', async () => {
  const value = await scope('a'.repeat(64));
  const result = await nativeDisplayScopeParts(value, value.sourceModelSha256, 1, 'native-region:1:0', rings);
  assert.equal(result.parts.length, 1);
  assert.equal(result.parts[0]!.length, 2);
  assert.equal(area(result.parts[0]![0]!) - area(result.parts[0]![1]!), 396);
  assert.ok(result.parts.flat(2).every(([x, y]) => x >= 0 && x <= 20 && y >= 0 && y <= 20));
  const edited = structuredClone(rings); edited[0]![1]![0] = 19;
  assert.deepEqual(await nativeDisplayScopeParts(value, value.sourceModelSha256, 1, 'native-region:1:0', edited),
    { parts: [], stale: ['reviewed-indoor'] });
  assert.deepEqual(await nativeDisplayScopeParts(value, value.sourceModelSha256, 2, 'native-region:1:0', rings), { parts: [], stale: [] });
  await assert.rejects(nativeDisplayScopeParts(value, 'b'.repeat(64), 1, 'native-region:1:0', rings), /display scope.*binding/);
});

test('package creation rejects display scope divergence even with correctly bound room checksums', async () => {
  const hash = await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const input = { ...rooms, nativeDisplayScopes: await scope(hash) };
  const compiled = await prepareIndoorDataset(model, input, hash);
  delete compiled.nativeDisplayScopes;
  await assert.rejects(createProjectPackage(modelFile, input, { indoor: compiled }), /display scope/i);
});

test('package reader rejects checksum-correct removal of prepared native display evidence', async () => {
  const hash = await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer()));
  const input = { ...rooms, nativeDisplayScopes: await scope(hash) };
  const compiled = await prepareIndoorDataset(model, input, hash);
  const files = unzipSync(await createProjectPackage(modelFile, input, { indoor: compiled }));
  const indoor = JSON.parse(strFromU8(files['viewer/indoor.json']!)); delete indoor.nativeDisplayScopes;
  files['viewer/indoor.json'] = strToU8(JSON.stringify(indoor));
  const manifest = JSON.parse(strFromU8(files['manifest.json']!));
  manifest.indoor.bytes = files['viewer/indoor.json'].length;
  manifest.indoor.sha256 = await sha256Bytes(files['viewer/indoor.json']);
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  await assert.rejects(readProjectPackage(zipSync(files)), /display scope/i);
});
