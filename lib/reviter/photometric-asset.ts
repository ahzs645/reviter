/** Measured GImposter -> GenericPhotometricLight metadata. This consumes the
 * asset FIFO so the enclosing symbol's physical faces can be decoded. It does
 * not turn a light's influence envelope into drawable geometry.
 */
import { decodeCondInt16PropertyDescriptor, decodeTrf201120260, type CondInt16QueueEntry } from "./dynamic-geometry-queue.ts";
import { registerReleaseMarker, releaseDecodersApply } from "./release-markers.ts";
import type { Revit2027GRepReplayReaderRegistration } from "./revit-2027-grep-replay.ts";

const slots = new Map<string, number>();
for (const [name, index] of Object.entries({ GImposter: 2262, Asset: 425, APropertyBoolean: 44, APropertyEnum: 52, APropertyFloat: 53, APropertyDouble3: 49 })) {
  slots.set(name, registerReleaseMarker(name, index, value => { slots.set(name, value); }));
}

export function addPhotometricAssetReaders(readers: Map<number, Revit2027GRepReplayReaderRegistration>): void {
  for (const [name, slot] of slots) readers.set(slot, { id: name, read(data, context) {
    if (!releaseDecodersApply(context.revitVersion)) return { ok: false, error: "Unsupported asset release" };
    const bytes = data.subarray(0, context.replayEndOffset);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = context.byteOffset;
    const children: CondInt16QueueEntry[] = [];
    const need = (n: number) => { if (at < 0 || at + n > bytes.length) throw new Error("Truncated photometric asset"); };
    const u32 = () => { need(4); const n = view.getUint32(at, true); at += 4; return n; };
    const string = () => {
      const count = u32();
      if (count > 4096) throw new Error("Asset string exceeds bounded layout");
      need(count * 2);
      const value = new TextDecoder("utf-16le").decode(bytes.subarray(at, at + count * 2));
      at += count * 2;
      return value;
    };
    const descriptor = () => {
      const decoded = decodeCondInt16PropertyDescriptor(bytes, at);
      if (!decoded.ok) throw new Error(decoded.error);
      at = decoded.descriptor.endOffset;
      return decoded.descriptor;
    };
    const nullReference = () => {
      const d = descriptor();
      if (d.token !== 0) throw new Error("Unmeasured connected asset reference");
      children.push(d);
    };
    try {
      if (name === "GImposter") {
        need(122);
        const trf = decodeTrf201120260(bytes, at + 20);
        if (!trf.ok) return trf;
        at += 116;
        const d = descriptor();
        if (d.token !== -1 || d.sourceClassSlot !== slots.get("Asset")) throw new Error("GImposter needs retained Asset");
        children.push(d);
      } else {
        const propertyName = string();
        nullReference();
        if (u32() !== 0) throw new Error("Unmeasured connected property list");
        if (name === "Asset") {
          if (propertyName !== "GenericPhotometricLight") throw new Error("Unmeasured imposter asset type");
          const count = u32();
          if (count > 64) throw new Error("Photometric property count exceeds measured layout");
          const propertySlots = new Set([...slots].filter(([n]) => n.startsWith("AProperty")).map(([, s]) => s));
          for (let i = 0; i < count; i++) {
            const d = descriptor();
            if (d.token !== -1 || !propertySlots.has(d.sourceClassSlot!)) throw new Error("Unsupported photometric property class");
            children.push(d);
          }
          if (string() !== "assetlibrary_base.fbx" || string() !== "") throw new Error("Unmeasured photometric library/scene");
          nullReference();
          if (u32() !== 3) throw new Error("Unmeasured photometric asset kind");
        } else {
          const width = name === "APropertyBoolean" ? 1 : name === "APropertyDouble3" ? 24 : 4;
          need(width);
          if (name === "APropertyBoolean" && view.getUint8(at) > 1) throw new Error("Invalid asset boolean");
          if (name === "APropertyFloat" && !Number.isFinite(view.getFloat32(at, true))) throw new Error("Nonfinite asset value");
          if (name === "APropertyDouble3") for (let i = 0; i < 3; i++) if (!Number.isFinite(view.getFloat64(at + i * 8, true))) throw new Error("Nonfinite asset vector");
          at += width;
        }
      }
      return { ok: true, startOffset: context.byteOffset, endOffset: at, appendedProperties: children, value: { metadataOnly: true } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  } });
}
