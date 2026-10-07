/** Reversible drawing interpretations. Original CAD geometry is never edited. */
type Point=[number,number];
type Primitive={sourceHandle:string;type:string;pointsMetres:Point[];centreMetres?:Point;radiusMetres?:number;sweepRadians?:number;axisRatio?:number;startParameter?:number;endParameter?:number};
type Door={id:string;floorId:string;arcHandle:string;arcHandles:string[];hingeMetres:Point;widthMetres:number;closedLeafMetres:Point[];thresholdSegmentsMetres:Point[][];leafHandles:string[];leafSegmentsMetres:Point[][];supportingWallHandles:string[];swingPointsMetres:Point[];recognitionMethod:string;sourceLeafWitnesses:{handle:string;segmentIndex:number}[];contactWitnesses:{fromHandle:string;fromSegmentIndex:number;fromPointMetres:Point;toHandle:string;toSegmentIndex:number;toPointMetres:Point}[];routingEligible:false;access:null;nativeDoorId:null};
export type CadContactReview={id:string;fromHandle:string;fromSegmentIndex:number;fromEndpointIndex:number;toHandle:string;toSegmentIndex:number;toFraction:number;pointsMetres:Point[];gapMetres:number;maximumGapMetres:number;selectionOnly:true};
export type CadEntranceCandidate={id:string;capWitnesses:{handle:string;segmentIndex:number}[];pointsMetres:Point[];thresholdSegmentsMetres:Point[][];widthMetres:number;roomGroups:string[][];previewRingsMetres:Point[][][];status:'proposal-only';applied:false;physicalDoorId:null;routingEligible:false;access:null;reason:string};
export type CadStairRiserWitness={handle:string;segmentIndex:number;stairId:string;treadIndex:number;pointsMetres:Point[];comparisonOnly:true;routingEligible:false};
export type CadCirculationReview={format:'reviter-cad-circulation-review';version:1;sourceSha256:string;geometrySha256:string;appliedToNativeGeometry:false;routingEligible:false;graphEdges:never[];maximumContactGapMetres:number;floors:{floorId:string;doors:Door[];contacts:CadContactReview[];stairRiserWitnesses?:CadStairRiserWitness[];entranceCandidates?:CadEntranceCandidate[];assessment:{beforeClosedLabels:number;afterClosedLabels:number;sharedLabels:string[];missingLabels:string[]}}[]};
type Floor={id:string;primitives:Primitive[];doors:{id:string;arcHandles:string[];leafHandles:string[]}[];stairs:{id?:string;sourceHandles:string[];treads?:{pointsMetres:Point[]}[]}[];regions?:{roomKey:string}[];unresolvedDoorArcHandles?:string[]};
const equal=(a:Point,b:Point)=>Array.isArray(a)&&Array.isArray(b)&&a.length===2&&b.length===2&&a.every(Number.isFinite)&&b.every(Number.isFinite)&&Math.hypot(a[0]-b[0],a[1]-b[1])<=1e-8;
const dist=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
/** Independently check the saved finite original strokes, not just checksums. */
export function validateCadCirculationReview(value:CadCirculationReview,geometry:{sourceSha256:string;floors:Floor[]},geometryHash:string){
 const fail=()=>{throw new Error('CAD circulation interpretation does not match original finite source evidence.');};
 if(value.format!=='reviter-cad-circulation-review'||value.version!==1||value.sourceSha256!==geometry.sourceSha256||value.geometrySha256!==geometryHash||value.appliedToNativeGeometry!==false||value.routingEligible!==false||!Array.isArray(value.graphEdges)||value.graphEdges.length||value.maximumContactGapMetres!==.002||!Array.isArray(value.floors)||new Set(value.floors.map(f=>f.floorId)).size!==value.floors.length)fail();
 for(const review of value.floors){
  const floor=geometry.floors.find(f=>f.id===review.floorId);if(!floor||!Array.isArray(review.doors)||!Array.isArray(review.contacts))fail();
  const primitives=new Map(floor!.primitives.map(p=>[p.sourceHandle,p]));
  const segment=(h:string,i:number):Point[]=>{const p=primitives.get(h);if(!p||!['LINE','LWPOLYLINE'].includes(p.type)||!Number.isInteger(i)||i<0||!p.pointsMetres[i+1])fail();return [p!.pointsMetres[i]!,p!.pointsMetres[i+1]!];};
  const riserIds=new Set<string>();
  for(const w of review.stairRiserWitnesses??[]){
   const identity=w.handle+':'+w.segmentIndex,stair=floor!.stairs.find(s=>s.id===w.stairId),tread=stair?.treads?.[w.treadIndex],source=segment(w.handle,w.segmentIndex);
   if(riserIds.has(identity)||w.comparisonOnly!==true||w.routingEligible!==false||!Number.isInteger(w.treadIndex)||w.treadIndex<0||!tread||w.pointsMetres.length!==2||!source.every((p,i)=>equal(p,w.pointsMetres[i]!)))fail();
   riserIds.add(identity);const [a,b]=tread!.pointsMetres,width=dist(a!,b!),length=dist(source[0]!,source[1]!);
   if(width<.3||length<.3||Math.abs(width-length)>.00003001)fail();
   const u:Point=[(b![0]-a![0])/width,(b![1]-a![1])/width],along=source.map(p=>(p[0]-a![0])*u[0]+(p[1]-a![1])*u[1]).sort((a,b)=>a-b),normal=source.map(p=>Math.abs((p[0]-a![0])*-u[1]+(p[1]-a![1])*u[0]));
   if(Math.abs(along[0]!)>.00003001||Math.abs(along[1]!-width)>.00003001||Math.max(...normal)>.02500001||Math.max(...normal)<=1e-8)fail();
  }
  const used=new Set(floor!.doors.flatMap(d=>d.arcHandles));
  const ids=new Set<string>();
  for(const d of review.doors){
   if(!d.id||ids.has(d.id)||floor!.doors.some(o=>o.id===d.id)||d.floorId!==floor!.id||d.routingEligible!==false||d.access!==null||d.nativeDoorId!==null||!['finite-leaf-quarter-symbol','finite-leaf-double-symbol'].includes(d.recognitionMethod)||!Array.isArray(d.arcHandles)||d.arcHandles.length!==d.sourceLeafWitnesses.length||!d.arcHandles.length||d.arcHandles.length>2||d.arcHandle!==d.arcHandles[0]||!equal(d.closedLeafMetres[0]!,d.hingeMetres)||!Number.isFinite(d.widthMetres)||d.widthMetres<.65||d.widthMetres>4.9||Math.abs(dist(d.closedLeafMetres[0]!,d.closedLeafMetres[1]!)-d.widthMetres)>1e-8)fail();
   ids.add(d.id);
   const u:Point=[(d.closedLeafMetres[1]![0]-d.hingeMetres[0])/d.widthMetres,(d.closedLeafMetres[1]![1]-d.hingeMetres[1])/d.widthMetres];
   const originalLeaves:Point[][]=[];
   const hinges:Point[]=[];
   d.arcHandles.forEach((handle,i)=>{
    if(used.has(handle))fail();used.add(handle);const arc=primitives.get(handle);
    if(!arc||!['ARC','ELLIPSE'].includes(arc.type)||!arc.centreMetres||arc.pointsMetres.length<3)fail();
    const radius=arc!.type==='ARC'?arc!.radiusMetres!:arc!.pointsMetres.reduce((sum,p)=>sum+dist(p,arc!.centreMetres!),0)/arc!.pointsMetres.length;
    const sweep=arc!.type==='ARC'?arc!.sweepRadians!:((arc!.endParameter!-arc!.startParameter!)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
    if(!Number.isFinite(radius)||radius<.65||radius>2.45||sweep<82*Math.PI/180||sweep>98*Math.PI/180||(arc!.type==='ELLIPSE'&&Math.abs(arc!.axisRatio!-1)>.0001))fail();
    const witness=d.sourceLeafWitnesses[i]!,leaf=segment(witness.handle,witness.segmentIndex),length=dist(leaf[0]!,leaf[1]!);
    const [h,o]=dist(leaf[0]!,arc!.centreMetres!)<=dist(leaf[1]!,arc!.centreMetres!)?leaf:[leaf[1]!,leaf[0]!];
    if(length<.65||length>2.45||Math.abs(length-radius)>.08||dist(h!,arc!.centreMetres!)>.08||arc!.pointsMetres.some(p=>Math.abs(dist(p,h!)-length)>.08))fail();
    const ends=[arc!.pointsMetres[0]!,arc!.pointsMetres.at(-1)!],sign=i===0?1:-1,tip:Point=[h![0]+sign*length*u[0],h![1]+sign*length*u[1]];
    if(!ends.some((e,j)=>dist(e,o!)<=.075&&dist(ends[1-j]!,tip)<=.075)||Math.abs((o![0]-h![0])*u[0]+(o![1]-h![1])*u[1])>.002*length||!d.leafHandles.includes(witness.handle))fail();
    if(i===0&&!equal(h!,d.hingeMetres))fail();originalLeaves.push(leaf);hinges.push(h!);
    if(i===0&&JSON.stringify(d.swingPointsMetres)!==JSON.stringify(arc!.pointsMetres))fail();
   });
   if(hinges.length===1&&Math.abs(dist(originalLeaves[0]![0]!,originalLeaves[0]![1]!)-d.widthMetres)>1e-8)fail();
   if(hinges.length===2){const h=hinges[1]!,delta:Point=[h[0]-d.hingeMetres[0],h[1]-d.hingeMetres[1]],width=originalLeaves.reduce((s,l)=>s+dist(l[0]!,l[1]!),0);
    if(Math.abs(delta[0]*u[1]-delta[1]*u[0])>.002||Math.abs(delta[0]*u[0]+delta[1]*u[1]-d.widthMetres)>1e-8||width-d.widthMetres<0||width-d.widthMetres>.15)fail();
    const arcs=d.arcHandles.map(h=>primitives.get(h)!);if(Math.min(...[arcs[0]!.pointsMetres[0]!,arcs[0]!.pointsMetres.at(-1)!].flatMap(p=>[arcs[1]!.pointsMetres[0]!,arcs[1]!.pointsMetres.at(-1)!].map(q=>dist(p,q))))>.002)fail();
   }
   if(!d.thresholdSegmentsMetres.length||d.thresholdSegmentsMetres.length!==d.contactWitnesses.length)fail();
   for(let i=0;i<d.contactWitnesses.length;i++){
    const c=d.contactWitnesses[i]!,s=d.thresholdSegmentsMetres[i]!,a=segment(c.fromHandle,c.fromSegmentIndex),b=segment(c.toHandle,c.toSegmentIndex);
    if(s.length!==2||!equal(s[0]!,c.fromPointMetres)||!equal(s[1]!,c.toPointMetres)||!a.some(p=>equal(p,s[0]!))||!b.some(p=>equal(p,s[1]!))||![c.fromHandle,c.toHandle].every(h=>d.supportingWallHandles.includes(h)))fail();
    const along=(p:Point)=>(p[0]-d.hingeMetres[0])*u[0]+(p[1]-d.hingeMetres[1])*u[1],normal=(p:Point)=>(p[0]-d.hingeMetres[0])*-u[1]+(p[1]-d.hingeMetres[1])*u[0];
    if(along(s[0]!)<-.25||along(s[0]!)>.06||along(s[1]!)<d.widthMetres-.06||along(s[1]!)>d.widthMetres+.25||Math.abs(normal(s[0]!)-normal(s[1]!))>.00010001||Math.abs(normal(s[0]!))>.22)fail();
    for(const l of [a,b])if(dist(l[0]!,l[1]!)<.04||Math.abs(normal(l[0]!)-normal(l[1]!))/dist(l[0]!,l[1]!)>.002)fail();
   }
   for(const l of d.leafSegmentsMetres){
    if(!d.leafHandles.some(h=>{const p=primitives.get(h);return p&&p.pointsMetres.slice(1).some((b,i)=>equal(p.pointsMetres[i]!,l[0]!)&&equal(b,l[1]!));}))fail();
    if(!originalLeaves.some(source=>{const a=source[0]!,b=source[1]!,length=dist(a,b),v:Point=[(b[0]-a[0])/length,(b[1]-a[1])/length],t=l.map(p=>(p[0]-a[0])*v[0]+(p[1]-a[1])*v[1]).sort((a,b)=>a-b);return Math.abs(dist(l[0]!,l[1]!)-length)<=.16&&l.every(p=>Math.abs((p[0]-a[0])*-v[1]+(p[1]-a[1])*v[0])<=.06000001)&&t[0]!>=-.15&&t[0]!<=.15&&t[1]!>=length-.15&&t[1]!<=length+.15;}))fail();
   }
  }
  const excluded=new Set([...floor!.doors,...review.doors].flatMap(d=>[...d.arcHandles,...d.leafHandles]));floor!.stairs.forEach(s=>s.sourceHandles.forEach(h=>excluded.add(h)));
  for(const candidate of review.entranceCandidates??[]){
   if(candidate.status!=='proposal-only'||candidate.applied!==false||candidate.physicalDoorId!==null||candidate.routingEligible!==false||candidate.access!==null||candidate.capWitnesses.length!==2||candidate.pointsMetres.length!==2||candidate.widthMetres<.5||candidate.widthMetres>2.5||Math.abs(dist(candidate.pointsMetres[0]!,candidate.pointsMetres[1]!)-candidate.widthMetres)>1e-8)fail();
   const caps=candidate.capWitnesses.map((w,i)=>{const cap=segment(w.handle,w.segmentIndex),middle:Point=[(cap[0]![0]+cap[1]![0])/2,(cap[0]![1]+cap[1]![1])/2];if(!equal(middle,candidate.pointsMetres[i]!)||dist(cap[0]!,cap[1]!)<.07||dist(cap[0]!,cap[1]!)>.65)fail();return cap;});
   const cap=caps[0]!,length=dist(cap[0]!,cap[1]!),u:Point=[(cap[1]![0]-cap[0]![0])/length,(cap[1]![1]-cap[0]![1])/length],second=caps[1]!,otherLength=dist(second[0]!,second[1]!);
   if(Math.abs(length-otherLength)>.02||Math.abs(((second[1]![0]-second[0]![0])*u[0]+(second[1]![1]-second[0]![1])*u[1])/otherLength)<.9999||Math.abs((candidate.pointsMetres[1]![0]-candidate.pointsMetres[0]![0])*u[0]+(candidate.pointsMetres[1]![1]-candidate.pointsMetres[0]![1])*u[1])>.002)fail();
   if(candidate.roomGroups.filter(g=>g.length).length<2||candidate.roomGroups.flat().some(key=>!floor!.regions?.some(r=>r.roomKey===key))||candidate.previewRingsMetres.some(rings=>!rings.length||rings.some(ring=>ring.length<4||ring.some(p=>!equal(p,p)))))fail();
  }
  ids.clear();
  for(const c of review.contacts){
   if(ids.has(c.id)||!c.id||c.selectionOnly!==true||c.maximumGapMetres!==.002||c.fromEndpointIndex!==0&&c.fromEndpointIndex!==1||!Number.isFinite(c.toFraction)||c.toFraction<0||c.toFraction>1||excluded.has(c.fromHandle)||excluded.has(c.toHandle))fail();ids.add(c.id);
   const a=segment(c.fromHandle,c.fromSegmentIndex),b=segment(c.toHandle,c.toSegmentIndex),p=a[c.fromEndpointIndex]!,q:Point=[b[0]![0]+c.toFraction*(b[1]![0]-b[0]![0]),b[0]![1]+c.toFraction*(b[1]![1]-b[0]![1])];
   if(dist(a[0]!,a[1]!)<.04||dist(b[0]!,b[1]!)<.04||c.pointsMetres.length!==2||!equal(c.pointsMetres[0]!,p)||!equal(c.pointsMetres[1]!,q)||dist(p,q)<=1e-10||dist(p,q)>.00200001||Math.abs(dist(p,q)-c.gapMetres)>1e-8)fail();
   const vx=b[1]![0]-b[0]![0],vy=b[1]![1]-b[0]![1],t=Math.max(0,Math.min(1,((p[0]-b[0]![0])*vx+(p[1]-b[0]![1])*vy)/(vx*vx+vy*vy)));if(Math.abs(t-c.toFraction)>1e-8)fail();
  }
 }
 return value;
}
/** Clone only interpretations. The preserved original is returned separately. */
export function cadInterpretedGeometry<T extends {floors:Floor[]}>(geometry:T,review:CadCirculationReview|null):T{
 if(!review)return geometry;
 return {...geometry,floors:geometry.floors.map(f=>{const derived=review.floors.find(r=>r.floorId===f.id)?.doors??[],used=new Set(derived.flatMap(d=>d.arcHandles));return {...f,doors:[...f.doors,...derived],...(f.unresolvedDoorArcHandles?{unresolvedDoorArcHandles:f.unresolvedDoorArcHandles.filter(h=>!used.has(h))}:{})};})} as T;
}
