import { Inflate } from "fflate";
const MAX_CONTAINER = 129 * 1024 * 1024;
const fail = () => {
  throw new Error("Invalid packed review companion container.");
};
/** Streaming output count guards prevent an expansion beyond the declared bound. */
export function boundedInflate(bytes: Uint8Array, expected: number) {
  if (
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    expected > MAX_CONTAINER
  )
    return fail();
  const out = new Uint8Array(expected);
  let count = 0,
    finished = false;
  const stream = new Inflate((chunk, final) => {
    if (count + chunk.length > expected) fail();
    out.set(chunk, count);
    count += chunk.length;
    finished = final;
  });
  // A DEFLATE block can expand far beyond its input. Feed bounded chunks so the
  // output callback can reject an overrun before the next block is expanded.
  try {
    if (!bytes.length) stream.push(bytes, true);
    for (let i = 0; i < bytes.length; i += 1024)
      stream.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
  } catch {
    return fail();
  }
  if (!finished || count !== expected) return fail();
  return out;
}
