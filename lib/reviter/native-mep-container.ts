/** Container adapter kept outside the compiler's semantic data dependencies. */
import type { OpenedRevitContainer } from "./convert-container.ts";
import type { ElementBoundsRecord } from "./types.ts";
import { asBytes, gzipOffsets, inflateRevitChunk, revitWindowTail, stripRevitPageChecksums } from "./revit-container.ts";
import { nativeMepElementKinds, scanNativeMep, type NativeMepDecode, type NativeMepPage } from "./native-mep.ts";

/** Pipeline adapter; optional semantics never replace Reviter's geometry. */
export function scanContainerNativeMep(container: OpenedRevitContainer, records: readonly ElementBoundsRecord[]): NativeMepDecode {
  const skipped = new Set<string>();
  const readPartitions = function* (): Generator<NativeMepPage> {
    for (const partition of container.partitions) {
      const bytes = stripRevitPageChecksums(asBytes(partition.entry.content));
      const offsets = gzipOffsets(bytes);
      let window: Uint8Array | undefined;
      for (let i = 0; i < offsets.length; i += 1) {
        const page = inflateRevitChunk(bytes, offsets[i]!, offsets[i + 1], window);
        if (!page) { skipped.add(partition.path); break; }
        window = revitWindowTail(page);
        yield { stream: partition.path, bytes: page };
      }
    }
  };
  const result = scanNativeMep({ revitVersion: container.decoderPlan.revitVersion, schema: container.schema, readPartitions, elementKinds: nativeMepElementKinds(records) });
  result.coverage.skippedPartitions = [...skipped].sort();
  return result;
}
