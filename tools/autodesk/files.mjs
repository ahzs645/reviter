import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function safePath(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) ||
      name.split('/').includes('..') || name.includes('\0')) throw new Error(`Unsafe asset path: ${name}`);
  const normalized = path.posix.normalize(name);
  if (normalized === '.' || normalized.startsWith('../')) throw new Error(`Unsafe asset path: ${name}`);
  return normalized;
}

export function rawAssetPath(svfPath, uri) {
  const decoded = decodeURIComponent(uri);
  if (/^[a-z][a-z0-9+.-]*:|^\/|\\/i.test(decoded)) throw new Error('SVF resource must be relative to the capture');
  return safePath(path.posix.join(path.posix.dirname(svfPath), decoded));
}

// The capture script emits regular-file USTAR archives. Reject links, extensions,
// duplicate paths, damaged headers, and truncated payloads before writing anything.
export function readCaptureTar(input) {
  const tar = input[0] === 31 && input[1] === 139 ? gunzipSync(input) : input;
  const entries = new Map();
  const field = (h, offset, size) => h.subarray(offset, offset + size).toString('utf8').replace(/\0.*$/s, '');
  const octal = text => {
    const value = text.replace(/\0.*$/s, '').trim();
    if (!/^[0-7]+$/.test(value)) throw new Error('Invalid TAR numeric field');
    const number = parseInt(value, 8);
    if (!Number.isSafeInteger(number)) throw new Error('TAR numeric field is too large');
    return number;
  };
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(x => x === 0)) {
      if (offset + 1024 > tar.length || !tar.subarray(offset).every(x => x === 0))
        throw new Error('Invalid TAR end marker');
      if (!entries.size) throw new Error('Empty capture archive');
      return entries;
    }
    const sum = header.reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 32 : byte), 0);
    if (sum !== octal(field(header, 148, 8))) throw new Error('TAR header checksum mismatch');
    if (header[156] !== 0 && header[156] !== 48) throw new Error('Capture TAR must contain regular files only');
    const prefix = field(header, 345, 155);
    const name = safePath((prefix ? prefix + '/' : '') + field(header, 0, 100));
    if (entries.has(name)) throw new Error(`Duplicate archive path: ${name}`);
    const size = octal(field(header, 124, 12));
    const end = offset + 512 + size;
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    if (next > tar.length) throw new Error(`Truncated TAR asset: ${name}`);
    entries.set(name, tar.subarray(offset + 512, end));
    offset = next;
  }
  throw new Error('Missing TAR end marker');
}

export function checkCapture(entries) {
  if (!entries.has('capture.json')) throw new Error('Missing capture.json; use the Autodesk capture script');
  const capture = JSON.parse(entries.get('capture.json').toString('utf8'));
  if (capture.format && (capture.format !== 'reviter-autodesk-svf' || capture.version !== 1))
    throw new Error('Unsupported capture format or version');
  if (!Array.isArray(capture.assets) || !capture.assets.length) throw new Error('Missing capture asset inventory');
  const listed = new Set();
  for (const asset of capture.assets) {
    const name = safePath(asset.path);
    if (listed.has(name)) throw new Error(`Duplicate inventory asset: ${name}`);
    listed.add(name);
    const bytes = entries.get(name);
    if (!bytes || bytes.length !== asset.bytes) throw new Error(`Missing or damaged asset: ${name}`);
    if (asset.sha256 && sha256(bytes) !== asset.sha256) throw new Error(`Asset checksum mismatch: ${name}`);
  }
  if ([...entries.keys()].some(name => name !== 'capture.json' && !listed.has(name)))
    throw new Error('Archive has assets missing from capture inventory');
  const svfs = [...entries.keys()].filter(name => name.toLowerCase().endsWith('.svf'));
  if (svfs.length !== 1) throw new Error(`Expected one SVF view; found ${svfs.length}`);
  if (capture.failedGeometryPacks > 0) throw new Error('Capture reports failed geometry downloads');
  return { capture, svfPath: svfs[0] };
}

export function saveRaw(entries, directory) {
  const files = [];
  for (const [name, original] of entries) {
    // Old captures contain gzip payloads already decoded by Autodesk's loader.
    // Restore only their wrappers; the untouched TAR remains beside raw/.
    const restoredGzip = name.endsWith('.gz') && !(original[0] === 31 && original[1] === 139);
    const bytes = restoredGzip ? gzipSync(original) : original;
    const target = path.join(directory, safePath(name));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: 'wx' });
    files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes), restoredGzip });
  }
  return files;
}

function loadResource(uri, directory) {
  if (uri.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
    if (!match) throw new Error('Invalid resource data URI');
    return { bytes: Buffer.from(match[2] ? match[3] : decodeURIComponent(match[3]), match[2] ? 'base64' : 'utf8'), mime: match[1] };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) throw new Error('GLB packing only reads local resources');
  return { bytes: fs.readFileSync(path.join(directory, safePath(decodeURIComponent(uri)))) };
}

export function packGlb(source, directory) {
  const doc = structuredClone(source), chunks = [], offsets = [];
  let length = 0;
  function append(bytes) {
    const start = length, padding = Buffer.alloc((4 - bytes.length % 4) % 4);
    chunks.push(bytes, padding);
    length += bytes.length + padding.length;
    return start;
  }
  for (const buffer of doc.buffers ?? []) {
    if (!buffer.uri) throw new Error('Expected glTF buffers with local or data URIs');
    const { bytes } = loadResource(buffer.uri, directory);
    if (bytes.length !== buffer.byteLength) throw new Error('glTF buffer byteLength mismatch');
    offsets.push(append(bytes));
  }
  doc.bufferViews ??= [];
  for (const view of doc.bufferViews) {
    if (offsets[view.buffer] === undefined) throw new Error('Invalid glTF buffer reference');
    view.byteOffset = (view.byteOffset ?? 0) + offsets[view.buffer];
    view.buffer = 0;
  }
  for (const img of doc.images ?? []) {
    if (!img.uri) continue;
    const { bytes, mime } = loadResource(img.uri, directory);
    const inferred = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
    img.mimeType = img.mimeType || mime || inferred;
    if (!img.mimeType) throw new Error('Unrecognized texture format; the intermediate glTF has been retained');
    img.bufferView = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.length });
    delete img.uri;
  }
  for (const mesh of doc.meshes ?? []) for (const primitive of mesh.primitives) {
    for (const index of Object.values(primitive.attributes)) {
      const view = doc.accessors[index].bufferView;
      if (view !== undefined) doc.bufferViews[view].target = 34962;
    }
    if (primitive.indices !== undefined) {
      const view = doc.accessors[primitive.indices].bufferView;
      if (view !== undefined) doc.bufferViews[view].target = 34963;
    }
  }
  doc.buffers = [{ byteLength: length }];
  const json = Buffer.from(JSON.stringify(doc));
  const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const total = 20 + json.length + jsonPadding.length + 8 + length;
  if (total > 0xffffffff) throw new Error('Model exceeds the GLB 4 GB size limit');
  const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  header.writeUInt32LE(json.length + jsonPadding.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  binaryHeader.writeUInt32LE(length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return { bytes: Buffer.concat([header, json, jsonPadding, binaryHeader, ...chunks]), document: doc };
}

export function gltfCounts(doc) {
  const stats = { meshNodes: 0, triangles: 0, lineSegments: 0, points: 0 };
  for (const node of doc.nodes ?? []) {
    if (node.mesh === undefined) continue;
    stats.meshNodes++;
    for (const primitive of doc.meshes[node.mesh].primitives) {
      const count = doc.accessors[primitive.indices ?? primitive.attributes.POSITION].count;
      switch (primitive.mode ?? 4) {
        case 4: stats.triangles += count / 3; break;
        case 1: stats.lineSegments += count / 2; break;
        case 0: stats.points += count; break;
        default: throw new Error(`Unexpected primitive mode: ${primitive.mode}`);
      }
    }
  }
  return stats;
}

export function compareViewerCounts(capture, source, allowStreamingDifferences = false) {
  const differences = [];
  for (const key of ['fragments', 'triangles', 'lineSegments', 'points']) {
    if (capture[key] !== undefined && capture[key] !== source[key])
      differences.push({ metric: key, viewer: capture[key], svf: source[key], delta: source[key] - capture[key] });
  }
  const acceptedStreamingDifference = differences.length > 0 && capture.sourceFormat === 'streaming' && allowStreamingDifferences;
  if (differences.length && !acceptedStreamingDifference) {
    const first = differences[0];
    throw new Error(`SVF ${first.metric} (${first.svf}) differs from the live capture (${first.viewer}).` +
      (capture.sourceFormat === 'streaming' ? ' Inspect the separate derivatives; --allow-streaming-differences records the difference while keeping SVF-to-GLB checks strict.' : ''));
  }
  return { sourceFormat: capture.sourceFormat ?? 'svf', countsMatch: differences.length === 0, differences, acceptedStreamingDifference };
}
