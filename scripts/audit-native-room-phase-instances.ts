/** Read-only instance census using native element frame length echoes and the
 * exact file schema. Raw class-word/string occurrences are never counted. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import CFB from 'cfb';
import {readProjectPackage} from '../lib/reviter/project-package.ts';
import {asBytes,gzipOffsets,inflateRevitChunk,revitWindowTail,salvageRevitChunk,stripRevitPageChecksums} from '../lib/reviter/revit-container.ts';
import {readSchema} from '../lib/reviter/schema-reader.ts';
import {elementIdBytesFromSchema,setActiveElementIdBytes} from '../lib/reviter/element-id-width.ts';
import {buildClassTagTranslation,setActiveClassTagTranslation,canonicalClassTag} from '../lib/reviter/revit-class-tags.ts';
import {scanFramedElementObjects,MAX_SCANNED_OBJECT_BYTES} from '../lib/reviter/element-objects.ts';
const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i<0?undefined:args[i+1]};
const input=option('--input'),out=option('--out'),cache=option('--native-cache');if(!input||!out||!cache)throw Error('Supply --input project.reviter.zip --native-cache model-bound-cache.json --out room-phase-instances.json');
const pkg=await readProjectPackage(new Uint8Array(await readFile(resolve(input))));
const native=JSON.parse(await readFile(resolve(cache),'utf8'));
if(native.sourceModelSha256!==pkg.manifest.model.sha256||native.nativeModel.fileName!==pkg.model.name)throw Error('Cache/model identities differ.');
const identity=new Map<number,string>(native.nativeModel.nativeIdentity?.identities.map((i:{elementId:number;uniqueId:string})=>[i.elementId,i.uniqueId]));
const cfb=CFB.read(new Uint8Array(await pkg.model.arrayBuffer()),{type:'buffer'});
const entries=cfb.FileIndex.map((entry,index)=>({entry,path:cfb.FullPaths[index]??''}));
const schemaEntry=entries.find(e=>e.entry.size>0&&/\/Formats\/Latest$/i.test(e.path));if(!schemaEntry)throw Error('Missing native serialization schema.');
const stored=stripRevitPageChecksums(asBytes(schemaEntry.entry.content)),offsets=gzipOffsets(stored);let window:Uint8Array|undefined;
const parts:Uint8Array[]=[];for(let i=0;i<offsets.length;i++){const bytes=inflateRevitChunk(stored,offsets[i]!,offsets[i+1],window);if(!bytes)throw Error('Incomplete native schema inflation.');parts.push(bytes);window=revitWindowTail(bytes);}
const joined=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){joined.set(p,at);at+=p.length;}
const schema=readSchema(joined);if(!schema.ok)throw Error('Native schema did not parse fully: '+schema.error);
setActiveElementIdBytes(elementIdBytesFromSchema(schema.schema.classes));
setActiveClassTagTranslation(buildClassTagTranslation(schema.schema.classes.map(c=>({name:c.name,tag:c.index,declaredFieldCount:c.propertyCount,fieldNames:c.properties.map(p=>p.name)}))));
const targets=['RoomElem','Room','RoomTag','ProjectPhase','AllProjectPhases'];
const classByMarker=new Map(targets.flatMap(name=>{const c=schema.schema.classes.find(c=>c.name===name);return c?[[canonicalClassTag(c.index),c] as const]:[]}));
const frames:{className:string;fileClassIndex:number;canonicalClassIndex:number;nativeElementId:number;nativeUniqueId:string|null;stream:string;chunkIndex:number;offset:number;objectLength:number}[]=[];
let pages=0,failed=0,salvaged=0,totalBytes=0,allFramedObjects=0,identityCorroboratedFrames=0;
for(const {entry,path}of entries.filter(e=>e.entry.size>0&&/\/Partitions\/[^/]+$/i.test(e.path))){
 const compressed=stripRevitPageChecksums(asBytes(entry.content)),starts=gzipOffsets(compressed);let dictionary:Uint8Array|null=null;
 for(let chunkIndex=0;chunkIndex<starts.length;chunkIndex++){
  const strict=inflateRevitChunk(compressed,starts[chunkIndex]!,starts[chunkIndex+1],dictionary),bytes=strict??salvageRevitChunk(compressed,starts[chunkIndex]!,starts[chunkIndex+1],dictionary);
  if(!bytes){failed++;continue;}if(strict)dictionary=revitWindowTail(strict);else salvaged++;pages++;totalBytes+=bytes.length;
  const objects=scanFramedElementObjects(bytes);allFramedObjects+=objects.length;
  for(const object of objects){if(identity.has(object.elementId))identityCorroboratedFrames++;const c=classByMarker.get(object.marker);if(!c)continue;frames.push({className:c.name,fileClassIndex:c.index,canonicalClassIndex:object.marker,nativeElementId:object.elementId,nativeUniqueId:identity.get(object.elementId)??null,stream:path,chunkIndex,offset:object.offset,objectLength:object.objectLength});}
 }
}
setActiveClassTagTranslation(null);setActiveElementIdBytes(null);
const classes=targets.map(name=>({className:name,declaredFileClassIndex:schema.schema.classes.find(c=>c.name===name)?.index??null,framedOccurrences:frames.filter(f=>f.className===name).length,uniqueNativeIds:[...new Set(frames.filter(f=>f.className===name).map(f=>f.nativeElementId))],identityCorroboratedIds:[...new Set(frames.filter(f=>f.className===name&&f.nativeUniqueId).map(f=>f.nativeElementId))]}));
const report={version:1,sourceModelSha256:pkg.manifest.model.sha256,scan:{inflatedPages:pages,failedPages:failed,salvagedPages:salvaged,inflatedBytes:totalBytes,allFramedObjects,identityCorroboratedFrames,maximumObjectBytes:MAX_SCANNED_OBJECT_BYTES},method:'Exact schema class at independently length/echo-framed element-object header; ElementId independently joined to Global/ElemTable.ElementHistory+Global/History.Episode UniqueId. No raw class-word or class-name counting.',classes,instances:frames,limitations:['The broad scanner accepts complete in-page object frames of 40..65535 bytes. Larger objects and frames spanning page boundaries are outside this census.','A negative class count establishes no matching complete independently framed records in the scanned scope, not unconditional absence from every native serialization carrier.','These instance headers do not decode Room names/numbers/Finish loops or phase names/order. A ProjectPhase instance proves phase identity, not which view/room uses it.']};
await mkdir(dirname(resolve(out)),{recursive:true});await writeFile(resolve(out),JSON.stringify(report,null,2));console.log(JSON.stringify({scan:report.scan,classes},null,2));
