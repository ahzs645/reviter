/**
 * Which model the bundled Autodesk derivative is a derivative *of*.
 *
 * `public/autodesk-reference.glb` was converted from one specific Revit model
 * by Autodesk's own service. Offering it for any other file would put a
 * different building on screen under that file's name, so the studio has to
 * decide whether the file just opened is that model.
 *
 * It used to decide by **file name**. That is not an identity: renaming the
 * file turned the reference off, and naming an unrelated model
 * `UNBC Model - 2026-06-30 - FINAL (Fixed Library).rvt` turned it on and drew
 * this building over that one. A name is metadata a user controls; it says
 * nothing about the bytes.
 *
 * Revit already writes an identity into the file. `BasicFileInfo` carries a
 * `Unique Document GUID`, which `@phi-ag/rvt` surfaces as `FileInfo.documentId`
 * and which the studio already reads and displays for every model it opens. It
 * is stable across renames and copies and distinct per document, which is
 * exactly the question being asked, and matching on it costs no extra decoding.
 *
 * The name is kept only as a fallback for files whose `BasicFileInfo` is too
 * old for the document GUID to be read at all — the legacy path in the studio
 * returns an empty `documentId` — because there the name is the only evidence
 * left, and it beats dropping the reference entirely.
 */

/** The derivative's source file name, used to label it and to name the asset. */
export const AUTODESK_REFERENCE_FILE = "UNBC Model - 2026-06-30 - FINAL (Fixed Library).rvt";

/**
 * `BasicFileInfo` → `Unique Document GUID` of the model the derivative is of.
 *
 * Read from the file itself, not transcribed from a name. The document's save
 * counter (`uniqueDocumentIncrements`, 326 on the copy this was read from) is
 * deliberately *not* part of the match: it changes on every save, and pinning
 * to one save would drop the reference the first time the model was opened and
 * re-saved, which is not what "is this that model" means.
 */
export const AUTODESK_REFERENCE_DOCUMENT_ID = "7e867cd2-c870-46d7-a0d9-01f826e0fc24";

const AUTODESK_REFERENCE_STEM = AUTODESK_REFERENCE_FILE.replace(/\.rvt$/i, "");

/** True when `fileName` is the derivative's source name, allowing ` (1)` copies. */
function nameMatchesReference(fileName: string): boolean {
  const match = /^(.*?)(?: \((\d+)\))?\.rvt$/i.exec(fileName.trim());
  if (!match) return false;
  // Browsers and cloud-drive downloads conventionally append ` (1)`, ` (2)`,
  // and so on when a same-named file already exists. That suffix does not make
  // the downloaded model a different derivative source.
  return match[1]!.localeCompare(AUTODESK_REFERENCE_STEM, undefined, { sensitivity: "base" }) === 0;
}

/**
 * True when the opened file is the model the bundled derivative was built from.
 *
 * Pass the `documentId` the studio already read from `BasicFileInfo`. When it
 * is present it decides the answer on its own — a matching name cannot rescue a
 * different document, and a different name cannot disqualify the right one.
 */
export function hasAutodeskReference(
  identity: { documentId?: string; fileName?: string } | string,
): boolean {
  // A bare string is the old, name-only call. It is kept for the preview route,
  // which has a name and no file to read an identity out of.
  if (typeof identity === "string") return nameMatchesReference(identity);

  const documentId = identity.documentId?.trim();
  if (documentId) {
    return documentId.localeCompare(
      AUTODESK_REFERENCE_DOCUMENT_ID,
      undefined,
      { sensitivity: "base" },
    ) === 0;
  }
  return identity.fileName ? nameMatchesReference(identity.fileName) : false;
}
