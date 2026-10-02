import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {readProjectPackage} from "../lib/reviter/project-package.ts";
import {recoverNativeWallJunctionRepairs} from "../lib/reviter/native-room-presentation.ts";
import {auditRoomBoundaries} from "../lib/reviter/room-boundary-audit.ts";

const args=process.argv.slice(2);
const option=(name:string)=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
const input=option("--input"),output=option("--out");
if(!input||!output||resolve(input)===resolve(output))throw new Error("Usage: node --experimental-strip-types scripts/audit-room-junctions.ts --input prepared.reviter.zip --out joint-review.json");
const project=await readProjectPackage(new Uint8Array(await readFile(resolve(input))));
if(!project.indoor)throw new Error("Prepare native indoor geometry before auditing native wall joins.");
const repairs=recoverNativeWallJunctionRepairs(project.indoor.walls,project.indoor.doors??[]);
const boundaryAudit=auditRoomBoundaries(project.indoor,project.rooms.annotations);
const report={version:1,input:resolve(input),sourceModelSha256:project.indoor.source.modelSha256,
  sourceAndGraphUnchanged:true,
  policy:{endCapToleranceFeet:.08,singleCornerToleranceFeet:.04,
    evidence:"Native rectangular wall end caps supported by a recovered native wall or column; native doors exclude patches. No annotation supplies a partition.",
    units:"revit-internal-feet",originalRvtPreserved:true},
  summary:{repairs:repairs.length,endCaps:repairs.filter(r=>r.repairKind==="end-cap").length,
    corners:repairs.filter(r=>r.repairKind==="corner").length,
    supportedByColumns:repairs.filter(r=>r.supportingElementKind==="column").length,
    maximumGapFeet:repairs.reduce((maximum,r)=>Math.max(maximum,r.gapFeet),0)},
  repairs,boundaryAudit};
await mkdir(dirname(resolve(output)),{recursive:true});
await writeFile(resolve(output),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({output:resolve(output),sourceModelSha256:report.sourceModelSha256,
  ...report.summary,ordinaryRoomCoverage:boundaryAudit.ordinaryRoomCoverage,
  verticalCirculationCoverage:boundaryAudit.verticalCirculationCoverage},null,2));
