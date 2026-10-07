export type ReviewBundle = {
  version: 1;
  masterSha256: string;
  files: {
    path: string;
    bytes: number;
    sha256: string;
    compressedBase64: string;
  }[];
};
const MAX_FILE = 32 * 1024 * 1024;
export const MAX_REVIEW_FILES = 1000;
// Full authoring masters retain historical evidence alongside current repairs.
// Keep the individual-file/count limits while allowing a bounded growing ledger.
const MAX_TOTAL = 128 * 1024 * 1024;
const safePath = (p: unknown): p is string =>
  typeof p === "string" &&
  p.length < 256 &&
  !p.startsWith("/") &&
  !p.includes("\\") &&
  p.split("/").every((s) => !!s && s !== "." && s !== "..") &&
  /\.(json|md|txt|log|png|jpe?g)$/i.test(p);
export function validateReviewBundle(
  value: unknown,
): asserts value is ReviewBundle | undefined {
  if (value === undefined) return;
  const b = value as ReviewBundle;
  if (
    !b ||
    b.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(b.masterSha256) ||
    !Array.isArray(b.files) ||
    b.files.length > MAX_REVIEW_FILES ||
    b.files.some(
      (f) =>
        !f ||
        !safePath(f.path) ||
        !Number.isSafeInteger(f.bytes) ||
        f.bytes < 0 ||
        f.bytes > MAX_FILE ||
        !/^[a-f0-9]{64}$/.test(f.sha256) ||
        typeof f.compressedBase64 !== "string" ||
        f.compressedBase64.length > MAX_FILE * 2 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(f.compressedBase64),
    ) ||
    new Set(b.files.map((f) => f.path)).size !== b.files.length ||
    b.files.reduce((n, f) => n + f.bytes, 0) > MAX_TOTAL
  )
    throw new Error("Invalid review companion files or size limits.");
}
