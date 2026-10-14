/** Inventory native MEP evidence without changing or converting model geometry. */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { unzipSync, gunzipSync } from "fflate";
import { openRevitContainer } from "../lib/reviter/convert-container.ts";
import { scanContainerNativeMep } from "../lib/reviter/native-mep.ts";

const args = process.argv.slice(2);
const referenceAt = args.indexOf("--reference-svf");
const referenceSvf = referenceAt < 0 ? undefined : args.splice(referenceAt, 2)[1];
if (referenceAt >= 0 && (!referenceSvf || args.length !== 1)) throw new Error("Use --reference-svf <svf.zip> with exactly one RVT path");

function referenceSystems(path: string): Map<number, string | undefined> {
  const zip = unzipSync(readFileSync(path));
  const json = <T>(kind: string): T => {
    const file = Object.keys(zip).find((p) => p.endsWith(`objects_${kind}.json.gz`));
    if (!file) throw new Error(`Missing SVF properties: ${kind}`);
    return JSON.parse(new TextDecoder().decode(gunzipSync(zip[file]!))) as T;
  };
  const attrs = json<Array<unknown>>("attrs"), values = json<unknown[]>("vals"),
    offsets = json<number[]>("offs"), avs = json<number[]>("avs");
  const result = new Map<number, string | undefined>();
  for (let i = 1; i < offsets.length; i += 1) {
    const props = new Map<string, unknown>();
    for (let p = offsets[i]! * 2; p < (offsets[i + 1] ?? avs.length / 2) * 2; p += 2) {
      const attr = attrs[avs[p]!];
      if (Array.isArray(attr)) props.set(String(attr[0]), values[avs[p + 1]!]);
    }
    const categoryId = Number(props.get("CategoryId")), elementId = Number(props.get("ElementId"));
    if (![-2008037, -2008015, -2008043].includes(categoryId) || !Number.isSafeInteger(elementId) || elementId <= 0) continue;
    const name = categoryId === -2008037 ? props.get("Circuit Number") : props.get("System Name");
    result.set(elementId, typeof name === "string" ? name : undefined);
  }
  return result;
}

for (const path of args) {
  const started = performance.now();
  const bytes = readFileSync(path);
  const container = openRevitContainer(bytes, {});
  // This metadata-only audit deliberately supplies no geometry/category records.
  // Membership and connector coverage require a full conversion and are not
  // measured here; the returned layout status alone is never a parity claim.
  const mep = scanContainerNativeMep(container, []);
  const reference = referenceSvf ? referenceSystems(referenceSvf) : undefined;
  const held = new Map(mep.systems.map((s) => [s.elementId, s.name]));
  console.log(JSON.stringify({
    fileName: basename(path), byteLength: bytes.length, revitVersion: mep.revitVersion,
    schemaClasses: container.schema?.taggedClasses.length ?? 0,
    systems: mep.systems.map(({ elementId, className, name, evidence }) => ({ elementId, className, name, nativeRecords: evidence.length })),
    coverage: mep.coverage,
    membershipAndConnectionParity: "not-measured-metadata-only-audit",
    pairedSystemInventory: reference && {
      source: basename(referenceSvf!), referenceSystems: reference.size, nativeSystems: held.size,
      identityMatches: [...reference.keys()].filter((id) => held.has(id)).length,
      nameMatches: [...reference].filter(([id, name]) => held.has(id) && name === held.get(id)).length,
      missingNativeIds: [...reference.keys()].filter((id) => !held.has(id)),
      missingReferenceIds: [...held.keys()].filter((id) => !reference.has(id)),
    },
    elapsedSeconds: Math.round((performance.now() - started) / 10) / 100,
  }));
}
