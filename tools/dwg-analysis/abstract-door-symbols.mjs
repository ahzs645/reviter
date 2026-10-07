// Reuse Reviter's guarded visual recognizer; this does not create native portals.
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const [input, output, reviter] = process.argv.slice(2);
if (!input || !output || !reviter) throw Error('input output reviter-directory required');
const {registeredSingleDoorSwings} = await import(pathToFileURL(resolve(reviter,'lib/reviter/registered-single-door-swings.ts')));
const groups=JSON.parse(await readFile(input,'utf8')), results=[];
for (const group of groups) {
  const section={sectionId:group.id,levelId:0,registrationErrorFeet:0,
    wallSegments:group.segments.map(s=>s.pointsMetres.map(p=>p.map(x=>x/.3048))),doorSegments:[]};
  for (const swing of registeredSingleDoorSwings(section)) {
    if (!swing.arcSegmentIndices.some(i=>group.segments[i].sourceHandle===group.arcHandle)) continue;
    const points=x=>x.map(p=>p.map(v=>Number((v*.3048).toFixed(6))));
    const handles=ids=>[...new Set(ids.map(i=>group.segments[i].sourceHandle))];
    results.push({id:group.id,floorId:group.floorId,arcHandle:group.arcHandle,
      hingeMetres:swing.hingeFeet.map(x=>Number((x*.3048).toFixed(6))),widthMetres:swing.radiusFeet*.3048,
      closedLeafMetres:points(swing.closedLeafFeet),thresholdSegmentsMetres:swing.thresholdSegments.map(points),
      arcHandles:handles(swing.arcSegmentIndices),leafHandles:handles(swing.leafSegmentIndices),
      leafSegmentsMetres:swing.leafSegmentIndices.map(i=>group.segments[i].pointsMetres),
      supportingWallHandles:handles(swing.supportingWallSegmentIndices),status:'supported-drawing-symbol',
      routingEligible:false,nativeDoorId:null,access:null});
  }
}
await writeFile(output,JSON.stringify(results));
