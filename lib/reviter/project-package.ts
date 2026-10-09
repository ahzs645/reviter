import {
  preparedDisplayCacheEntryLimit,
  isPreparedDisplayChunkPath,
  PREPARED_DISPLAY_ARCHIVE_STORED_LIMIT,
  validatePreparedDisplayCacheContainer,
} from "./prepared-display-cache-container.ts";
import {validateNativeProvisionalCornerSeals,verifyNativeProvisionalCornerSeals} from "./native-provisional-corner-seals.ts";
import {nativeIndoorEnvelopeAuthored} from "./native-indoor-envelope-supplement.ts";
import {validateNativeMaterialSectionSupplement} from "./native-material-section-supplement.ts";
import {validateNativeDerivedFrameReturns,verifyNativeDerivedFrameReturns} from "./native-derived-frame-returns.ts";
import { hydrateRoomNativeMaterials } from "./native-material-wire.ts";
import {validateNativeSourceStairMaterials} from "./native-source-stair-material.ts";
import {validateNativeMaterialSections,verifyNativeMaterialSections} from "./native-material-sections.ts";
import {validateNativeSelectionContactRepairs,deriveNativeSelectionContactRepairs} from "./native-selection-contact-repairs.ts";
import {assertNativeSelectionContactRepairsPhysicalGuards} from "./native-selection-contact-guards.ts";
import { MAX_REVIEW_CONTAINER_BYTES } from "./review-bundle-limits.ts";
import { validateNativeIndoorEnvelopes, verifyNativeIndoorEnvelopes } from "./native-indoor-envelopes.ts";
import { validateNativeDisplayScopes } from "./native-display-scopes.ts";
import {validateReviewedAreaPartitionBinding} from "./reviewed-area-partitions.ts";
import {
  zip,
  unzip,
  unzipSync,
  strToU8,
  strFromU8,
  type AsyncZippable,
  type Unzipped,
} from "fflate";
import {
  parseRoomDirectory,
  type RoomDirectoryData,
} from "./room-directory.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import {
  serializeRoomsForArchive,
  unpackReviewBundle,
  REVIEW_BUNDLE_ARCHIVE_PATH,
} from "./review-bundle-wire.ts";
import type { ReviewBundle } from "./review-bundle-core.ts";

const MB = 1024 * 1024;
const limits: Record<string, number> = {
  "manifest.json": 64 * 1024,
  "floors/rooms.json": 64 * MB,
  "gis/reference-points.json": MB,
  // Match the authoring reader: exact native faces and source-bound route
  // proofs can exceed 128 MiB. The shared 900 MiB expanded archive cap remains.
  "viewer/indoor.json": 192 * MB,
  "model/scene.glb": 256 * MB,
  "review/companions.bin": MAX_REVIEW_CONTAINER_BYTES,
};
export const MAX_PROJECT_PACKAGE_BYTES = 900 * MB;
// Only this reader can certify a hydrated standalone File. Its source wire and
// every expanded companion passed the unchanged archive and content limits.
const validatedRoomFiles = new WeakSet<File>();
export function isValidatedProjectRoomFile(file: File): boolean {
  return validatedRoomFiles.has(file);
}
const MAX_PACKAGE = MAX_PROJECT_PACKAGE_BYTES;
const MODEL_LIMIT = 512 * MB;
const entryLimit = (path: string) =>
  path.startsWith("model/") && safeModelName(path.slice(6))
    ? MODEL_LIMIT
    : limits[path] ?? preparedDisplayCacheEntryLimit(path);
type Entry = { path: string; bytes: number; sha256: string };
async function validateNativeSelectionContactBinding(rooms: RoomDirectoryData, indoor: IndoorDataset) {
  validateNativeSelectionContactRepairs(rooms.nativeSelectionContactRepairs, indoor.source.modelSha256);
  validateNativeSelectionContactRepairs(indoor.nativeSelectionContactRepairs, indoor.source.modelSha256);
  if (JSON.stringify(rooms.nativeSelectionContactRepairs) !== JSON.stringify(indoor.nativeSelectionContactRepairs))
    throw new Error("Source and prepared native selection contacts do not match.");
  const applied=(indoor.nativeSelectionContactRepairs?.repairs??[]).filter(r=>r.status==='applied');
  if (!applied.length) return;
  await verifyNativeMaterialSections(indoor.nativeMaterialSections, indoor.source.modelSha256);
  assertNativeSelectionContactRepairsPhysicalGuards(indoor, applied, deriveNativeSelectionContactRepairs(indoor, applied));
}
async function validateNativeDisplayScopeBinding(rooms: RoomDirectoryData, indoor: IndoorDataset) {
  validateNativeSourceStairMaterials(rooms.nativeSourceStairMaterials,indoor.source.modelSha256);
  validateNativeSourceStairMaterials(indoor.nativeSourceStairMaterials,indoor.source.modelSha256);
  if(JSON.stringify(rooms.nativeSourceStairMaterials)!==JSON.stringify(indoor.nativeSourceStairMaterials))throw new Error("Source and prepared native stair materials do not match.");
  validateNativeProvisionalCornerSeals(rooms.nativeProvisionalCornerSeals,indoor.source.modelSha256);
  validateNativeProvisionalCornerSeals(indoor.nativeProvisionalCornerSeals,indoor.source.modelSha256);
  if(JSON.stringify(rooms.nativeProvisionalCornerSeals)!==JSON.stringify(indoor.nativeProvisionalCornerSeals))throw new Error("Source and prepared provisional native corner assumptions do not match.");
  validateNativeDerivedFrameReturns(rooms.nativeDerivedFrameReturns,indoor.source.modelSha256);
  validateNativeDerivedFrameReturns(indoor.nativeDerivedFrameReturns,indoor.source.modelSha256);
  if(JSON.stringify(rooms.nativeDerivedFrameReturns)!==JSON.stringify(indoor.nativeDerivedFrameReturns))throw new Error("Source and prepared derived native frame material do not match.");
  verifyNativeDerivedFrameReturns(indoor);
  validateNativeMaterialSections(rooms.nativeMaterialSections, indoor.source.modelSha256);
  validateNativeMaterialSections(indoor.nativeMaterialSections, indoor.source.modelSha256);
  if (JSON.stringify(rooms.nativeMaterialSections) !== JSON.stringify(indoor.nativeMaterialSections)) throw new Error("Source and prepared original native materials do not match.");
  // Derived (compiler-only) supplement: bound to the unchanged original checksum.
  validateNativeMaterialSectionSupplement(indoor.nativeMaterialSectionSupplement, indoor.nativeMaterialSections, indoor.source.modelSha256);
  validateNativeIndoorEnvelopes(rooms.nativeIndoorEnvelopes, indoor.source.modelSha256);
  validateNativeIndoorEnvelopes(indoor.nativeIndoorEnvelopes, indoor.source.modelSha256);
  // The prepared envelope may carry a derived supplement (appended parts + records); its authored
  // part must still equal the source envelope byte for byte.
  if (JSON.stringify(rooms.nativeIndoorEnvelopes) !== JSON.stringify(await nativeIndoorEnvelopeAuthored(indoor.nativeIndoorEnvelopes))) throw new Error("Source and prepared native indoor envelopes do not match.");
  validateNativeDisplayScopes(rooms.nativeDisplayScopes, indoor.source.modelSha256);
  validateNativeDisplayScopes(indoor.nativeDisplayScopes, indoor.source.modelSha256);
  if (JSON.stringify(rooms.nativeDisplayScopes) !== JSON.stringify(indoor.nativeDisplayScopes))
    throw new Error("Source and prepared native display scopes do not match.");
}
export type ProjectManifest = {
  format: "reviter-project";
  version: 1 | 2;
  createdAt: string;
  model: Entry & { fileName: string; lastModified: number };
  floors: Entry;
  georeference?: Entry;
  indoor?: Entry;
  scene?: Entry;
  reviewBundle?: Entry;
  /** Opaque derived cache is validated then discarded by this source reader. */
  preparedDisplay?: Entry;
};

/** Keep the original source, rather than a lossy geometry export, in the project. */
export async function createProjectPackage(
  model: File,
  rooms: RoomDirectoryData,
  prepared?: { indoor: IndoorDataset; scene?: Uint8Array },
): Promise<Uint8Array> {
  if (!safeModelName(model.name) || !model.size || model.size > MODEL_LIMIT) {
    throw new Error(
      "Choose a non-empty Revit source file no larger than 512 MB.",
    );
  }
  const logicalRoomBytes = strToU8(JSON.stringify(rooms));
  const parsed = parseRoomDirectory(strFromU8(logicalRoomBytes));
  const serialized = await serializeRoomsForArchive({
    ...rooms,
    reviewBundle: rooms.reviewBundle as ReviewBundle | undefined,
  });
  const roomBytes = serialized.rooms;
  assertModelBinding(parsed, model.name);
  if (roomBytes.length > limits["floors/rooms.json"])
    throw new Error("Floor data exceeds the 64 MB package limit.");
  const modelBytes = new Uint8Array(await model.arrayBuffer());
  const manifest: ProjectManifest = {
    format: "reviter-project",
    version: 1,
    createdAt: new Date().toISOString(),
    model: {
      ...(await describe(`model/${model.name}`, modelBytes)),
      fileName: model.name,
      lastModified: model.lastModified,
    },
    floors: await describe("floors/rooms.json", roomBytes),
  };
  await verifyNativeMaterialSections(parsed.nativeMaterialSections, manifest.model.sha256);
  await verifyNativeIndoorEnvelopes(parsed.nativeIndoorEnvelopes, manifest.model.sha256);
  validateNativeDisplayScopes(parsed.nativeDisplayScopes, manifest.model.sha256);
  // RVT is already compressed; store it without another expensive compression pass.
  const files: AsyncZippable = {
    [manifest.model.path]: [modelBytes, { level: 0 }],
    "floors/rooms.json": roomBytes,
  };
  if (serialized.reviewEntry) {
    const e = serialized.reviewEntry;
    manifest.reviewBundle = {
      path: e.path,
      bytes: e.bytes.length,
      sha256: e.sha256,
    };
    files[e.path] = [e.bytes, { level: 0 }];
  }
  if (parsed.georeference) {
    const bytes = strToU8(JSON.stringify(parsed.georeference));
    if (bytes.length > limits["gis/reference-points.json"])
      throw new Error("GIS reference data exceeds the package limit.");
    manifest.georeference = await describe("gis/reference-points.json", bytes);
    files["gis/reference-points.json"] = bytes;
  }
  if (prepared) {
    if (
      prepared.indoor.source.modelSha256 !== manifest.model.sha256 ||
      (prepared.indoor.source.roomsSha256 !== manifest.floors.sha256 &&
        prepared.indoor.source.roomsSha256 !==
          (await hash(logicalRoomBytes))) ||
      prepared.indoor.source.modelFileName !== model.name
    )
      throw new Error(
        "Prepared indoor data is stale. Compile it again from this model and these reviews.",
      );
    validateReviewedAreaPartitionBinding(parsed, prepared.indoor);
    await validateNativeDisplayScopeBinding(parsed, prepared.indoor);
    await validateNativeSelectionContactBinding(parsed, prepared.indoor);
    await verifyNativeProvisionalCornerSeals(prepared.indoor);
    manifest.version = 2;
    const bytes = strToU8(
      JSON.stringify({
        ...prepared.indoor,
        source: {
          ...prepared.indoor.source,
          roomsSha256: manifest.floors.sha256,
        },
      }),
    );
    if (bytes.length > limits["viewer/indoor.json"])
      throw new Error("Indoor dataset exceeds the package limit.");
    manifest.indoor = await describe("viewer/indoor.json", bytes);
    files[manifest.indoor.path] = bytes;
    if (prepared.scene) {
      if (prepared.scene.length > limits["model/scene.glb"])
        throw new Error("Prepared scene exceeds the package limit.");
      manifest.scene = await describe("model/scene.glb", prepared.scene);
      files[manifest.scene.path] = prepared.scene;
    }
  }
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return new Promise((resolve, reject) =>
    zip(files, { level: 6 }, (err, bytes) =>
      err ? reject(err) : resolve(bytes),
    ),
  );
}

/** Validate every entry before handing anything to the model/floor importers. */
export async function readProjectPackage(bytes: Uint8Array): Promise<{
  model: File;
  roomFile: File;
  sourceRoomFile: File;
  rooms: RoomDirectoryData;
  manifest: ProjectManifest;
  indoor?: IndoorDataset;
  scene?: Uint8Array;
}> {
  if (!bytes.length || bytes.length > MAX_PACKAGE)
    throw new Error("Project ZIP must be non-empty and no larger than 900 MB.");
  const seen = new Set<string>();
  let expanded = 0, displayStored = 0;
  // Scan central-directory sizes without inflating or starting workers first.
  unzipSync(bytes, {
    filter: (entry) => {
      const limit = entryLimit(entry.name);
      if (
        !limit ||
        seen.has(entry.name) ||
        entry.originalSize > limit ||
        !Number.isSafeInteger(entry.originalSize)
      ) {
        throw new Error(
          "Project ZIP contains an unexpected, duplicate, or oversized entry.",
        );
      }
      seen.add(entry.name);
      if (isPreparedDisplayChunkPath(entry.name)) {
        displayStored += entry.originalSize;
        if (displayStored > PREPARED_DISPLAY_ARCHIVE_STORED_LIMIT)
          throw new Error("Prepared display archive exceeds its stored budget.");
      }
      expanded += entry.originalSize;
      if (expanded > MAX_PACKAGE)
        throw new Error("Expanded project exceeds the package limit.");
      return false;
    },
  });
  const files = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (err, result) => (err ? reject(err) : resolve(result)));
  });
  if (!files["manifest.json"])
    throw new Error("This ZIP is missing its Reviter project manifest.");
  const manifest = JSON.parse(
    strFromU8(files["manifest.json"]),
  ) as ProjectManifest;
  if (
    !manifest ||
    manifest.format !== "reviter-project" ||
    ![1, 2].includes(manifest.version) ||
    !safeModelName(manifest.model?.fileName) ||
    !Number.isFinite(manifest.model.lastModified) ||
    typeof manifest.createdAt !== "string" ||
    (manifest.version === 2 && !manifest.indoor) ||
    (manifest.version === 1 && (manifest.indoor || manifest.scene))
  )
    throw new Error("Choose a version 1 or 2 Reviter project ZIP.");
  // Cache checks cover only container metadata/compressed bytes. No cache
  // payload is returned or consulted for the new geometry compilation.
  const displayEntries = validatePreparedDisplayCacheContainer(manifest.preparedDisplay, files);
  const expectedEntries = new Set([
    ...displayEntries,
    "manifest.json",
    manifest.model.path,
    "floors/rooms.json",
    ...(manifest.georeference ? ["gis/reference-points.json"] : []),
    ...(manifest.indoor ? ["viewer/indoor.json"] : []),
    ...(manifest.scene ? ["model/scene.glb"] : []),
    ...(manifest.reviewBundle ? [REVIEW_BUNDLE_ARCHIVE_PATH] : []),
  ]);
  if (Object.keys(files).some((path) => !expectedEntries.has(path)))
    throw new Error("Project ZIP contains files not listed in its manifest.");
  const modelBytes = await verify(
    files,
    manifest.model,
    `model/${manifest.model.fileName}`,
  );
  const roomBytes = await verify(files, manifest.floors, "floors/rooms.json");
  const rooms = parseRoomDirectory(JSON.stringify(await hydrateRoomNativeMaterials(JSON.parse(strFromU8(roomBytes)))));
  await verifyNativeMaterialSections(rooms.nativeMaterialSections, manifest.model.sha256);
  await verifyNativeIndoorEnvelopes(rooms.nativeIndoorEnvelopes, manifest.model.sha256);
  validateNativeDisplayScopes(rooms.nativeDisplayScopes, manifest.model.sha256);
  if (manifest.reviewBundle)
    await verify(files, manifest.reviewBundle, REVIEW_BUNDLE_ARCHIVE_PATH);
  const wire = rooms.reviewBundle as
    | { format?: string; storage?: string }
    | undefined;
  const packed = wire?.format === "openindoormaps-review-bundle-wire";
  if ((packed && wire?.storage === "archive-entry") !== !!manifest.reviewBundle)
    throw new Error(
      "Review bundle archive binding does not match source rooms.",
    );
  if (packed || rooms.reviewBundle !== undefined)
    rooms.reviewBundle = await unpackReviewBundle(rooms.reviewBundle, files);
  assertModelBinding(rooms, manifest.model.fileName);
  if (manifest.georeference) {
    const reference = await verify(
      files,
      manifest.georeference,
      "gis/reference-points.json",
    );
    if (
      JSON.stringify(JSON.parse(strFromU8(reference))) !==
      JSON.stringify(rooms.georeference)
    ) {
      throw new Error("GIS references do not match the saved floor data.");
    }
  } else if (rooms.georeference || files["gis/reference-points.json"]) {
    throw new Error("Project GIS references are missing from the manifest.");
  }
  let indoor: IndoorDataset | undefined, scene: Uint8Array | undefined;
  if (manifest.indoor) {
    indoor = JSON.parse(
      strFromU8(await verify(files, manifest.indoor, "viewer/indoor.json")),
    ) as IndoorDataset;
    if (
      indoor.format !== "reviter-indoor" ||
      indoor.version !== 1 ||
      indoor.source.modelSha256 !== manifest.model.sha256 ||
      indoor.source.roomsSha256 !== manifest.floors.sha256 ||
      indoor.source.modelFileName !== manifest.model.fileName
    )
      throw new Error(
        "Prepared indoor data does not match its model and reviews.",
      );
  }
  if (indoor) {
    validateReviewedAreaPartitionBinding(rooms, indoor);
    await validateNativeDisplayScopeBinding(rooms, indoor);
    await validateNativeSelectionContactBinding(rooms, indoor);
    await verifyNativeProvisionalCornerSeals(indoor);
  }
  if (manifest.scene)
    scene = await verify(files, manifest.scene, "model/scene.glb");
  const roomFile = new File(
    [ownedBuffer(packed ? strToU8(JSON.stringify(rooms)) : roomBytes)],
    "rooms.project.json",
    { type: "application/json" },
  );
  validatedRoomFiles.add(roomFile);
  return {
    model: new File([ownedBuffer(modelBytes)], manifest.model.fileName, {
      lastModified: manifest.model.lastModified,
    }),
    // UI consumers import this File independently of the archive. Hydrate only
    // packed review evidence so those consumers cannot lose its binary payload.
    roomFile,
    sourceRoomFile: new File(
      [ownedBuffer(roomBytes)],
      "rooms.source-wire.json",
      { type: "application/json" },
    ),
    rooms,
    manifest,
    indoor,
    scene,
  };
}

function safeModelName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length <= 255 &&
    !/[\\/\x00-\x1f]/.test(name) &&
    /\.(rvt|rfa|rte|rft)$/i.test(name)
  );
}
function assertModelBinding(rooms: RoomDirectoryData, name: string) {
  if (rooms.georeference && rooms.georeference.modelFileName !== name) {
    throw new Error(
      "GIS references belong to a different Revit model. Open their original model before exporting.",
    );
  }
}
function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ownedBuffer(bytes));
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function describe(path: string, bytes: Uint8Array): Promise<Entry> {
  return { path, bytes: bytes.length, sha256: await hash(bytes) };
}
async function verify(
  files: Unzipped,
  entry: Entry,
  expected: string,
): Promise<Uint8Array> {
  const bytes = files[expected];
  if (
    !entry ||
    entry.path !== expected ||
    !bytes ||
    bytes.length !== entry.bytes ||
    !bytes.length ||
    bytes.length > entryLimit(expected) ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    (await hash(bytes)) !== entry.sha256
  )
    throw new Error(`Project entry is missing or damaged: ${expected}.`);
  return bytes;
}

export const projectPackageName = (modelName: string) =>
  `${modelName.replace(/\.(rvt|rfa|rte|rft)$/i, "")}.reviter.zip`;
