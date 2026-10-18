/** Original requested GRep frames and strict replay blockers, not route proof.
 * Scans all original pages, retains every requested occurrence, never chooses
 * a renderer fallback or equates a source bounding box with a physical body.
 */
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { openRevitContainer } from "../../lib/reviter/convert-container.ts";
import { activeClassTagTranslation,setActiveClassTagTranslation } from "../../lib/reviter/revit-class-tags.ts";
import { activeElementIdBytes,setActiveElementIdBytes } from "../../lib/reviter/element-id-width.ts";
import { asBytes,gzipOffsets,inflateRevitChunk,revitWindowTail,stripRevitPageChecksums } from "../../lib/reviter/revit-container.ts";
import { createSplitFrameStream,type StreamedFrame } from "../../lib/reviter/split-frame-stream.ts";
import { decodeRevit2027FramedGRepRoot } from "../../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../../lib/reviter/revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "../../lib/reviter/revit-2027-nested-instance.ts";
import { inspectPlanarPrismReplayGeometry } from "../../lib/reviter/native-source-stair-solid-proof.ts";
import { Rational } from "../../lib/reviter/native-rational-overlay.ts";

const [modelFile,requestFile,output]=process.argv.slice(2);
if(!modelFile||!requestFile||!output)throw Error("Usage: inspect-native-element-bodies.ts ORIGINAL.rvt REQUESTS.json NEW-OUTPUT");
const hash=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
const raw=await readFile(modelFile),rawRequests=await readFile(requestFile);
const request=JSON.parse(rawRequests.toString()) as {sourceModelSha256:string;elementIds:number[]};
if(hash(raw)!==request.sourceModelSha256||!request.elementIds?.length||request.elementIds.length>128||
  request.elementIds.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(request.elementIds).size!==request.elementIds.length)
  throw Error("Exact original RVT and bounded unique requested IDs are required");
await mkdir(output,{recursive:false});
const wanted=new Set(request.elementIds),frames:{stream:string;frame:StreamedFrame}[]=[];
const previousTags=activeClassTagTranslation(),previousWidth=activeElementIdBytes();
const started=performance.now();let pages=0,storedBytes=0,schemaSha256="";
const results:unknown[]=[];
function encode(value:unknown):unknown{
  if(value instanceof Rational)return {numerator:value.n.toString(),denominator:value.d.toString()};
  if(typeof value==="bigint")return value.toString();
  if(Array.isArray(value))return value.map(encode);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
  return value;
}
try{
  const opened=openRevitContainer(raw,{});
  if(opened.decoderPlan.revitVersion!==2027||!opened.nativeSourceSchemaBytes||activeElementIdBytes()!==8||
      !opened.classTagTranslation.identity||opened.classTagTranslation.movedClasses)
    throw Error("Canonical wide-ID embedded Revit 2027 schema required");
  schemaSha256=hash(opened.nativeSourceSchemaBytes);
  for(const partition of opened.partitions){
    const stream=createSplitFrameStream({markers:[2246],minObjectLength:40,maxFrameBytes:16*1024*1024,
      acceptHeader:(view,offset)=>wanted.has(Number(view.getBigUint64(offset,true)))});
    const source=stripRevitPageChecksums(asBytes(partition.entry.content)),offsets=gzipOffsets(source,10001);
    if(offsets.length>10000)throw Error("Original page census exceeds bound");
    let window:Uint8Array|null=null;
    for(let i=0;i<offsets.length;i++){
      const page=inflateRevitChunk(source,offsets[i]!,offsets[i+1],window);
      if(!page)throw Error("Original page failed complete inflation");
      window=revitWindowTail(page);pages++;
      for(const frame of stream.push(page)){
        storedBytes+=frame.data.length;
        if(storedBytes>128*1024*1024||frames.length>=1024)throw Error("Requested frame retention exceeds bound");
        frames.push({stream:partition.path,frame});
      }
    }
  }
  const occurrences=new Map<number,number>();
  for(const {stream,frame} of frames){
    const occurrence=(occurrences.get(frame.elementId)??0)+1;occurrences.set(frame.elementId,occurrence);
    const name=`${frame.elementId}-${occurrence}.grep.bin`;
    await writeFile(join(output,name),frame.data,{flag:"wx"});
    const root=decodeRevit2027FramedGRepRoot(frame.data,{offset:0,elementId:frame.elementId,
      marker:frame.marker,objectLength:frame.objectLength,typeCode:new DataView(frame.data.buffer,frame.data.byteOffset,frame.data.byteLength).getUint32(18,true)},2027);
    const basic={nativeElementId:frame.elementId,occurrence,stream,bytes:frame.data.length,sha256:hash(frame.data),file:name};
    if(!root.ok){results.push({...basic,rootError:root.error});continue;}
    const replay=replayRevit2027GRepFifo(frame.data,root.value);
    if(!replay.ok){results.push({...basic,replayError:replay.error});continue;}
    const primitiveCounts=Object.fromEntries([...new Set(replay.value.spans.map(s=>s.readerId))].map(id=>[id,replay.value.spans.filter(s=>s.readerId===id).length]));
    const bindings=collectRevit2027GInstanceBindings(replay.value);
    const prism=inspectPlanarPrismReplayGeometry(replay.value);
    const faceSemantics=replay.value.spans.filter(s=>s.readerId==="Revit2027Face").map(s=>{
      const value=s.value as {faceFlags:number;cutType:number;faceRegions:{count:number};firstLoop:{token:number};surface:{sourceClassSlot:number}};
      return {token:s.propertyToken,faceFlags:value.faceFlags,cutType:value.cutType,regionCount:value.faceRegions.count,
        firstLoopToken:value.firstLoop.token,surfaceClassSlot:value.surface.sourceClassSlot};
    });
    const faceFillings=replay.value.spans.filter(s=>s.readerId==="Revit2027GFilling").map(s=>({
      token:s.propertyToken,ownerElementId:s.ownerElementId,value:s.value}));
    results.push({...basic,root:{ownerElementId:root.value.ownerElementId,objectType:root.value.objectType,
      flags:root.value.flags,localExtents:root.value.localExtents,worldExtents:root.value.worldExtents},
      completeTypedReplay:true,primitiveCounts,instanceBindings:bindings,faceSemantics,faceFillings,
      planarPrismInspection:{completeExactPrismBody:prism.completeExactPrismBody,originalFaceCount:prism.originalFaceCount,
        originalEdgeCount:prism.originalEdgeCount,blockers:prism.blockers,witnesses:prism.witnesses},
      physicalSourceOrRouteAuthorityGranted:false});
  }
}finally{setActiveClassTagTranslation(previousTags);setActiveElementIdBytes(previousWidth);}
const report={format:"original-native-requested-body-inspection-v1",sourceModelSha256:hash(raw),schemaSha256,
  requestSha256:hash(rawRequests),requestedIds:request.elementIds,completeSourcePagesScanned:pages,
  retainedOccurrences:frames.length,retainedBytes:storedBytes,
  missingIds:request.elementIds.filter(id=>!frames.some(f=>f.frame.elementId===id)),results,
  scope:"Requested GRep occurrences only; not the complete foreign-material/body/clearance census",
  sourceUnchanged:hash(await readFile(modelFile))===hash(raw),elapsedSeconds:(performance.now()-started)/1000,
  routeApproved:false,geometryEdited:false};
if(!report.sourceUnchanged)throw Error("Original model changed during inspection");
await writeFile(join(output,"inspection.json"),JSON.stringify(encode(report),null,2),{flag:"wx"});
console.log(JSON.stringify({pages,retainedOccurrences:frames.length,missingIds:report.missingIds,elapsedSeconds:report.elapsedSeconds}));
