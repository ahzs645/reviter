import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "fflate";
import CFB from "cfb";
import { DOCUMENT_IDENTITY_STREAM_LIMIT, parseProjectInformationLocalEntry, readDocumentMetadataStreams, readDocumentMetadataContainer } from "../lib/reviter/document-metadata.ts";

const atom = `<entry xmlns="http://www.w3.org/2005/Atom" xmlns:A="urn:schemas-autodesk-com:partatom"><title>Tower</title><updated>2026-10-14T00:00:00Z</updated><A:features><A:feature><A:title>Project Information</A:title><A:group><A:title>Identity</A:title><A:ProjectNumber displayName="Project Number" id="-1006101">P-42</A:ProjectNumber><A:Author>Alice</A:Author><A:LocalFile>C:\\Users\\Alice\\Tower.rvt</A:LocalFile></A:group></A:feature></A:features></entry>`;
function localZip(xml: string, method: number, descriptor = false) {
  const name = Buffer.from("C:\\Users\\Alice\\Temp\\Tower.project.xml");
  const body = method === 0 ? Buffer.from(xml) : Buffer.from(deflateSync(Buffer.from(xml)));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(descriptor ? 8 : 0, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(descriptor ? 0 : body.length, 18);
  header.writeUInt32LE(descriptor ? 0 : Buffer.byteLength(xml), 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, body, descriptor ? Buffer.from("PK\x07\x08") : Buffer.alloc(0)]);
}
function info() {
  const buffer = Buffer.alloc(16);
  buffer.writeUInt32LE(14); buffer.writeUInt32LE(4, 4); Buffer.from("2025", "utf16le").copy(buffer, 8);
  return Buffer.concat([buffer, Buffer.from([13, 10]), Buffer.from("Format: 2025\r\nBuild: 20240608_1515(x64)\r\nWorksharing: Not enabled\r\nUsername: Alice\r\nLast Save Path: C:\\Users\\Alice\\Tower.rvt\r\nUnique Document GUID: abc\r\nUnique Document Increments: 42\r\nIsSingleUserCloudModel: False", "utf16le")]);
}

test("project metadata reads stored and descriptor-only ZIP local entries without revealing archive filenames", () => {
  for (const bytes of [localZip(atom, 0), localZip(atom, 8), localZip(atom, 8, true)]) {
    assert.equal(parseProjectInformationLocalEntry(bytes)?.entryTitle, "Tower");
    const summary = readDocumentMetadataStreams({ basicFileInfo: info(), projectInformation: bytes });
    assert.equal(summary.status, "decoded");
    assert.equal(summary.revitVersion, 2025);
    assert.equal(summary.workshared, false);
    assert.equal(summary.documentIncrements, 42);
    assert.equal(summary.singleUserCloudModel, false);
    assert.equal(summary.atomSource, "ProjectInformation");
    assert.deepEqual(summary.projectParameters.map(row => [row.name, row.value]), [["Project Number", "P-42"]]);
    assert.ok(!JSON.stringify(summary).includes("Alice"));
    assert.ok(!JSON.stringify(summary).includes("Users"));
  }
});

test("metadata uses the root entry title, not a nested project group title", () => {
  assert.equal(readDocumentMetadataStreams({ partAtom: Buffer.from(atom) }).title, "Tower");
  assert.equal(readDocumentMetadataStreams({ partAtom: Buffer.from(atom) }).status, "missing-basic-file-info");
  const summary = readDocumentMetadataStreams({ basicFileInfo: info(), partAtom: Buffer.from("broken"), projectInformation: localZip(atom, 8) });
  assert.equal(summary.atomSource, "ProjectInformation");
});

test("partition names remain unclassified and native family filesystem paths stay private", () => {
  const summary = readDocumentMetadataStreams({ basicFileInfo: info() }, [{ name: "Shared Levels", offset: 4 }, { name: "C:\\Users\\Alice\\Family.rfa", offset: 88 }]);
  assert.deepEqual(summary.partitionNames, [{ name: "Shared Levels", offset: 4, kind: "unclassified-partition-name" }]);
});

test("identity limits are enforced on actual decompressed bytes and malformed ZIP input", () => {
  const oversized = localZip(`<entry><title>${"A".repeat(DOCUMENT_IDENTITY_STREAM_LIMIT + 1)}</title></entry>`, 8, true);
  assert.equal(parseProjectInformationLocalEntry(oversized), undefined);
  for (const bytes of [Buffer.alloc(0), Buffer.from("PK\x03\x04"), localZip(atom, 12), localZip(atom, 8).subarray(0, 33)]) assert.equal(parseProjectInformationLocalEntry(bytes), undefined);
  const encrypted = localZip(atom, 8); encrypted.writeUInt16LE(1, 6);
  assert.equal(parseProjectInformationLocalEntry(encrypted), undefined);
  const infoLimit = readDocumentMetadataStreams({ basicFileInfo: new Uint8Array(DOCUMENT_IDENTITY_STREAM_LIMIT + 1) });
  assert.ok(infoLimit.warnings.includes("basicFileInfo: identity-stream-limit"));
});

test("container inventory ignores model partitions and reads only identity streams", () => {
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "BasicFileInfo", info());
  CFB.utils.cfb_add(cfb, "ProjectInformation", localZip(atom, 8, true));
  CFB.utils.cfb_add(cfb, "Partitions/0", Buffer.from("unreadable partition deliberately"));
  assert.equal(readDocumentMetadataContainer(cfb).title, "Tower");
});
