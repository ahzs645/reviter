/** Real CFB/RVT parsing fixture for browser interaction checks; no mocked worker. */
import CFB from "cfb";
import { buildModel, richSpec, CATEGORY } from "../rich-rvt-fixture.ts";

export function interfaceModelBytes(nativeFloors = false): Uint8Array {
  const spec = richSpec(); spec.bulkFloors = 0; spec.datumPileRecords = 0;
  if (nativeFloors) for (let floor = 0; floor < 2; floor++) {
    const levelId = 900_001 + floor;
    spec.relationObjects.push({ elementId: levelId, objectLength: 96, marker: 0x0a19 });
    for (let i = 0; i < 24; i++) {
      const elementId = 1_000_000 + floor * 100 + i, x = 50 + (i % 6) * 12, y = 50 + Math.floor(i / 6) * 12, z = floor * 20;
      spec.boundsA.push({ elementId, categoryId: CATEGORY.floors, recordCode: 80, box: { min: [x, y, z], max: [x + 10, y + 10, z + .6562] } });
      spec.relationObjects.push({ elementId, objectLength: 120, marker: 0x0f3b, fields: [[62, levelId]] });
      if (i === 0) spec.rings.push({ ownerId: elementId, elevation: z, ring: [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10]] });
    }
  }
  const original = buildModel(spec);
  // The UI metadata reader supports CFB v4. Repack the existing decoder
  // fixture into regular 4096-byte sectors, retaining its directory tree.
  const container = CFB.read(original, { type: "array" });
  const sectorSize = 4096, end = 0xfffffffe, free = 0xffffffff;
  const streams = container.FileIndex.map(entry => entry.type === 2 ? new Uint8Array(entry.content as Uint8Array) : null);
  let sectorCount = 4;
  const locations = streams.map(stream => { if (!stream) return null; const count = Math.max(1, Math.ceil(stream.length / sectorSize)), start = sectorCount; sectorCount += count; return { start, count }; });
  if (sectorCount > 1024 || container.FileIndex.length > 32) throw new Error("Interface fixture exceeds its single-FAT/directory budget.");
  const bytes = new Uint8Array((sectorCount + 1) * sectorSize), header = new DataView(bytes.buffer);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  header.setUint16(24, 0x3e, true); header.setUint16(26, 4, true); header.setUint16(28, 0xfffe, true); header.setUint16(30, 12, true); header.setUint16(32, 6, true);
  header.setUint32(40, 1, true); header.setUint32(44, 1, true); header.setUint32(48, 1, true); header.setUint32(56, 4096, true);
  header.setUint32(60, 2, true); header.setUint32(64, 1, true); header.setUint32(68, end, true);
  for (let i = 0; i < 109; i++) header.setUint32(76 + i * 4, i === 0 ? 0 : free, true);
  const fat = new DataView(bytes.buffer, sectorSize, sectorSize);
  for (let i = 0; i < 1024; i++) fat.setUint32(i * 4, free, true);
  fat.setUint32(0, 0xfffffffd, true); fat.setUint32(4, end, true); fat.setUint32(8, end, true); fat.setUint32(12, end, true);
  const miniFat = new DataView(bytes.buffer, sectorSize * 3, sectorSize);
  for (let i = 0; i < 1024; i++) miniFat.setUint32(i * 4, i < 64 ? end : free, true);
  container.FileIndex.forEach((entry, i) => {
    const offset = sectorSize * 2 + i * 128, directory = new DataView(bytes.buffer, offset, 128);
    for (let c = 0; c < entry.name.length; c++) directory.setUint16(c * 2, entry.name.charCodeAt(c), true);
    directory.setUint16(64, (entry.name.length + 1) * 2, true); directory.setUint8(66, entry.type); directory.setUint8(67, 1);
    const tree = entry as typeof entry & { L: number; R: number; C: number };
    directory.setInt32(68, tree.L, true); directory.setInt32(72, tree.R, true); directory.setInt32(76, tree.C, true);
    const stream = streams[i], location = locations[i];
    directory.setUint32(116, entry.type === 5 ? 3 : location?.start ?? end, true);
    if (entry.type === 5) directory.setUint32(120, sectorSize, true);
    if (stream && location) {
      // Small test streams are explicitly padded rather than using a mini-FAT.
      directory.setUint32(120, Math.max(stream.length, sectorSize), true);
      bytes.set(stream, (location.start + 1) * sectorSize);
      for (let s = 0; s < location.count; s++) fat.setUint32((location.start + s) * 4, s + 1 === location.count ? end : location.start + s + 1, true);
    }
  });
  return bytes;
}
