import { deflateSync } from "fflate";
import { boundedInflate } from "./review-bundle-inflate.ts";
import { verifyNativeMaterialSections } from "./native-material-sections.ts";

const LIMIT = 64 * 1024 * 1024;
const FORMAT = "openindoormaps-native-material-wire";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const fail = () => {
  throw new Error("Invalid packed native material descriptor.");
};
const hash = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const base64 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};

/** Archive representation only. All in-memory geometry remains the original
 * exact Float64 JSON descriptor, verified before packing and after hydration. */
export async function packRoomNativeMaterials<T extends object>(
  rooms: T,
): Promise<T> {
  const value = (rooms as Record<string, unknown>).nativeMaterialSections;
  if (!value) return rooms;
  if ((value as { format?: string }).format === FORMAT) fail();
  await verifyNativeMaterialSections(
    value as Parameters<typeof verifyNativeMaterialSections>[0],
  );
  const raw = encoder.encode(JSON.stringify(value));
  if (raw.length <= 16 * 1024 * 1024) return rooms;
  if (raw.length > LIMIT) fail();
  return {
    ...rooms,
    nativeMaterialSections: {
      format: FORMAT,
      version: 1,
      encoding: "deflate-json-v1",
      bytes: raw.length,
      sha256: await hash(raw),
      compressedBase64: base64(deflateSync(raw, { level: 6 })),
    },
  };
}

export async function hydrateRoomNativeMaterials<T extends object>(
  rooms: T,
): Promise<T> {
  const value = (rooms as Record<string, unknown>).nativeMaterialSections;
  if (!value || (value as { format?: string }).format !== FORMAT) return rooms;
  const wire = value as {
    version: number;
    encoding: string;
    bytes: number;
    sha256: string;
    compressedBase64: string;
  };
  if (
    wire.version !== 1 ||
    wire.encoding !== "deflate-json-v1" ||
    !Number.isSafeInteger(wire.bytes) ||
    wire.bytes < 1 ||
    wire.bytes > LIMIT ||
    !/^[a-f0-9]{64}$/.test(wire.sha256) ||
    typeof wire.compressedBase64 !== "string" ||
    wire.compressedBase64.length > LIMIT * 2 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(wire.compressedBase64)
  )
    fail();
  let compressed: Uint8Array;
  try {
    compressed = Uint8Array.from(atob(wire.compressedBase64), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return fail();
  }
  const raw = boundedInflate(compressed, wire.bytes);
  if ((await hash(raw)) !== wire.sha256) fail();
  let descriptor: Parameters<typeof verifyNativeMaterialSections>[0];
  try {
    descriptor = JSON.parse(decoder.decode(raw));
  } catch {
    return fail();
  }
  await verifyNativeMaterialSections(descriptor);
  return { ...rooms, nativeMaterialSections: descriptor };
}
