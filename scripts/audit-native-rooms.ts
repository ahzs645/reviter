/** Compare independent RVT Room evidence with the paired Autodesk SVF database.
 * Usage: node --experimental-strip-types --import ./scripts/register-local-typescript.mjs scripts/audit-native-rooms.ts model.rvt capture-svf.zip report.json
 * This audits source rooms only; it does not create indoor review/navigation.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, unzipSync } from 'fflate';
import { convertRvtBytes } from '../lib/reviter/convert.ts';

const [rvtPath, svfPath, outPath] = process.argv.slice(2);
if (!rvtPath || !svfPath || !outPath) throw new Error('Expected RVT path, paired SVF ZIP path and output JSON path');
const result = convertRvtBytes(new Uint8Array(readFileSync(rvtPath)), rvtPath);
if (!result.ok) throw new Error(JSON.stringify(result));
const entries = unzipSync(new Uint8Array(readFileSync(svfPath)));
const json = (kind: string) => {
  const name = Object.keys(entries).find(name => name.endsWith(`objects_${kind}.json.gz`));
  if (!name) throw new Error(`Missing ${kind} property database`);
  return JSON.parse(new TextDecoder().decode(gunzipSync(entries[name])));
};
const attrs = json('attrs') as (number | (string | number | null)[])[], ids = json('ids') as (number | string)[], offsets = json('offs') as number[], avs = json('avs') as number[], values = json('vals') as unknown[];
const reference = new Map<number, { name?: string; number?: string; areaSquareFeet?: number }>();
for (let db = 0; db < ids.length; db++) {
  const uniqueId = ids[db];
  if (typeof uniqueId !== 'string' || !/-[0-9a-f]{8}$/i.test(uniqueId)) continue;
  const props: { attr: (string | number | null)[]; value: unknown }[] = [];
  for (let at = offsets[db] * 2; at < (offsets[db + 1] ?? avs.length / 2) * 2; at += 2) {
    const attr = attrs[avs[at]];
    if (Array.isArray(attr)) props.push({ attr, value: values[avs[at + 1]] });
  }
  if (!props.some(p => p.attr[0] === 'CategoryId' && p.value === -2000160)) continue;
  const elementId = Number.parseInt(uniqueId.slice(-8), 16);
  const text = (key: string) => props.find(p => p.attr[0] === key && p.attr[1] === 'Identity Data')?.value;
  const area = props.find(p => p.attr[0] === 'Area' && p.attr[1] === 'Dimensions');
  const areaUnit = String(area?.attr[3]);
  const areaValue = typeof area?.value === 'number' ? area.value : undefined;
  const areaSquareFeet = areaValue == null ? undefined : /squareMeters/i.test(areaUnit) ? areaValue / (0.3048 ** 2) : /squareFeet/i.test(areaUnit) ? areaValue : undefined;
  reference.set(elementId, { name: typeof text('Name') === 'string' ? String(text('Name')) : undefined, number: typeof text('Number') === 'string' ? String(text('Number')) : undefined, areaSquareFeet });
}
const rows = (result.nativeRooms ?? []).map(room => {
  const paired = reference.get(room.elementId);
  return { elementId: room.elementId, number: room.number, name: room.name, outlineStatus: room.outlineStatus, paired: !!paired,
    nameMatches: paired?.name == null || room.name == null ? undefined : paired.name === room.name,
    numberMatches: paired?.number == null || room.number == null ? undefined : paired.number === room.number,
    nativeAreaSquareFeet: room.outline?.areaSquareFeet, pairedAreaSquareFeet: paired?.areaSquareFeet,
    relativeAreaDifference: room.outline && paired?.areaSquareFeet ? Math.abs(room.outline.areaSquareFeet - paired.areaSquareFeet) / paired.areaSquareFeet : undefined };
});
const report = { rvtPath, svfPath, coverage: result.nativeRoomCoverage, referenceRooms: reference.size, pairedRooms: rows.filter(r => r.paired).length,
  nameMismatches: rows.filter(r => r.nameMatches === false).length, numberMismatches: rows.filter(r => r.numberMatches === false).length,
  comparedOutlines: rows.filter(r => r.relativeAreaDifference != null).length, areaMismatchesAbovePointOnePercent: rows.filter(r => r.relativeAreaDifference != null && r.relativeAreaDifference > 0.001).length,
  referenceOnlyRoomIds: [...reference.keys()].filter(id => !rows.some(r => r.elementId === id)), rooms: rows };
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, rooms: undefined }));
