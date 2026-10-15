/** Reproduce unresolved exporter recipes; reference GUIDs remain comparators. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openRevitContainer } from '../lib/reviter/convert-container.ts';
import { createNativeOriginalSymbolCollector, resolveNativeFamilyTypeIdentity, verifiedOriginalSymbolObject } from '../lib/reviter/native-ifc-type-identity.ts';
import { nativeIfcGlobalIds, revitIfcSubElementGlobalId, revitDoorWindowTypeGlobalId } from '../lib/reviter/ifc-global-id.ts';
import { indexPageFrames } from '../lib/reviter/page-frame-index.ts';
import { readSchema } from '../lib/reviter/schema-reader.ts';
import { canonicalClassTag } from '../lib/reviter/revit-class-tags.ts';
import { decodeRevit2027FramedGRepRoot } from '../lib/reviter/revit-2027-framed-grep-root.ts';
import { replayRevit2027GRepFifo } from '../lib/reviter/revit-2027-grep-replay.ts';
import type { Revit2027GeometryStatic } from '../lib/reviter/revit-2027-geometry.ts';
import { stepArguments, stepRecords } from './lib/ifc-comparison-stats.ts';
import { declareUsage, requireModelPath, requirePath, openRvt, iterateInflatedChunks, writeJsonReport } from './lib/rvt-harness.ts';

declareUsage('audit-ifc-type-recipes.ts source.rvt --exported own.ifc --reference paired.ifc --json report.json');
const input = requireModelPath('audit-ifc-type-recipes.ts source.rvt --exported own.ifc --reference paired.ifc --json report.json', '--exported', '--reference', '--json'), exported = requirePath('--exported'), reference = requirePath('--reference');
function links(source: string) {
  const roots = new Map<number, {entity: string; args: string[]}>(), relations: string[][] = [];
  for(const record of stepRecords(source)) {
    if(record.entity === 'IFCRELDEFINESBYTYPE') relations.push(stepArguments(record.body));
    else if (/^\s*'/.test(record.body)) roots.set(record.id, {entity:record.entity,args:stepArguments(record.body)});
  }
  const result = new Map<number, {entity: string; typeGuid: string}[]>();
  for(const relation of relations) {
    const type = roots.get(Number(/^#(\d+)$/.exec(relation[5]??'')?.[1])); if(!type)continue;
    for(const match of (relation[4]??'').matchAll(/#(\d+)/g)) {
      const product=roots.get(Number(match[1]));if(!product)continue;
      const tag=/^'([0-9]+)'$/.exec(product.args[7]??'')?.[1];if(!tag)continue;
      const id=Number(tag);result.set(id,[...(result.get(id)??[]),{entity:product.entity,typeGuid:type.args[0]!.slice(1,-1)}]);
    }
  }
  return result;
}
const sourceBytes = new Uint8Array(readFileSync(input)), ownBytes=readFileSync(exported), pairedBytes=readFileSync(reference);
const own=links(ownBytes.toString()), paired=links(pairedBytes.toString());
const mismatches=[...own].filter(([id,values])=>values.length===1 && paired.get(id)?.length===1 && values[0]!.typeGuid!==paired.get(id)![0]!.typeGuid);
const targets=new Set(mismatches.map(([id])=>id));
const opened=openRevitContainer(sourceBytes,{}), model=openRvt(input), version=model.release()!;
const classes=opened.schema?.taggedClasses??[], names=new Map(classes.map(c=>[c.tag,c.name]));
const guids=nativeIfcGlobalIds(opened.nativeIdentity?.identities??[]);
const collector=createNativeOriginalSymbolCollector({revitVersion:version,classes,elementIds:new Set(opened.elementIndex?.uniqueElementIds??[]),historyElementIds:new Set(guids.keys())});
const graphs=new Map<number,unknown[]>();let pages=0;
for(const chunk of iterateInflatedChunks(model)) {
  pages++;const frames=indexPageFrames(chunk.data).frames;
  collector.consumeObjects(chunk.data,{stream:chunk.path.replace(/^Root Entry\//,''),chunkIndex:chunk.chunkIndex,rawOffset:chunk.offset,complete:!chunk.salvaged},frames);
  if(chunk.salvaged)continue;
  for(const frame of frames) {
    if(!targets.has(frame.elementId)||names.get(frame.marker)!=='GElement'||!verifiedOriginalSymbolObject(chunk.data,frame.offset))continue;
    const root=decodeRevit2027FramedGRepRoot(chunk.data,{...frame,marker:canonicalClassTag(frame.marker)},version);
    const replay=root.ok?replayRevit2027GRepFifo(chunk.data,root.value,undefined,{maxReplayEntries:1024,maxDescriptors:4096}):null;
    const evidence={stream:chunk.path.replace(/^Root Entry\//,''),chunkIndex:chunk.chunkIndex,objectOffset:frame.offset,bodyBytes:frame.objectLength,
      root:root.ok?{flags:root.value.flags,objectType:root.value.objectType,children:root.value.children.map(c=>c.sourceClassSlot),box:root.value.localExtents,tightBox:root.value.worldExtents}:{error:root.error},
      replay:replay?.ok?{complete:true,readerCounts:Object.fromEntries([...new Set(replay.value.spans.map(s=>s.readerId))].map(reader=>[reader,replay.value.spans.filter(s=>s.readerId===reader).length])),
        breps:replay.value.spans.filter(s=>s.readerId==='Revit2027Geometry').map(s=>{const g=s.value as Revit2027GeometryStatic;return {path:s.path,faces:g.faces.entries.length,edges:g.edges.entries.length};})}:{complete:false,error:replay&&!replay.ok?replay.error:null}};
    graphs.set(frame.elementId,[...(graphs.get(frame.elementId)??[]),evidence]);
  }
}
const sources=new Map(collector.finish().map(s=>[s.elementId,s]));
const symbolIds=new Set([...sources.values()].filter(s=>targets.has(s.elementId)&&s.originalSymbolId!=null).map(s=>s.originalSymbolId!));
const symbolGraphics:unknown[]=[];
for(const chunk of iterateInflatedChunks(model)) {
  if(chunk.salvaged)continue;
  for(const frame of indexPageFrames(chunk.data).frames) {
    if(!symbolIds.has(frame.elementId)||names.get(frame.marker)!=='GElement'||!verifiedOriginalSymbolObject(chunk.data,frame.offset))continue;
    const root=decodeRevit2027FramedGRepRoot(chunk.data,{...frame,marker:canonicalClassTag(frame.marker)},version);
    const replay=root.ok?replayRevit2027GRepFifo(chunk.data,root.value,undefined,{maxReplayEntries:1024,maxDescriptors:4096}):null;
    symbolGraphics.push({elementId:frame.elementId,stream:chunk.path.replace(/^Root Entry\//,''),chunkIndex:chunk.chunkIndex,objectOffset:frame.offset,
      root:root.ok?{children:root.value.children.map(c=>c.sourceClassSlot),flags:root.value.flags,objectType:root.value.objectType,box:root.value.localExtents}:{error:root.error},
      replay:replay?.ok?{complete:true,breps:replay.value.spans.filter(s=>s.readerId==='Revit2027Geometry').map(s=>{const g=s.value as Revit2027GeometryStatic;return {path:s.path,faces:g.faces.entries.length,edges:g.edges.entries.length};})}:{complete:false,error:replay&&!replay.ok?replay.error:null}});
  }
}
const strictSchema=readSchema(model.requireSchema());
const cachePattern=/GeometrySummary|Solid.*Count|[Vv]olume|[Ss]urfaceArea|OriginalGeometry|originalGeom|solid_faces|solid_edges/;
const schemaFieldCandidates=strictSchema.ok?strictSchema.schema.classes.flatMap(c=>{
  const matchingFields=c.properties.filter(p=>cachePattern.test(p.name)).map(p=>p.name);
  return matchingFields.length?[{class:c.name,matchingFields}]:[];
}):[];
const schemaGraphicsFields=strictSchema.ok?strictSchema.schema.classes.filter(c=>['GElement','GRep','GInstance','InstInfoBase','InstanceInfo','Geometry','GeometryData','GBRep','FamilyInstance','InsertableInst'].includes(c.name)).map(c=>({class:c.name,fields:c.properties.map(p=>p.name)})):[];
const cases=mismatches.map(([elementId,[output]])=>{
  const truth=paired.get(elementId)![0]!,source=sources.get(elementId),original=source?.originalSymbolId==null?null:guids.get(source.originalSymbolId);
  const resolution=resolveNativeFamilyTypeIdentity({evidence:source,nativeGuids:guids,instanceEntity:output!.entity,exporterVersion:version});
  return {elementId,entity:output!.entity,resolution,source:source??null,sourceGraphics:graphs.get(elementId)??[],
    comparisonOnly:{exportedTypeGuid:output!.typeGuid,referenceTypeGuid:truth.typeGuid,
      instanceAsTypeMatches:!!guids.get(elementId)&&revitIfcSubElementGlobalId(guids.get(elementId)!,2048)===truth.typeGuid,
      originalSymbolMatches:!!original&&original===truth.typeGuid,
      flipCandidatesMatching:original?[false,true].filter(flip=>revitDoorWindowTypeGlobalId(original,flip,false,version)===truth.typeGuid):[]}};
});
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
writeJsonReport(requirePath('--json'), {schemaVersion:1,input:{sha256:sha(sourceBytes),release:version,bytes:sourceBytes.length},exportedIfcSha256:sha(ownBytes),referenceIfcSha256:sha(pairedBytes),pages,collectorCapped:collector.capped,
  limits:{maxRootChildren:64,maxReplayEntries:1024,maxDescriptors:4096,fifoWorkBytes:16777216,checksumWorkBytes:134217728},
  counts:{mismatches:cases.length,byEntity:Object.fromEntries([...new Set(cases.map(c=>c.entity))].map(entity=>[entity,cases.filter(c=>c.entity===entity).length])),byReason:Object.fromEntries([...new Set(cases.map(c=>c.resolution.status==='resolved'?'resolved':c.resolution.reason))].map(reason=>[reason,cases.filter(c=>(c.resolution.status==='resolved'?'resolved':c.resolution.reason)===reason).length]))},
  symbolGraphics,schemaGraphicsFields,schemaFieldCandidates,schemaCacheCandidates:classes.filter(c=>/GeometrySummary|Solid.*Count|Volume|SurfaceArea|OriginalGeometry/i.test(c.name)),cases,
  scope:'Persisted class/complete FIFO topology are source evidence. API geometry summaries include export-option visibility, filters, analytic areas/volumes and original-geometry bounds; native GRep topology alone is not asserted equivalent. All candidate recipe comparisons use reference GUIDs solely after source decoding, never to choose export identities.'});
