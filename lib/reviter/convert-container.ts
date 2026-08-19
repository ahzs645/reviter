/**
 * Opening the container, and everything the file says about itself outside its
 * partitions.
 *
 * An `.rvt` is an OLE/CFB container of named streams. Most of them are
 * summaries — the release, the element table, the schema, the workset names,
 * the external references — and each is optional: a stream that is absent, or
 * present and undecodable, must leave the conversion running rather than fail
 * it. That is why almost everything here is `undefined`-tolerant.
 *
 * The one stream that is not optional is a partition: with no partition there
 * is no geometry to recover, and the conversion refuses rather than returning
 * an empty model.
 *
 * The release matters more than anything else read here, because it selects the
 * record decoders. It is taken from `BasicFileInfo` unless the caller named a
 * release explicitly, which is the documented way to decode a file whose
 * `BasicFileInfo` is missing or unreadable.
 */
import CFB from "cfb";

import { revitVersionFromBasicFileInfo } from "./basic-file-info.ts";
import { scanObjectMarkers } from "./element-objects.ts";
import { parseElemTable } from "./elem-table.ts";
import { decodeElementOwnership } from "./element-relations.ts";
import {
  decodeRevitDocumentHistory,
  decodeRevitNativeIdentities,
} from "./native-identity.ts";
import { decoderPlanForVersion } from "./native-decoder.ts";
import { parsePartAtomXml } from "./part-atom.ts";
import { parsePartitionNames } from "./partition-names.ts";
import { parseProjectInformationArchive } from "./project-information.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  stripRevitPageChecksums,
} from "./revit-container.ts";
import { summariseSchema } from "./schema.ts";
import { measureStream, summariseCoverage } from "./stream-coverage.ts";
import { parseRevitTransmissionData } from "./transmission-data.ts";

import type { ElementOwnershipDecode } from "./element-relations.ts";
import type { NativeIdentityDecode } from "./native-identity.ts";
import type { PartAtomMetadata } from "./part-atom.ts";
import type { PartitionName } from "./partition-names.ts";
import type { SchemaSummary } from "./schema.ts";
import type { CoverageSummary } from "./stream-coverage.ts";
import type { ConvertOptions, RvtElementIndex } from "./types";
import type { RevitTransmissionData } from "./transmission-data.ts";

/** Pages sampled to learn which object markers this file uses. */
const MARKER_SAMPLE_PAGES = 12;

/** Objects a marker must head across the sample before it is seeded from. */
const MARKER_MIN_SUPPORT = 24;

/** Cap on marker scans per page, so seeding cost stays bounded. */
const MAX_OBJECT_MARKERS = 12;

/**
 * Inflate the first chunk of a named stream and hand it to `decode`. Returns
 * `undefined` when the stream is absent or does not decompress, so an optional
 * stream never fails the conversion.
 */
function readStreamSummary<T>(
  cfb: ReturnType<typeof CFB.read>,
  pattern: RegExp,
  decode: (data: Uint8Array) => T,
): T | undefined {
  const entry = cfb.FileIndex
    .map((candidate, index) => ({ entry: candidate, path: cfb.FullPaths[index] ?? "" }))
    .find(({ entry: candidate, path }) => candidate.size > 0 && pattern.test(path));
  if (!entry) return undefined;
  const bytes = stripRevitPageChecksums(asBytes(entry.entry.content));
  const offset = gzipOffsets(bytes, 1)[0];
  const inflated = offset == null ? null : inflateRevitChunk(bytes, offset);
  return inflated ? decode(inflated) : undefined;
}

/** One CFB entry paired with the full path it is stored under. */
type ContainerEntry = {
  entry: ReturnType<typeof CFB.read>["FileIndex"][number];
  path: string;
};

export type OpenedRevitContainer = {
  cfb: ReturnType<typeof CFB.read>;
  /** Which record decoders this release admits; see `native-decoder.ts`. */
  decoderPlan: ReturnType<typeof decoderPlanForVersion>;
  /** Non-empty partition streams, in container order. Never empty. */
  partitions: ContainerEntry[];
  /** Object markers this file uses often enough to seed the object chain from. */
  objectMarkers: number[];
  partAtom: PartAtomMetadata | undefined;
  elementIndex: RvtElementIndex | undefined;
  elementOwnership: ElementOwnershipDecode | undefined;
  nativeIdentity: NativeIdentityDecode | undefined;
  transmissionData: RevitTransmissionData | undefined;
  coverage: CoverageSummary;
  schema: SchemaSummary | undefined;
  partitionNames: PartitionName[];
};

/**
 * Read the container and its summary streams.
 *
 * @throws when the bytes are not a CFB container, or hold no partition stream.
 */
export function openRevitContainer(
  bytes: Uint8Array,
  options: ConvertOptions,
): OpenedRevitContainer {
  let decoderPlan = decoderPlanForVersion(options.revitVersion);
  const cfb = CFB.read(bytes, { type: "buffer" });
  const partAtomEntry = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .find(({ entry, path }) => entry.size > 0 && /\/PartAtom$/i.test(path));
  let partAtom = partAtomEntry
    ? parsePartAtomXml(new TextDecoder().decode(asBytes(partAtomEntry.entry.content)))
    : undefined;
  if (!partAtom) {
    const projectInformationEntry = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .find(({ entry, path }) => entry.size > 0 && /\/ProjectInformation$/i.test(path));
    if (projectInformationEntry) {
      partAtom = parseProjectInformationArchive(
        asBytes(projectInformationEntry.entry.content),
      );
    }
  }
  if (!Number.isInteger(options.revitVersion)) {
    const basicFileInfo = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .find(({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/i.test(path));
    if (basicFileInfo) {
      decoderPlan = decoderPlanForVersion(
        revitVersionFromBasicFileInfo(asBytes(basicFileInfo.entry.content)) ?? undefined,
      );
    }
  }
  const elemTableEntry = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .find(({ entry, path }) => entry.size > 0 && /\/Global\/ElemTable$/i.test(path));
  let elementIndex;
  let elementOwnership: ElementOwnershipDecode | undefined;
  let elementTableData: Uint8Array | undefined;
  if (elemTableEntry) {
    const elemTableBytes = stripRevitPageChecksums(asBytes(elemTableEntry.entry.content));
    const offset = gzipOffsets(elemTableBytes, 1)[0];
    const inflated = offset == null ? null : inflateRevitChunk(elemTableBytes, offset);
    if (inflated) {
      elementTableData = inflated;
      elementIndex = parseElemTable(inflated) ?? undefined;
      const ownership = decodeElementOwnership(inflated);
      if (ownership.format !== "unsupported") elementOwnership = ownership;
    }
  }
  let nativeIdentity: NativeIdentityDecode | undefined;
  if (elementTableData && decoderPlan.revitVersion != null) {
    const history = readStreamSummary(cfb, /\/Global\/History$/i, (data) =>
      decodeRevitDocumentHistory(data, decoderPlan.revitVersion!));
    if (history && history.format !== "unsupported") {
      const identity = decodeRevitNativeIdentities(
        elementTableData,
        history,
        decoderPlan.revitVersion,
      );
      if (identity.format !== "unsupported") nativeIdentity = identity;
    }
  }
  const transmissionEntry = cfb.FileIndex
    .map((entry, index) => ({
      entry,
      path: cfb.FullPaths[index] ?? "",
    }))
    .find(
      ({ entry, path }) =>
        entry.size > 0 && /\/TransmissionData$/i.test(path),
    );
  const decodedTransmissionData = transmissionEntry
    ? parseRevitTransmissionData(asBytes(transmissionEntry.entry.content))
    : undefined;
  const uniqueIdByElement = new Map(
    nativeIdentity?.identities.map((identity) => [
      identity.elementId,
      identity.uniqueId,
    ]) ?? [],
  );
  const transmissionData = decodedTransmissionData
    ? {
        ...decodedTransmissionData,
        references: decodedTransmissionData.references.map((reference) => ({
          ...reference,
          ...(uniqueIdByElement.get(reference.elementId)
            ? { uniqueId: uniqueIdByElement.get(reference.elementId) }
            : {}),
        })),
      }
    : undefined;
  const coverage = summariseCoverage(
    cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      // Streams only. A CFB storage reports the size of the mini-stream it
      // holds, so the root passes a size test, strips to an empty path, matches
      // no rule, and lands in the coverage table as a blank "Not recognised"
      // row — a stream the file does not have, graded as undecoded.
      .filter(({ entry }) => entry.type === 2 && entry.size > 0)
      .map(({ entry, path }) =>
        measureStream(path.replace(/^Root Entry\//, ""), asBytes(entry.content)),
      ),
  );

  const schema = readStreamSummary(cfb, /\/Formats\/Latest$/i, summariseSchema);
  const partitionNames = readStreamSummary(cfb, /\/Global\/PartitionTable$/i, parsePartitionNames) ?? [];

  const partitions = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .filter(({ entry, path }) => entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path));

  if (!partitions.length) throw new Error("No Revit partition stream was found.");

  // Learn which object markers this file actually uses, from a sample of its
  // pages, so seeding is not limited to the one class the bounds decoder
  // happens to look for. Calibrating on a sample keeps the byte-by-byte scan
  // off the other 3,300 pages.
  const objectMarkers: number[] = [];
  if (decoderPlan.elementBoundsDecoder) {
    const sampleCounts = new Map<number, number>();
    const samplePartition = partitions[0]!;
    const sampleData = stripRevitPageChecksums(asBytes(samplePartition.entry.content));
    const sampleOffsets = gzipOffsets(sampleData);
    const stride = Math.max(1, Math.floor(sampleOffsets.length / MARKER_SAMPLE_PAGES));
    for (let index = 0; index < sampleOffsets.length; index += stride) {
      const page = inflateRevitChunk(sampleData, sampleOffsets[index]!, sampleOffsets[index + 1]);
      if (!page) continue;
      for (const [marker, count] of scanObjectMarkers(page)) {
        sampleCounts.set(marker, (sampleCounts.get(marker) ?? 0) + count);
      }
    }
    objectMarkers.push(
      ...[...sampleCounts]
        .filter(([, count]) => count >= MARKER_MIN_SUPPORT)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_OBJECT_MARKERS)
        .map(([marker]) => marker),
    );
  }

  return {
    cfb,
    decoderPlan,
    partitions,
    objectMarkers,
    partAtom,
    elementIndex,
    elementOwnership,
    nativeIdentity,
    transmissionData,
    coverage,
    schema,
    partitionNames,
  };
}
