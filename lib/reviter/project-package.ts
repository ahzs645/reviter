import { zip, unzip, unzipSync, strToU8, strFromU8, type AsyncZippable, type Unzipped } from 'fflate';
import { parseRoomDirectory, type RoomDirectoryData } from './room-directory.ts';
import type {IndoorDataset} from './indoor-contract.ts';

const MB = 1024 * 1024;
const limits: Record<string, number> = {
  'manifest.json': 64 * 1024,
  'floors/rooms.json': 64 * MB,
  'gis/reference-points.json': MB,
  'viewer/indoor.json': 128 * MB,
  'model/scene.glb': 256 * MB,
};
export const MAX_PROJECT_PACKAGE_BYTES = 900 * MB;
const MAX_PACKAGE = MAX_PROJECT_PACKAGE_BYTES;
const MODEL_LIMIT = 512 * MB;
const entryLimit = (path: string) => path.startsWith('model/') && safeModelName(path.slice(6)) ? MODEL_LIMIT : limits[path];
type Entry = { path: string; bytes: number; sha256: string };
export type ProjectManifest = {
  format: 'reviter-project'; version: 1 | 2; createdAt: string;
  model: Entry & { fileName: string; lastModified: number };
  floors: Entry;
  georeference?: Entry;
  indoor?: Entry;
  scene?: Entry;
};

/** Keep the original source, rather than a lossy geometry export, in the project. */
export async function createProjectPackage(model: File, rooms: RoomDirectoryData, prepared?:{indoor:IndoorDataset;scene?:Uint8Array}): Promise<Uint8Array> {
  if (!safeModelName(model.name) || !model.size || model.size > MODEL_LIMIT) {
    throw new Error('Choose a non-empty Revit source file no larger than 512 MB.');
  }
  const roomBytes = strToU8(JSON.stringify(rooms));
  const parsed = parseRoomDirectory(strFromU8(roomBytes));
  assertModelBinding(parsed, model.name);
  if (roomBytes.length > limits['floors/rooms.json']) throw new Error('Floor data exceeds the 64 MB package limit.');
  const modelBytes = new Uint8Array(await model.arrayBuffer());
  const manifest: ProjectManifest = {
    format: 'reviter-project', version: 1, createdAt: new Date().toISOString(),
    model: { ...await describe(`model/${model.name}`, modelBytes), fileName: model.name, lastModified: model.lastModified },
    floors: await describe('floors/rooms.json', roomBytes),
  };
  // RVT is already compressed; store it without another expensive compression pass.
  const files: AsyncZippable = {
    [manifest.model.path]: [modelBytes, { level: 0 }],
    'floors/rooms.json': roomBytes,
  };
  if (parsed.georeference) {
    const bytes = strToU8(JSON.stringify(parsed.georeference));
    if (bytes.length > limits['gis/reference-points.json']) throw new Error('GIS reference data exceeds the package limit.');
    manifest.georeference = await describe('gis/reference-points.json', bytes);
    files['gis/reference-points.json'] = bytes;
  }
  if(prepared){
    if(prepared.indoor.source.modelSha256!==manifest.model.sha256||prepared.indoor.source.roomsSha256!==manifest.floors.sha256||prepared.indoor.source.modelFileName!==model.name)throw new Error('Prepared indoor data is stale. Compile it again from this model and these reviews.');
    manifest.version=2;
    const bytes=strToU8(JSON.stringify(prepared.indoor));
    if(bytes.length>limits['viewer/indoor.json'])throw new Error('Indoor dataset exceeds the package limit.');
    manifest.indoor=await describe('viewer/indoor.json',bytes);files[manifest.indoor.path]=bytes;
    if(prepared.scene){if(prepared.scene.length>limits['model/scene.glb'])throw new Error('Prepared scene exceeds the package limit.');manifest.scene=await describe('model/scene.glb',prepared.scene);files[manifest.scene.path]=prepared.scene;}
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return new Promise((resolve, reject) => zip(files, { level: 6 }, (err, bytes) => err ? reject(err) : resolve(bytes)));
}

/** Validate every entry before handing anything to the model/floor importers. */
export async function readProjectPackage(bytes: Uint8Array): Promise<{ model: File; roomFile: File; rooms: RoomDirectoryData; manifest: ProjectManifest; indoor?:IndoorDataset; scene?:Uint8Array }> {
  if (!bytes.length || bytes.length > MAX_PACKAGE) throw new Error('Project ZIP must be non-empty and no larger than 900 MB.');
  const seen = new Set<string>();
  let expanded = 0;
  // Scan central-directory sizes without inflating or starting workers first.
  unzipSync(bytes, { filter: entry => {
      const limit = entryLimit(entry.name);
      if (!limit || seen.has(entry.name) || entry.originalSize > limit || !Number.isSafeInteger(entry.originalSize)) {
        throw new Error('Project ZIP contains an unexpected, duplicate, or oversized entry.');
      }
      seen.add(entry.name);
      expanded += entry.originalSize;
      if (expanded > MAX_PACKAGE) throw new Error('Expanded project exceeds the package limit.');
      return false;
    } });
  const files = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (err, result) => err ? reject(err) : resolve(result));
  });
  if (!files['manifest.json']) throw new Error('This ZIP is missing its Reviter project manifest.');
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as ProjectManifest;
  if (!manifest || manifest.format !== 'reviter-project' || ![1,2].includes(manifest.version)
    || !safeModelName(manifest.model?.fileName) || !Number.isFinite(manifest.model.lastModified)
    || typeof manifest.createdAt !== 'string'||manifest.version===2&&!manifest.indoor||manifest.version===1&&(manifest.indoor||manifest.scene)) throw new Error('Choose a version 1 or 2 Reviter project ZIP.');
  const expectedEntries = new Set(['manifest.json', manifest.model.path, 'floors/rooms.json', ...(manifest.georeference ? ['gis/reference-points.json'] : []),...(manifest.indoor?['viewer/indoor.json']:[]),...(manifest.scene?['model/scene.glb']:[])]);
  if (Object.keys(files).some(path => !expectedEntries.has(path))) throw new Error('Project ZIP contains files not listed in its manifest.');
  const modelBytes = await verify(files, manifest.model, `model/${manifest.model.fileName}`);
  const roomBytes = await verify(files, manifest.floors, 'floors/rooms.json');
  const rooms = parseRoomDirectory(strFromU8(roomBytes));
  assertModelBinding(rooms, manifest.model.fileName);
  if (manifest.georeference) {
    const reference = await verify(files, manifest.georeference, 'gis/reference-points.json');
    if (JSON.stringify(JSON.parse(strFromU8(reference))) !== JSON.stringify(rooms.georeference)) {
      throw new Error('GIS references do not match the saved floor data.');
    }
  } else if (rooms.georeference || files['gis/reference-points.json']) {
    throw new Error('Project GIS references are missing from the manifest.');
  }
  let indoor:IndoorDataset|undefined,scene:Uint8Array|undefined;
  if(manifest.indoor){indoor=JSON.parse(strFromU8(await verify(files,manifest.indoor,'viewer/indoor.json'))) as IndoorDataset;if(indoor.format!=='reviter-indoor'||indoor.version!==1||indoor.source.modelSha256!==manifest.model.sha256||indoor.source.roomsSha256!==manifest.floors.sha256||indoor.source.modelFileName!==manifest.model.fileName)throw new Error('Prepared indoor data does not match its model and reviews.');}
  if(manifest.scene)scene=await verify(files,manifest.scene,'model/scene.glb');
  return {
    model: new File([ownedBuffer(modelBytes)], manifest.model.fileName, { lastModified: manifest.model.lastModified }),
    roomFile: new File([ownedBuffer(roomBytes)], 'rooms.project.json', { type: 'application/json' }),
    rooms, manifest,indoor,scene,
  };
}

function safeModelName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 255 && !/[\\/\x00-\x1f]/.test(name) && /\.(rvt|rfa|rte|rft)$/i.test(name);
}
function assertModelBinding(rooms: RoomDirectoryData, name: string) {
  if (rooms.georeference && rooms.georeference.modelFileName !== name) {
    throw new Error('GIS references belong to a different Revit model. Open their original model before exporting.');
  }
}
function ownedBuffer(bytes: Uint8Array): ArrayBuffer { return bytes.slice().buffer as ArrayBuffer; }
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ownedBuffer(bytes));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function describe(path: string, bytes: Uint8Array): Promise<Entry> {
  return { path, bytes: bytes.length, sha256: await hash(bytes) };
}
async function verify(files: Unzipped, entry: Entry, expected: string): Promise<Uint8Array> {
  const bytes = files[expected];
  if (!entry || entry.path !== expected || !bytes || bytes.length !== entry.bytes || !bytes.length
    || bytes.length > entryLimit(expected) || !/^[a-f0-9]{64}$/.test(entry.sha256)
    || await hash(bytes) !== entry.sha256) throw new Error(`Project entry is missing or damaged: ${expected}.`);
  return bytes;
}

export const projectPackageName = (modelName: string) => `${modelName.replace(/\.(rvt|rfa|rte|rft)$/i, '')}.reviter.zip`;
