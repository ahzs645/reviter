export const AUTODESK_REFERENCE_FILE = "UNBC Model - 2026-06-30 - FINAL (Fixed Library).rvt";
const AUTODESK_REFERENCE_STEM = AUTODESK_REFERENCE_FILE.replace(/\.rvt$/i, "");

export function hasAutodeskReference(fileName: string): boolean {
  const match = /^(.*?)(?: \((\d+)\))?\.rvt$/i.exec(fileName.trim());
  if (!match) return false;
  // Browsers and cloud-drive downloads conventionally append ` (1)`, ` (2)`,
  // and so on when a same-named file already exists. That suffix does not make
  // the downloaded UNBC model a different derivative source.
  return match[1]!.localeCompare(AUTODESK_REFERENCE_STEM, undefined, { sensitivity: "base" }) === 0;
}
