/** Complete conservative obstruction census for one external stair placement
 * and its original inline planar profiles. Profiles stay closed source face
 * domains; no thickness, closed body, walking support or route is invented. */
import { Rational, rational, type NativeRationalPoint, type NativeRationalParts } from "./native-rational-overlay.ts";
import type { Revit2027GRepReplay, Revit2027GRepReplaySpan } from "./revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import { revit2027OwnerMeshIndex, revit2027OwnerSurface } from "./revit-2027-owner-mesh-index.ts";
import { walkRevit2027DirectedLoopEdges, revit2027DirectedEdgeUvs } from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import type { Revit2027GLine } from "./revit-2027-gline.ts";
import type { Revit2027GPoint } from "./revit-2027-gpoint.ts";
import type { OriginalPlanarMaterialCell } from "./native-source-planar-slab-envelope.ts";
type P3 = [Rational, Rational, Rational];
const add = (a: Rational, b: Rational) => new Rational(a.n*b.d+b.n*a.d,a.d*b.d), sub = (a: Rational, b: Rational) => new Rational(a.n*b.d-b.n*a.d,a.d*b.d), mul = (a: Rational, b: Rational) => new Rational(a.n*b.n,a.d*b.d), cmp = (a: Rational,b: Rational) => a.n*b.d < b.n*a.d ? -1 : a.n*b.d > b.n*a.d ? 1 : 0;
const point = (s: Revit2027PlaneSurface, uv: number[]): P3 => [0,1,2].map(i=>add(add(rational(s.origin[i]!),mul(rational(s.xVector[i]!),rational(uv[0]!))),mul(rational(s.yVector[i]!),rational(uv[1]!)))) as P3;
const key = (p: NativeRationalPoint) => p.map(q=>`${q.n}/${q.d}`).join(":");
function hull(input: NativeRationalPoint[]) {
  const values=[...new Map(input.map(p=>[key(p),p])).values()].sort((a,b)=>cmp(a[0],b[0])||cmp(a[1],b[1])); if(values.length<3)return values;
  const cross=(a: NativeRationalPoint,b: NativeRationalPoint,c: NativeRationalPoint)=>sub(mul(sub(b[0],a[0]),sub(c[1],a[1])),mul(sub(b[1],a[1]),sub(c[0],a[0])));
  const half=(a: NativeRationalPoint[])=>{const out: NativeRationalPoint[]=[];for(const p of a){while(out.length>1&&cross(out.at(-2)!,out.at(-1)!,p).n<=0n)out.pop();out.push(p);}return out;};
  return [...half(values).slice(0,-1),...half(values.toReversed()).slice(0,-1)];
}
export type OriginalLandingCarrierMaterialCell = OriginalPlanarMaterialCell & { sourceKind: "original-inline-planar-face-domain" | "original-GLine" | "original-GPoint"; sourceReplayIndex: number; sourceGeometryOwnerElementId: number };
/** Pure mathematics only. Source ownership comes from the opaque actual-RVT
 * assembly consumer. Every returned domain is an obstruction superset; the
 * finite surface parameter rectangle and ALL original edge/loop UV operands
 * remain enclosed, including disagreements. Unknown, holed, curved, reused,
 * foreign or unconsumed branches refuse without a partial success claim. */
export function inspectOriginalStairLandingCarrierMaterial(replay: Revit2027GRepReplay, nativeDefinitionId: number) {
  const cells: OriginalLandingCarrierMaterialCell[] = [], blockers: string[] = [], faceDomains: { originalFaceToken: number; originalGeometryReplayIndex: number; originalLoopToken: number; originalPlaneReplayIndex: number; originalFiniteUvOperands: number[][]; originalEnclosingUvBounds: number[][] }[] = [];
  let inlineFaceCount=0, primitiveCount=0;
  try {
    const allowed = new Map([["Revit2027GFilter",2254],["Revit2027GGroup",2248],["Revit2027GInstance",2215],["Revit2027InstanceInfo",2513],["Revit2027GConditionInt",2238],["Revit2027Geometry",2343],["Revit2027GLine",1973],["Revit2027GPoint",2271],["Revit2027Face",1825],["Revit2027GEdge",1423],["Revit2027EdgeLoop",1434],["Revit2027AnalyticSurface:634",634]]);
    if(!Number.isSafeInteger(Number(replay.ownerElementId))||Number(replay.ownerElementId)<=0||!Number.isSafeInteger(nativeDefinitionId)||nativeDefinitionId<=0||!replay.spans.length||replay.spans.length>10000||replay.spans.some((s,i)=>s.ownerElementId!==replay.ownerElementId||s.replayIndex!==i||allowed.get(s.readerId)!==s.propertySourceClassSlot))throw Error("Unsupported original landing carrier owner/primitive");
    const spans=new Map(replay.spans.map(s=>[s.replayIndex,s])),positive=replay.spans.filter(s=>s.propertyToken>0);
    if(new Set(positive.map(s=>s.propertyToken)).size!==positive.length||replay.descriptors.some(d=>d.state==="reused"))throw Error("Reused original landing material source token");
    const queued=replay.descriptors.filter(d=>d.state==="queued");if(queued.length!==replay.spans.length)throw Error("Unconsumed original landing material descriptor");
    for(const s of replay.spans){const ds=queued.filter(d=>d.queueSequence===s.queueSequence);if(ds.length!==1||ds[0]!.ownerElementId!==s.ownerElementId||ds[0]!.token!==s.propertyToken||ds[0]!.sourceClassSlot!==s.propertySourceClassSlot||ds[0]!.parentReplayIndex!==s.parentReplayIndex||ds[0]!.descriptorOffset!==s.descriptorOffset||ds[0]!.descriptorEndOffset!==s.descriptorEndOffset||JSON.stringify(ds[0]!.path)!==JSON.stringify(s.path))throw Error("Original landing material FIFO ownership differs");}
    const groupChild=(s: Revit2027GRepReplaySpan)=>{
      const seen=new Set<number>();let at=s.parentReplayIndex,child=s;
      while(at!==null){if(seen.has(at))throw Error("Cyclic original landing carrier ancestry");seen.add(at);const p=spans.get(at);if(!p||!["Revit2027GGroup","Revit2027GFilter"].includes(p.readerId))throw Error("Original landing primitive has a body/profile consumer");
        const v=p.value as {children?:{token:number;sourceClassSlot:number;byteOffset:number;endOffset:number}[];group?:{children:{token:number;sourceClassSlot:number;byteOffset:number;endOffset:number}[]}},children=p.readerId==="Revit2027GFilter"?v.group?.children:v.children;
        if(!children||children.filter(d=>d.token===child.propertyToken&&d.sourceClassSlot===child.propertySourceClassSlot&&d.byteOffset===child.descriptorOffset&&d.endOffset===child.descriptorEndOffset).length!==1)throw Error("Original landing branch is not its declared group child");child=p;at=p.parentReplayIndex;
      }
    };
    const instances=collectRevit2027GInstanceBindings(replay);if(!instances.ok||instances.value.length!==1||instances.value[0]!.kind!=="external")throw Error("Original landing lacks one external definition placement");
    const placement=instances.value[0]!.instance;
    if(placement.symbolElementId!==BigInt(nativeDefinitionId)||placement.gRepId!==0||placement.cda!==1||placement.hasScale||placement.forbiddenTarget!==0||placement.resolveSymbolInView||JSON.stringify(placement.transform.matrix)!==JSON.stringify([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]))throw Error("Original landing definition identity/placement differs");
    const instanceSpans=replay.spans.filter(s=>s.readerId==="Revit2027GInstance"), infos=replay.spans.filter(s=>s.readerId==="Revit2027InstanceInfo");
    if(instanceSpans.length!==1||infos.length!==1||infos[0]!.parentReplayIndex!==instanceSpans[0]!.replayIndex)throw Error("Original landing placement has extra children");groupChild(instanceSpans[0]!);
    const iv=instanceSpans[0]!.value as {gInfo:{tag:number};embeddedSymbolGRep:{token:number;sourceClassSlot:number|null};instanceInfo:{sourceClassSlot:number}};if(iv.gInfo.tag!==nativeDefinitionId||iv.embeddedSymbolGRep.token!==0||iv.embeddedSymbolGRep.sourceClassSlot!==null||iv.instanceInfo.sourceClassSlot!==2513)throw Error("Original landing instance contains an unsupported body branch");
    const index=revit2027OwnerMeshIndex(replay), accounted=new Set<number>([instanceSpans[0]!.replayIndex,infos[0]!.replayIndex]), usedFaces=new Set<number>(),usedEdges=new Set<number>(),usedLoops=new Set<number>();
    const geometrySpans=replay.spans.filter(s=>s.readerId==="Revit2027Geometry");if(!geometrySpans.length)throw Error("Original landing carrier lacks declared Geometry");
    for(const s of replay.spans){
      if(s.readerId==="Revit2027GGroup"||s.readerId==="Revit2027GFilter"){groupChild(s);const v=s.value as {gInfo?:{controlCommand:number};group?:{gInfo:{controlCommand:number}}};if((v.gInfo??v.group?.gInfo)?.controlCommand!==0)throw Error("Unknown original landing group control");const gv=s.value as {children?:{token:number;sourceClassSlot:number;byteOffset:number;endOffset:number}[];group?:{children:{token:number;sourceClassSlot:number;byteOffset:number;endOffset:number}[]};conditions?:{token:number;sourceClassSlot:number;byteOffset:number;endOffset:number}[]};
        const children=s.readerId==="Revit2027GFilter"?[...(gv.group?.children??[]),...(gv.conditions??[])]:gv.children;
        if(!children||children.length!==replay.spans.filter(c=>c.parentReplayIndex===s.replayIndex).length||children.some(d=>replay.spans.filter(c=>c.parentReplayIndex===s.replayIndex&&c.propertyToken===d.token&&c.propertySourceClassSlot===d.sourceClassSlot&&c.descriptorOffset===d.byteOffset&&c.descriptorEndOffset===d.endOffset).length!==1))throw Error("Original landing group omits/adds a declared child");accounted.add(s.replayIndex);}
      if(s.readerId==="Revit2027GConditionInt"){const v=s.value as {compareMode:number;parameter:number;value:number};const parent=s.parentReplayIndex===null?undefined:spans.get(s.parentReplayIndex);if(parent?.readerId!=="Revit2027GFilter"||v.compareMode!==3||v.parameter!==3||!Number.isSafeInteger(v.value))throw Error("Unknown original landing visibility condition");accounted.add(s.replayIndex);}
    }
    const addCell=(points: P3[],kind: OriginalLandingCarrierMaterialCell["sourceKind"],s: Revit2027GRepReplaySpan,tokens:number[])=>{
      const projected=hull(points.map(p=>[p[0],p[1]])),partsFeet:NativeRationalParts=projected.length>=3?[[projected]]:[],closedSegmentsFeet=projected.length<3?[projected]:[];
      cells.push({role:"original-boundary-domain",sourceKind:kind,sourceReplayIndex:s.replayIndex,sourceGeometryOwnerElementId:Number(replay.ownerElementId),originalFaceTokens:tokens,partsFeet,closedSegmentsFeet,minimumElevationFeet:points.map(p=>p[2]).sort(cmp)[0]!,maximumElevationFeet:points.map(p=>p[2]).sort(cmp).at(-1)!});
    };
    for(const gspan of geometrySpans){groupChild(gspan);accounted.add(gspan.replayIndex);const g=gspan.value as {flags:number;faces:{count:number;entries:{token:number;sourceClassSlot:number}[]};edges:{count:number;entries:{token:number;sourceClassSlot:number}[]};sharedSurfaceInfo:{count:number;entries:unknown[]};queuedProperties:unknown[]};
      const declared=(field:typeof g.faces,reader:string,slot:number)=>{const actual=replay.spans.filter(s=>s.parentReplayIndex===gspan.replayIndex&&s.readerId===reader);return field.count===field.entries.length&&field.count===actual.length&&new Set(field.entries.map(d=>d.token)).size===actual.length&&field.entries.every(d=>d.sourceClassSlot===slot&&actual.some(s=>s.propertyToken===d.token));};
      if(g.flags!==7||g.sharedSurfaceInfo.count||g.sharedSurfaceInfo.entries.length||!declared(g.faces,"Revit2027Face",1825)||!declared(g.edges,"Revit2027GEdge",1423)||g.queuedProperties.length!==g.faces.count+g.edges.count)throw Error("Original landing Geometry omits/adds material operands");
      if(g.faces.count===0){if(g.edges.count)throw Error("Unowned original landing edge-only Geometry");continue;}
      // This family is a finite one-sided profile, not a sewn body.
      if(g.faces.count!==1)throw Error("Unsupported original landing multi-face inline profile");
      const token=g.faces.entries[0]!.token,face=index.faces.get(token),fspan=replay.spans.find(s=>s.readerId==="Revit2027Face"&&s.propertyToken===token);if(!face||!fspan||usedFaces.has(token))throw Error("Missing/reused original landing face");usedFaces.add(token);
      const plane=revit2027OwnerSurface<Revit2027PlaneSurface>(index,634,token),loop=index.loops.get(face.firstLoop.token),surfaceSpans=replay.spans.filter(s=>s.parentReplayIndex===fspan.replayIndex&&s.readerId==="Revit2027AnalyticSurface:634"),loopSpans=replay.spans.filter(s=>s.parentReplayIndex===fspan.replayIndex&&s.readerId==="Revit2027EdgeLoop");
      if(face.faceFlags!==4||face.cutType!==0||face.faceRegions.count||face.foregroundFilling.token||face.backgroundFilling.token||face.surface.sourceClassSlot!==634||!plane||plane.kind!=="plane"||plane.queuedProperties.length||!loop||loop.loop.open||loop.loop.nextLoop.token||surfaceSpans.length!==1||surfaceSpans[0]!.propertyToken!==face.surface.token||face.firstLoop.sourceClassSlot!==1434||loopSpans.length!==1||loopSpans[0]!.propertyToken!==face.firstLoop.token||usedLoops.has(face.firstLoop.token))throw Error("Unsupported original landing face/plane/hole/hatch semantics");
      if([...plane.origin,...plane.xVector,...plane.yVector,...plane.surface.envelope.firstCorner,...plane.surface.envelope.secondCorner,...loop.loop.envelope.minimum,...loop.loop.envelope.maximum].some(n=>!Number.isFinite(n)))throw Error("Nonfinite original landing plane/loop domain");
      const cross=[sub(mul(rational(plane.xVector[1]),rational(plane.yVector[2])),mul(rational(plane.xVector[2]),rational(plane.yVector[1]))),sub(mul(rational(plane.xVector[2]),rational(plane.yVector[0])),mul(rational(plane.xVector[0]),rational(plane.yVector[2]))),sub(mul(rational(plane.xVector[0]),rational(plane.yVector[1])),mul(rational(plane.xVector[1]),rational(plane.yVector[0])))];if(cross.every(q=>q.n===0n))throw Error("Degenerate original landing plane basis");
      const walked=walkRevit2027DirectedLoopEdges({faceToken:token,loop,edges:index.edges,loopArity:"open"});if(!walked.ok||walked.edges.length!==g.edges.count)throw Error("Original landing profile coedge chain is incomplete");
      const uvs:number[][]=[[...plane.surface.envelope.firstCorner],[...plane.surface.envelope.secondCorner],[...loop.loop.envelope.minimum],[...loop.loop.envelope.maximum]];
      for(const use of walked.edges){const edge=use.edge,other=1-use.side,espan=replay.spans.find(s=>s.readerId==="Revit2027GEdge"&&s.propertyToken===use.token);if(!espan||espan.parentReplayIndex!==gspan.replayIndex||usedEdges.has(use.token)||!g.edges.entries.some(d=>d.token===use.token)||edge.flags!==6||edge.queuedPropertyCount||edge.interiorEdgePoints.length||edge.faceReferences[other]!==0||edge.nextReferences[other]!==0||edge.previousReferences[other]!==0||edge.firstAndLastEdgePoints.flatMap(p=>[...p.firstFaceUv,...p.secondFaceUv]).some(n=>!Number.isFinite(n)))throw Error("Unsupported original landing edge/twin/curve semantics");usedEdges.add(use.token);accounted.add(espan.replayIndex);uvs.push(...revit2027DirectedEdgeUvs(use).map(p=>[...p]));}
      const us=uvs.map(p=>p[0]!),vs=uvs.map(p=>p[1]!);faceDomains.push({originalFaceToken:token,originalGeometryReplayIndex:gspan.replayIndex,originalLoopToken:face.firstLoop.token,originalPlaneReplayIndex:surfaceSpans[0]!.replayIndex,originalFiniteUvOperands:uvs.map(p=>[...p]),originalEnclosingUvBounds:[[Math.min(...us),Math.min(...vs)],[Math.max(...us),Math.max(...vs)]]});const corners=[Math.min(...us),Math.max(...us)].flatMap(u=>[Math.min(...vs),Math.max(...vs)].map(v=>[u,v]));addCell(corners.map(uv=>point(plane,uv)),"original-inline-planar-face-domain",fspan,[token]);inlineFaceCount++;usedLoops.add(face.firstLoop.token);for(const s of [fspan,surfaceSpans[0]!,loopSpans[0]!])accounted.add(s.replayIndex);
    }
    for(const s of replay.spans)if(s.readerId==="Revit2027GLine"||s.readerId==="Revit2027GPoint"){
      groupChild(s);if(replay.spans.some(child=>child.parentReplayIndex===s.replayIndex))throw Error("Original landing finite primitive hides a source child");
      if(s.readerId==="Revit2027GLine"){const v=s.value as Revit2027GLine;if([...v.origin,...v.direction,...v.endParameters].some(n=>!Number.isFinite(n))||v.direction.every(n=>n===0)||v.endParameters[0]===v.endParameters[1])throw Error("Invalid original landing finite line");addCell(v.endParameters.map(t=>[0,1,2].map(i=>add(rational(v.origin[i]!),mul(rational(v.direction[i]!),rational(t)))) as P3),"original-GLine",s,[]);}
      else{const v=s.value as Revit2027GPoint;if(v.coordinate.some(n=>!Number.isFinite(n))||!Number.isSafeInteger(v.size)||!Number.isSafeInteger(v.borderSize)||v.size<0||v.borderSize<0)throw Error("Invalid original landing point/display fields");addCell([v.coordinate.map(rational) as P3],"original-GPoint",s,[]);}accounted.add(s.replayIndex);primitiveCount++;
    }
    if(usedFaces.size!==index.faces.size||usedEdges.size!==index.edges.size||usedLoops.size!==index.loops.size||accounted.size!==replay.spans.length)throw Error("Original landing material census omits a source branch");
  }catch(error){blockers.push(error instanceof Error?error.message:String(error));}
  return {cells,blockers,faceDomains,inlineFaceCount,primitiveCount,originalExternalDefinitionMaterialDelegated:blockers.length===0,allOriginalCarrierMaterialEnclosed:blockers.length===0,externalDefinitionId:nativeDefinitionId,closedSourceObstructions:true as const,physicalThicknessInvented:false as const,positiveWalkingSupportApproved:false as const,exactClosedBodyApproved:false as const,sourceAuthorityGranted:false as const,routeApproved:false as const};
}
