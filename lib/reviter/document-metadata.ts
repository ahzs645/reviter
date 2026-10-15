/**
 * Browser-only identity inventory, following rvt-rs metadata.rs and
 * project_information.rs at 1c3d337 (Apache-2.0; docs/third-party/rvt-rs).
 * Reuses Reviter's measured BasicFileInfo/Atom readers. No partition is inflated
 * and no archive entry name, source XML, local path or user name is returned.
 */
import CFB from "cfb";
import { Inflate } from "fflate";
import { parseBasicFileInfoProperties, revitVersionFromBasicFileInfo } from "./basic-file-info.ts";
import { parsePartAtomXml, type PartAtomMetadata } from "./part-atom.ts";
import { asBytes } from "./revit-container.ts";
import type { PartitionName } from "./partition-names.ts";

export const DOCUMENT_IDENTITY_STREAM_LIMIT = 4 * 1024 * 1024;
export type DocumentMetadataStreams = {
  basicFileInfo?: Uint8Array;
  partAtom?: Uint8Array;
  projectInformation?: Uint8Array;
};
export type DocumentMetadata = {
  source: "BasicFileInfo+document-Atom";
  status: "decoded" | "missing-basic-file-info" | "unsupported-basic-file-info";
  revitVersion: number | null;
  build?: string;
  locale?: string;
  worksharing?: string;
  workshared?: boolean;
  title?: string;
  lastSaved?: string;
  documentGuid?: string;
  documentIncrements?: number;
  singleUserCloudModel?: boolean;
  atomSource?: "PartAtom" | "ProjectInformation";
  /** PartitionTable names alone prove neither worksets nor their membership. */
  partitionNames: Array<{ name: string; offset: number; kind: "unclassified-partition-name" }>;
  projectParameters: Array<{ feature?: string; group?: string; name: string; parameterId?: string; parameterType?: string; units?: string; value: string }>;
  warnings: string[];
};

/**
 * Read the first ZIP local entry without requiring a central directory or
 * sizes from streaming ZIP writers. Only stored/raw-deflate methods are read.
 * Output is bounded while inflating; metadata never surfaces the temp filename.
 */
export function parseProjectInformationLocalEntry(archive: Uint8Array): PartAtomMetadata | undefined {
  if (archive.length < 30 || archive.length > DOCUMENT_IDENTITY_STREAM_LIMIT) return undefined;
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50 || (view.getUint16(6, true) & 1)) return undefined;
  const method = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const at = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  if (at > archive.length) return undefined;
  let body: Uint8Array;
  try {
    if (method === 0) {
      if (!compressedSize || compressedSize > DOCUMENT_IDENTITY_STREAM_LIMIT || at + compressedSize > archive.length) return undefined;
      body = archive.subarray(at, at + compressedSize);
    } else if (method === 8) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      let complete = false;
      const reader = new Inflate((data, final) => {
        if (data.length > DOCUMENT_IDENTITY_STREAM_LIMIT - total) throw new Error("project-metadata-inflate-limit");
        chunks.push(data); total += data.length; complete ||= final;
      });
      // A 256-byte push also bounds output allocated before each callback.
      for (let offset = at; offset < archive.length && !complete; offset += 256) {
        const end = Math.min(archive.length, offset + 256);
        reader.push(archive.subarray(offset, end), end === archive.length);
      }
      if (!complete) return undefined;
      body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    } else return undefined;
    return parsePartAtomXml(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch { return undefined; }
}

const privateField = /(?:user(?:name)?|author|owner|path|address|e-?mail|phone|central\s*model|last\s*save)/i;
function safeText(value: string | undefined): string | undefined {
  if (!value || /(?:[a-z]:[\\/]|\\\\|file:|\/Users\/|\/home\/|\/tmp\/)/i.test(value)) return undefined;
  return value;
}

/** Decode only small identity streams; sharing-safe values are the default. */
export function readDocumentMetadataStreams(
  streams: DocumentMetadataStreams,
  partitionNames: readonly PartitionName[] = [],
): DocumentMetadata {
  const warnings: string[] = [];
  const admitted = (name: keyof DocumentMetadataStreams) => {
    const bytes = streams[name];
    if (bytes && bytes.length > DOCUMENT_IDENTITY_STREAM_LIMIT) { warnings.push(`${name}: identity-stream-limit`); return undefined; }
    return bytes;
  };
  const basic = admitted("basicFileInfo");
  const version = basic ? revitVersionFromBasicFileInfo(basic) : null;
  const info = basic ? parseBasicFileInfoProperties(basic) : undefined;
  let atom: PartAtomMetadata | undefined;
  let atomSource: DocumentMetadata["atomSource"];
  const partAtom = admitted("partAtom");
  if (partAtom) try {
    atom = parsePartAtomXml(new TextDecoder("utf-8", { fatal: true }).decode(partAtom));
    if (atom) atomSource = "PartAtom";
  } catch { warnings.push("partAtom: malformed-identity-xml"); }
  if (!atom) {
    const project = admitted("projectInformation");
    if (project) {
      atom = parseProjectInformationLocalEntry(project);
      if (atom) atomSource = "ProjectInformation";
      else warnings.push("projectInformation: unreadable-local-entry");
    }
  }
  const projectParameters: DocumentMetadata["projectParameters"] = [];
  for (const feature of atom?.features ?? []) for (const group of feature.groups) for (const parameter of group.parameters) {
    const label = parameter.displayName ?? parameter.name;
    if (privateField.test(label) || privateField.test(parameter.name) || safeText(label) === undefined || (parameter.value !== "" && safeText(parameter.value) === undefined)) continue;
    projectParameters.push({
      ...(safeText(feature.title) ? { feature: feature.title } : {}),
      ...(safeText(group.title) ? { group: group.title } : {}),
      name: label,
      ...(parameter.id ? { parameterId: parameter.id } : {}),
      ...(parameter.parameterType ? { parameterType: parameter.parameterType } : {}),
      ...(parameter.units ? { units: parameter.units } : {}),
      value: parameter.value,
    });
  }
  return {
    source: "BasicFileInfo+document-Atom",
    status: !basic ? "missing-basic-file-info" : version == null ? "unsupported-basic-file-info" : "decoded",
    revitVersion: version,
    ...(safeText(info?.revitBuild ?? info?.build) ? { build: info?.revitBuild ?? info?.build } : {}),
    ...(safeText(info?.locale) ? { locale: info?.locale } : {}),
    ...(safeText(info?.worksharing) ? { worksharing: info?.worksharing, workshared: info?.worksharing !== "Not enabled" } : {}),
    ...(safeText(atom?.entryTitle) ? { title: atom?.entryTitle } : {}),
    ...(safeText(atom?.updated) ? { lastSaved: atom?.updated } : {}),
    ...(safeText(info?.uniqueDocumentGuid) ? { documentGuid: info?.uniqueDocumentGuid } : {}),
    ...(info?.uniqueDocumentIncrements === undefined ? {} : { documentIncrements: info.uniqueDocumentIncrements }),
    ...(info?.isSingleUserCloudModel === undefined ? {} : { singleUserCloudModel: info.isSingleUserCloudModel }),
    ...(atomSource ? { atomSource } : {}),
    partitionNames: partitionNames.filter(entry => safeText(entry.name) !== undefined).map(entry => ({ ...entry, kind: "unclassified-partition-name" })),
    projectParameters, warnings,
  };
}

/**
 * Reuse an already-open CFB container; never request/inflate model partitions.
 * The browser's byte input is already in memory, unlike upstream's seekable CLI.
 */
export function readDocumentMetadataContainer(cfb: ReturnType<typeof CFB.read>, partitionNames: readonly PartitionName[] = []): DocumentMetadata {
  const streams: DocumentMetadataStreams = {};
  const names: Record<string, keyof DocumentMetadataStreams> = {
    basicfileinfo: "basicFileInfo", partatom: "partAtom", projectinformation: "projectInformation",
  };
  for (let index = 0; index < cfb.FileIndex.length; index++) {
    const path = cfb.FullPaths[index] ?? "";
    const name = path.replace(/^Root Entry\//i, "").toLowerCase();
    if (!Object.hasOwn(names, name)) continue;
    const key = names[name]!;
    const entry = cfb.FileIndex[index]!;
    if (!key || entry.size <= 0) continue;
    streams[key] = entry.size > DOCUMENT_IDENTITY_STREAM_LIMIT
      ? new Uint8Array(DOCUMENT_IDENTITY_STREAM_LIMIT + 1)
      : asBytes(entry.content);
  }
  return readDocumentMetadataStreams(streams, partitionNames);
}
