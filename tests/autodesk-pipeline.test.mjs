import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { deflateRawSync, gzipSync, gunzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { checkCapture, compareViewerCounts, gltfCounts, packGlb, rawAssetPath, readCaptureTar, safePath, saveRaw, sha256 } from '../tools/autodesk/files.mjs';
import { expandPolylineIndices } from '../tools/autodesk/svf-lines.mjs';

test('SVF polyline boundaries preserve every connected edge without joining separate strips', () => {
  const indices = Uint16Array.from([0, 1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(expandPolylineIndices(indices, [0, 3, 6])), [0, 1, 1, 2, 3, 4, 4, 5]);
  assert.deepEqual(Array.from(expandPolylineIndices(Uint16Array.from([0, 1, 2, 0]), [0, 4])), [0, 1, 1, 2, 2, 0]);
  assert.equal(expandPolylineIndices(Uint16Array.from({ length: 12 }, (_, i) => i), [0, 12]).length / 2, 11);
  assert.equal(expandPolylineIndices(Uint16Array.from({ length: 11 }, (_, i) => i), [0, 11]).length / 2, 10);
  assert.deepEqual(expandPolylineIndices(indices, [0, 2, 4, 6]), indices);
  assert.throws(() => expandPolylineIndices(indices, [0, 7]), /Malformed/);
  assert.throws(() => expandPolylineIndices(indices, [0, 4, 2, 6]), /Malformed/);
});

function zipManifest(manifest) {
  const name = Buffer.from('manifest.json'), body = Buffer.from(JSON.stringify(manifest)), packed = deflateRawSync(body);
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + packed.length, 16);
  return new Uint8Array(Buffer.concat([local, name, packed, central, name, end]));
}

async function captureFixture(streaming = false) {
  const manifest = { assets: [{ URI: '../../objects_vals.json.gz' }] };
  const assets = new Map([
    ['https://example.invalid/model/view/model.svf', streaming ? zipManifest(manifest) : Uint8Array.of(80, 75, 3, 4)],
    ['https://example.invalid/objects_vals.json.gz', new TextEncoder().encode('["material"]')],
  ]);
  const data = { basePath: 'https://example.invalid/model/view/',
    manifest: streaming ? { assets: { fragments: 'fragments.fl' } } : manifest, isOTG: streaming,
    materials: { materials: { 0: {} } },
    metadata: { 'distance unit': { value: 'foot' } } };
  const model = {
    getData: () => data, is2d: () => false, isLoadDone: () => true,
    loader: { failedToLoadPacksCount: 0, queryParams: 'private-session-marker' },
    getDocumentNode: () => ({ data: { name: '{3D}', children: [{ mime: 'application/autodesk-svf', urn: 'model.svf' }] } }),
    getGeometryList: () => ({ geoms: [{ ib: new Uint16Array([0, 1, 2]) }] }),
    getFragmentList: () => ({ getCount: () => 1, getGeometry: () => ({ ib: new Uint16Array([0, 1, 2]) }) }),
  };
  let downloaded;
  class DownloadURL extends URL {
    static createObjectURL(blob) { downloaded = blob; return 'blob:test'; }
    static revokeObjectURL() {}
  }
  const result = await runInNewContext(fs.readFileSync(new URL('../tools/autodesk/capture-viewer.js', import.meta.url), 'utf8'), {
    NOP_VIEWER: { model }, LMV_VIEWER_VERSION: 'test', crypto: webcrypto,
    Autodesk: { Viewing: { endpoint: { initLoadContext: x => x, ENDPOINT_API_DERIVATIVE_SERVICE_V2: 'derivativeV2', getItemApi: () => 'https://example.invalid/model/view/model.svf' }, Private: { ViewingService: {
      getItem: (_context, url, resolve, reject) => assets.has(url) ? resolve(assets.get(url)) : reject(404),
    } } } },
    TextEncoder, TextDecoder, DataView, Uint8Array, Blob, Response, CompressionStream, DecompressionStream, URL: DownloadURL, setTimeout: fn => fn(),
    document: { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) },
  });
  return { tar: Buffer.from(await downloaded.arrayBuffer()), result };
}

function updateHeader(tar, update) {
  const copy = Buffer.from(tar), header = copy.subarray(0, 512);
  update(header);
  header.fill(32, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return copy;
}

test('browser capture creates a portable SVF bundle with gzip payloads, hashes, and live geometry totals', async () => {
  const { tar, result } = await captureFixture();
  const entries = readCaptureTar(tar), { capture, svfPath } = checkCapture(entries);
  assert.equal(result.files, 3);
  assert.equal(svfPath, 'model/view/model.svf');
  assert.equal(capture.fragments, 1);
  assert.equal(capture.triangles, 1);
  assert.equal(gunzipSync(entries.get('objects_vals.json.gz')).toString(), '["material"]');
  assert.equal(tar.includes(Buffer.from('private-session-marker')), false);
  assert.equal(checkCapture(readCaptureTar(gzipSync(tar))).svfPath, svfPath);
});

test('streaming viewer capture reads the separate SVF ZIP manifest rather than OTG asset paths', async () => {
  const { tar } = await captureFixture(true);
  const entries = readCaptureTar(tar), { capture } = checkCapture(entries);
  assert.equal(capture.sourceFormat, 'streaming');
  assert.equal(capture.triangles, 1);
  assert.equal(entries.has('objects_vals.json.gz'), true);
  assert.equal(entries.has('model/view/fragments.fl'), false);
});

test('cross-derivative differences require explicit acceptance and cannot bypass direct SVF comparisons', () => {
  const source = { fragments: 2, triangles: 20 }, capture = { fragments: 2, triangles: 18, sourceFormat: 'streaming' };
  assert.throws(() => compareViewerCounts(capture, source), /differs/);
  const result = compareViewerCounts(capture, source, true);
  assert.equal(result.countsMatch, false);
  assert.deepEqual(result.differences, [{ metric: 'triangles', viewer: 18, svf: 20, delta: 2 }]);
  assert.throws(() => compareViewerCounts({ ...capture, sourceFormat: 'svf' }, source, true), /differs/);
});

test('archive import rejects traversal, links, corrupt headers, truncated payloads, and duplicates', async () => {
  const { tar } = await captureFixture();
  assert.throws(() => readCaptureTar(updateHeader(tar, h => { h.fill(0, 0, 100); h.write('../escape.svf'); })), /Unsafe/);
  assert.throws(() => readCaptureTar(updateHeader(tar, h => { h[156] = 50; })), /regular files/);
  const corrupt = Buffer.from(tar); corrupt[20] ^= 1;
  assert.throws(() => readCaptureTar(corrupt), /checksum/);
  assert.throws(() => readCaptureTar(tar.subarray(0, 700)), /Truncated/);
  assert.throws(() => readCaptureTar(Buffer.concat([tar.subarray(0, 1024), tar])), /Duplicate/);
  assert.throws(() => safePath('C:/escape'), /Unsafe/);
  assert.throws(() => safePath('folder\\escape'), /Unsafe/);
  assert.equal(rawAssetPath('model/view/model.svf', '../../objects.json.gz'), 'objects.json.gz');
  assert.throws(() => rawAssetPath('model/view/model.svf', '../../../private'), /Unsafe/);
  assert.throws(() => rawAssetPath('model/view/model.svf', 'https://other.invalid/token'), /relative/);
  assert.throws(() => rawAssetPath('model/view/model.svf', '%2fetc/passwd'), /relative/);
});

test('inventory verification detects missing bytes and content changed without a size change', async () => {
  const { tar } = await captureFixture(), entries = readCaptureTar(tar);
  entries.set('model/view/model.svf', Buffer.from('XXXX'));
  assert.throws(() => checkCapture(entries), /checksum/);
  entries.delete('model/view/model.svf');
  assert.throws(() => checkCapture(entries), /Missing or damaged/);
});

test('raw storage restores old decoded gzip assets and preserves every original payload', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reviter-svf-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const svf = Buffer.from('PK-original'), json = Buffer.from('[1,2]'), compressed = gzipSync(json);
  const entries = new Map([['view/model.svf', svf], ['decoded.json.gz', json], ['compressed.json.gz', compressed]]);
  const files = saveRaw(entries, directory);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'view/model.svf')), svf);
  assert.deepEqual(gunzipSync(fs.readFileSync(path.join(directory, 'decoded.json.gz'))), json);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'compressed.json.gz')), compressed);
  assert.equal(files.find(x => x.path === 'decoded.json.gz').restoredGzip, true);
  assert.equal(files[0].sha256, sha256(svf));
  assert.throws(() => saveRaw(entries, directory), /EEXIST/);
});

test('GLB packing preserves instancing, IDs, transforms, buffer alignment, and embedded images', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reviter-glb-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'unused.bin'), Buffer.from([9]));
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  fs.writeFileSync(path.join(directory, 'positions.bin'), positions);
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    buffers: [{ uri: 'unused.bin', byteLength: 1 }, { uri: 'positions.bin', byteLength: positions.length }],
    bufferViews: [{ buffer: 1, byteLength: positions.length }],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3, min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0, name: '42', extras: { autodeskDbId: 42 } }, { mesh: 0, translation: [2, 0, 0] }],
    images: [{ uri: 'data:image/png;base64,iVBORw0KGgo=' }],
  };
  const { bytes, document } = packGlb(doc, directory);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.deepEqual(document.nodes, doc.nodes);
  assert.equal(document.bufferViews[0].byteOffset, 4);
  assert.equal(document.bufferViews[0].target, 34962);
  assert.equal(document.images[0].uri, undefined);
  assert.equal(document.images[0].mimeType, 'image/png');
  const binaryStart = 20 + bytes.readUInt32LE(12) + 8;
  assert.deepEqual(bytes.subarray(binaryStart + 4, binaryStart + 4 + positions.length), positions);
  assert.deepEqual(gltfCounts(document), { meshNodes: 2, triangles: 2, lineSegments: 0, points: 0 });
  assert.equal(doc.images[0].uri.startsWith('data:'), true);
  doc.buffers[0].uri = '../outside.bin';
  assert.throws(() => packGlb(doc, directory), /Unsafe/);
});
