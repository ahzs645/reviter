import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync, zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import {
  serializeRoomsForArchive,
  REVIEW_BUNDLE_ARCHIVE_PATH,
} from "../lib/reviter/review-bundle-wire.ts";
import {
  createProjectPackage,
  readProjectPackage,
  isValidatedProjectRoomFile,
} from "../lib/reviter/project-package.ts";
import type { RoomDirectoryData } from "../lib/reviter/room-directory.ts";

const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const raw = strToU8("Recorded source wall/cap evidence. ".repeat(8000));
const bundle = {
  version: 1 as const,
  masterSha256: "a".repeat(64),
  files: [
    {
      path: "review/evidence.json",
      bytes: raw.length,
      sha256: digest(raw),
      compressedBase64: Buffer.from(deflateSync(raw, { level: 0 })).toString(
        "base64",
      ),
    },
  ],
};
const rooms: RoomDirectoryData & { reviewBundle: typeof bundle } = {
  format: "reviter-room-annotations",
  version: 1,
  coordinateSystem: "revit-model-feet",
  model: { fileName: "source.rvt" },
  annotations: [
    {
      key: "a",
      levelId: 1,
      label: "Office",
      polygonFeet: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      labelPointFeet: [5, 5],
      confidence: 1,
    },
  ],
  reviewBundle: bundle,
};
const model = new File(["original source bytes"], "source.rvt", {
  lastModified: 123,
});
function bindFloors(
  files: Record<string, Uint8Array>,
  manifest: Record<string, any>,
  bytes: Uint8Array,
) {
  files["floors/rooms.json"] = bytes;
  manifest.floors = {
    path: "floors/rooms.json",
    bytes: bytes.length,
    sha256: digest(bytes),
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
}

test("binary review evidence reopens as exact standalone rooms and preserves source wire bytes", async () => {
  const legacy = await createProjectPackage(model, {
    ...rooms,
    reviewBundle: undefined,
  });
  const files: Record<string, Uint8Array> = unzipSync(legacy);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  const packed = await serializeRoomsForArchive(rooms, 1200);
  assert.ok(packed.reviewEntry);
  files[REVIEW_BUNDLE_ARCHIVE_PATH] = packed.reviewEntry.bytes;
  manifest.reviewBundle = {
    path: REVIEW_BUNDLE_ARCHIVE_PATH,
    bytes: packed.reviewEntry.bytes.length,
    sha256: packed.reviewEntry.sha256,
  };
  bindFloors(files, manifest, packed.rooms);
  const restored = await readProjectPackage(zipSync(files));
  assert.equal(isValidatedProjectRoomFile(restored.roomFile), true);
  assert.equal(isValidatedProjectRoomFile(restored.sourceRoomFile), false);
  assert.equal(
    isValidatedProjectRoomFile(
      new File([await restored.roomFile.arrayBuffer()], restored.roomFile.name),
    ),
    false,
  );
  assert.equal(
    isValidatedProjectRoomFile(
      Object.assign(new File(["{}"], "fake.json"), { validated: true }),
    ),
    false,
  );
  assert.deepEqual(restored.rooms.reviewBundle, bundle);
  assert.deepEqual(
    JSON.parse(await restored.roomFile.text()).reviewBundle,
    bundle,
  );
  assert.deepEqual(
    new Uint8Array(await restored.sourceRoomFile.arrayBuffer()),
    packed.rooms,
  );
  assert.deepEqual(
    new Uint8Array(await restored.model.arrayBuffer()),
    new Uint8Array(await model.arrayBuffer()),
  );
  const reopened = await readProjectPackage(
    await createProjectPackage(restored.model, restored.rooms),
  );
  assert.deepEqual(reopened.rooms, rooms);
  assert.equal(reopened.manifest.reviewBundle, undefined);
  const damaged = {
    ...files,
    [REVIEW_BUNDLE_ARCHIVE_PATH]: files[REVIEW_BUNDLE_ARCHIVE_PATH].slice(),
  };
  damaged[REVIEW_BUNDLE_ARCHIVE_PATH][0] ^= 1;
  await assert.rejects(
    readProjectPackage(zipSync(damaged)),
    /missing or damaged/,
  );
  const wrong = { ...files };
  const badRooms = JSON.parse(strFromU8(packed.rooms));
  badRooms.reviewBundle.path = "review/other.bin";
  bindFloors(
    wrong,
    structuredClone(manifest),
    strToU8(JSON.stringify(badRooms)),
  );
  await assert.rejects(readProjectPackage(zipSync(wrong)), /packed review/);
  const fake = { ...files };
  bindFloors(
    fake,
    structuredClone(manifest),
    strToU8(
      JSON.stringify({
        ...rooms,
        reviewBundle: { ...bundle, storage: "archive-entry" },
      }),
    ),
  );
  await assert.rejects(readProjectPackage(zipSync(fake)), /binding/);
  await assert.rejects(
    readProjectPackage(zipSync({ ...files, "review/unlisted.bin": raw })),
    /unexpected/,
  );
});

test("review container serialization is deterministic and legacy archives remain unchanged", async () => {
  const a = await serializeRoomsForArchive(rooms, 1200),
    b = await serializeRoomsForArchive(rooms, 1200);
  assert.deepEqual(a, b);
  const reopened = await readProjectPackage(
    await createProjectPackage(model, rooms),
  );
  assert.deepEqual(reopened.rooms, rooms);
  assert.deepEqual(
    new Uint8Array(await reopened.sourceRoomFile.arrayBuffer()),
    strToU8(JSON.stringify(rooms)),
  );
});

test("legacy companion SHA, truncation and dishonest expansion fail reader and writer", async () => {
  const archive = await createProjectPackage(model, rooms);
  for (const file of [
    { ...bundle.files[0], sha256: "0".repeat(64) },
    {
      ...bundle.files[0],
      compressedBase64: bundle.files[0].compressedBase64.slice(0, 12),
    },
    { ...bundle.files[0], bytes: 0, sha256: digest(new Uint8Array()) },
  ]) {
    const invalid = { ...rooms, reviewBundle: { ...bundle, files: [file] } };
    await assert.rejects(createProjectPackage(model, invalid), /packed review/);
    const files = unzipSync(archive),
      manifest = JSON.parse(strFromU8(files["manifest.json"]));
    bindFloors(files, manifest, strToU8(JSON.stringify(invalid)));
    await assert.rejects(readProjectPackage(zipSync(files)), /packed review/);
  }
});
