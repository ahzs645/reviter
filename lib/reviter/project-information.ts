/**
 * Browser-safe reader for Revit's `ProjectInformation` CFB stream.
 *
 * A reference loader's symbols identify this as the PKZip compression route. Revit
 * writes a small ZIP containing one Atom/PartAtom-shaped `.project.xml` file,
 * so the same metadata parser used for family PartAtom streams can read it.
 */
import { unzipSync } from "fflate";

import { parsePartAtomXml, type PartAtomMetadata } from "./part-atom.ts";

const MAX_PROJECT_XML_BYTES = 4 << 20;

export function parseProjectInformationArchive(
  archive: Uint8Array,
): PartAtomMetadata | undefined {
  if (
    archive.byteLength < 4 ||
    archive[0] !== 0x50 ||
    archive[1] !== 0x4b ||
    archive[2] !== 0x03 ||
    archive[3] !== 0x04
  ) {
    return undefined;
  }

  try {
    const files = unzipSync(archive, {
      filter: ({ name, originalSize }) =>
        /\.project\.xml$/i.test(name) &&
        originalSize > 0 &&
        originalSize <= MAX_PROJECT_XML_BYTES,
    });
    const entry = Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .find(([name]) => /\.project\.xml$/i.test(name));
    if (!entry) return undefined;
    return parsePartAtomXml(new TextDecoder().decode(entry[1]));
  } catch {
    return undefined;
  }
}
