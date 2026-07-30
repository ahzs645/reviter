/**
 * The Revit release stored in the uncompressed `BasicFileInfo` CFB stream.
 *
 * Reviter's browser UI already reads this through `@phi-ag/rvt`, but the
 * reusable converter accepts bytes directly. Keeping the tiny release read in
 * the core means `convertRvtBytes(bytes)` can select its release-gated decoder
 * without making every caller parse the container a second way first.
 */

const UTF16 = new TextDecoder("utf-16le");
const MIN_REVIT_VERSION = 2000;
const MAX_REVIT_VERSION = 2099;

export type BasicFileInfoProperties = {
  fileInfoVersion: number;
  format?: number;
  build?: string;
  revitBuild?: string;
  architecture?: string;
  locale?: string;
  worksharing?: string;
  username?: string;
  centralModelPath?: string;
  lastSavePath?: string;
  openWorksetDefault?: number;
  projectSparkFile?: boolean;
  centralModelIdentity?: string;
  allLocalChangesSavedToCentral?: boolean;
  centralModelVersion?: number;
  centralModelEpisodeGuid?: string;
  uniqueDocumentGuid?: string;
  uniqueDocumentIncrements?: number;
  modelIdentity?: string;
  isSingleUserCloudModel?: boolean;
  author?: string;
  clientAppName?: string;
  properties: Record<string, string>;
};

function release(value: string): number | null {
  const match = value.match(/\b(20\d{2})\b/);
  if (!match) return null;
  const version = Number(match[1]);
  return version >= MIN_REVIT_VERSION && version <= MAX_REVIT_VERSION ? version : null;
}

/**
 * Parse the Revit release from a `BasicFileInfo` stream.
 *
 * Legacy file-info versions 6–10 store a length-prefixed application string
 * beginning at byte 14. Versions 13 and 14 introduce the release with the
 * four-byte marker `04 00 00 00`, followed by four UTF-16LE characters.
 */
export function revitVersionFromBasicFileInfo(data: Uint8Array): number | null {
  if (data.byteLength < 18) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fileInfoVersion = view.getUint32(0, true);

  if (fileInfoVersion >= 6 && fileInfoVersion <= 10) {
    const characters = view.getInt32(14, true);
    if (characters <= 0 || characters > (data.byteLength - 18) / 2) return null;
    return release(UTF16.decode(data.subarray(18, 18 + characters * 2)));
  }

  if (fileInfoVersion !== 13 && fileInfoVersion !== 14) return null;
  for (let offset = 4; offset + 12 <= data.byteLength; offset += 1) {
    if (
      data[offset] !== 0x04 ||
      data[offset + 1] !== 0 ||
      data[offset + 2] !== 0 ||
      data[offset + 3] !== 0
    ) continue;
    const version = release(UTF16.decode(data.subarray(offset + 4, offset + 12)));
    if (version != null) return version;
  }
  return null;
}

function findSequence(data: Uint8Array, sequence: number[]): number {
  outer: for (let offset = 0; offset <= data.length - sequence.length; offset += 1) {
    for (let index = 0; index < sequence.length; index += 1) {
      if (data[offset + index] !== sequence[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function propertyText(data: Uint8Array): string {
  // Legacy and current files introduce the property bag with the single
  // UTF-16 code point U+0A0D, stored as `0d 0a`, after which ordinary UTF-16LE
  // text begins.
  const revitMarker = findSequence(data, [0x0d, 0x0a]);
  if (revitMarker >= 0) {
    return new TextDecoder("utf-16le").decode(data.subarray(revitMarker + 2));
  }
  const littleEndianMarker = findSequence(data, [0x0d, 0, 0x0a, 0]);
  if (littleEndianMarker >= 0) {
    return new TextDecoder("utf-16le").decode(data.subarray(littleEndianMarker + 4));
  }
  const bigEndianMarker = findSequence(data, [0, 0x0d, 0, 0x0a]);
  if (bigEndianMarker >= 0) {
    return new TextDecoder("utf-16be").decode(data.subarray(bigEndianMarker + 4));
  }
  return new TextDecoder().decode(data).replaceAll("\0", "");
}

function integerProperty(properties: Record<string, string>, key: string): number | undefined {
  const value = Number.parseInt(properties[key] ?? "", 10);
  return Number.isInteger(value) ? value : undefined;
}

function booleanProperty(properties: Record<string, string>, key: string): boolean | undefined {
  const value = properties[key]?.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  return undefined;
}

/** Parse the human-readable property tail of `BasicFileInfo`. */
export function parseBasicFileInfoProperties(data: Uint8Array): BasicFileInfoProperties {
  const properties: Record<string, string> = {};
  for (const line of propertyText(data).split(/\r?\n|\r|\u0a0d/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().replace(/^[^\p{L}]*/u, "");
    if (!key || key.length > 160 || /[\u0000-\u001f]/.test(key)) continue;
    properties[key] = line.slice(separator + 1).trim();
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const build = properties.Build || undefined;
  const revitBuild = properties["Revit Build"] || undefined;
  const buildEvidence = revitBuild ?? build;
  const architecture = buildEvidence?.match(/\((x64|x86|arm64)\)/i)?.[1];
  const format = integerProperty(properties, "Format") ??
    (buildEvidence ? release(buildEvidence) ?? undefined : undefined);
  const username = properties.Username || undefined;
  const centralModelPath = properties["Central Model Path"] || undefined;
  const lastSavePath = properties["Last Save Path"] || undefined;

  return {
    fileInfoVersion: data.byteLength >= 4 ? view.getUint32(0, true) : 0,
    ...(format != null ? { format } : {}),
    ...(build ? { build } : {}),
    ...(revitBuild ? { revitBuild } : {}),
    ...(architecture ? { architecture } : {}),
    ...(properties["Locale when saved"] ? { locale: properties["Locale when saved"] } : {}),
    ...(properties.Worksharing ? { worksharing: properties.Worksharing } : {}),
    ...(username ? { username } : {}),
    ...(centralModelPath ? { centralModelPath } : {}),
    ...(lastSavePath ? { lastSavePath } : {}),
    ...(integerProperty(properties, "Open Workset Default") != null
      ? { openWorksetDefault: integerProperty(properties, "Open Workset Default") }
      : {}),
    ...(booleanProperty(properties, "Project Spark File") != null
      ? { projectSparkFile: booleanProperty(properties, "Project Spark File") }
      : {}),
    ...(properties["Central Model Identity"]
      ? { centralModelIdentity: properties["Central Model Identity"] }
      : {}),
    ...(booleanProperty(properties, "All Local Changes Saved To Central") != null
      ? {
          allLocalChangesSavedToCentral: booleanProperty(
            properties,
            "All Local Changes Saved To Central",
          ),
        }
      : {}),
    ...(integerProperty(
      properties,
      "Central model's version number corresponding to the last reload latest",
    ) != null
      ? {
          centralModelVersion: integerProperty(
            properties,
            "Central model's version number corresponding to the last reload latest",
          ),
        }
      : {}),
    ...(properties["Central model's episode GUID corresponding to the last reload latest"]
      ? {
          centralModelEpisodeGuid:
            properties["Central model's episode GUID corresponding to the last reload latest"],
        }
      : {}),
    ...(properties["Unique Document GUID"]
      ? { uniqueDocumentGuid: properties["Unique Document GUID"] }
      : {}),
    ...(integerProperty(properties, "Unique Document Increments") != null
      ? { uniqueDocumentIncrements: integerProperty(properties, "Unique Document Increments") }
      : {}),
    ...(properties["Model Identity"] ? { modelIdentity: properties["Model Identity"] } : {}),
    ...(booleanProperty(properties, "IsSingleUserCloudModel") != null
      ? { isSingleUserCloudModel: booleanProperty(properties, "IsSingleUserCloudModel") }
      : {}),
    ...(properties.Author ? { author: properties.Author } : {}),
    ...(properties.ClientAppName ? { clientAppName: properties.ClientAppName } : {}),
    properties,
  };
}

/** Remove local identity and filesystem fields before serialization/export. */
export function redactBasicFileInfoProperties(
  info: BasicFileInfoProperties,
): BasicFileInfoProperties {
  const sensitiveKeys = new Set(["Username", "Central Model Path", "Last Save Path"]);
  const safe = {
    ...info,
    properties: Object.fromEntries(
      Object.entries(info.properties).filter(([key]) => !sensitiveKeys.has(key)),
    ),
  };
  delete safe.username;
  delete safe.centralModelPath;
  delete safe.lastSavePath;
  return safe;
}
