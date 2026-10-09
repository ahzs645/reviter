import pc from "polygon-clipping";
import {validateNativeMaterialSections, type NativeMaterialSections} from "./native-material-sections";
import {validateReviewedDoorApertures, reviewedDoorWallSourceEvidence} from "./reviewed-door-apertures";
/** Portable source sidecar. Keep this wire schema and validation in sync with
 * Reviter/lib/reviter/native-boundary-patches.ts. The RVT itself is preserved. */
type Point = [number, number];
type Rings = Point[][];
export type BoundaryWall = {
  levelId: number;
  nativeElementId: number;
  ringsFeet: Rings;
  kind?: "wall" | "column";
  approximate?: boolean;
  reviewPatchId?: string;
};
export type NativeBoundaryPatch = {
  /** A reviewed reconstruction along an exact native cap's original axis.
   * This does not relax the six-foot automatic/manual gap detector. */
  continuationProof?: {
    sourceWallId: number;
    sourceCapFeet: [Point, Point];
    targetContactFeet: [Point, Point];
    /** Consecutive certified locally convex column faces across the full cap strip. */
    targetContactPathFeet?: Point[];
    /** Exact tiny original middle contact; both cap corners must still be outside. */
    originalCapMiddlePenetrationFeet?: number;
    /** First finite native wall corner faces, verified exactly as a column chain. */
    targetWallFaceChain?: true;
    /** First exact native WALL material across an unchanged cap, retaining steps.
     * Separate from the locally convex column/default wall-chain contract. */
    targetWallFirstMaterialProfile?: true;
    evidenceSha256: string;
  };
  drawingReconstructionProof?: {
    sourceDrawingSha256: string;
    sectionId: string;
    evidenceSha256: string;
    registeredRingsFeet: Rings;
    contactAdaptationFeet: number;
  };
  /** Explicit human-authorized construction assumption; never native certification.
   * The three retained drawing faces define a small boxed body; the fourth face
   * is assumed and must remain portable/revisitable. All physical guards apply. */
  assumedEnclosureProof?: {
    sourceDrawingSha256: string;
    sectionId: string;
    evidenceSha256: string;
    registeredFacesFeet: [Point, Point][];
    assumedClosingFaceFeet: [Point, Point];
    registeredRingsFeet: Rings;
    contactAdaptationFeet: number;
    assumedConstruction: "solid-enclosed-box";
    userAuthorization: string;
    revisitRequired: true;
  };
  manualPointsFeet?: [Point, Point];
  id: string;
  levelId: number;
  sourceModelSha256: string;
  status: "proposed" | "applied";
  widthFeet: number;
  ringsFeet: Rings;
  wallEvidence: {
    nativeElementId: number;
    ringsFeet: Rings;
    kind?: "wall" | "column";
  }[];
  nativeDoorIds: number[];
  notes: string;
};
export type NativeBoundaryPatches = {
  version: 1;
  patches: NativeBoundaryPatch[];
};
/** Reconstruct a measured missing run, never a polygon inferred from labels.
 * The starting cap must be a complete original wall edge; its outward normal,
 * width and the target's original face completely determine the strip. */
export function validNativeContinuation(p: NativeBoundaryPatch): boolean {
  try {
    const proof = p.continuationProof;
    if (
      !proof ||
      p.drawingReconstructionProof ||
      p.assumedEnclosureProof ||
      p.manualPointsFeet ||
      p.nativeDoorIds.length ||
      !Number.isSafeInteger(proof.sourceWallId) ||
      !/^[a-f0-9]{64}$/.test(proof.evidenceSha256)
    )
      return false;
    const pair = (v: Point[]) =>
      Array.isArray(v) &&
      v.length === 2 &&
      v.every(
        (q) =>
          Array.isArray(q) &&
          q.length === 2 &&
          q.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7),
      );
    if ((proof.originalCapMiddlePenetrationFeet !== undefined || proof.targetWallFaceChain !== undefined || proof.targetWallFirstMaterialProfile !== undefined) && !proof.targetContactPathFeet) return false;
    if (!pair(proof.sourceCapFeet) || !pair(proof.targetContactFeet))
      return false;
    const source = p.wallEvidence.find(
      (w) => w.nativeElementId === proof.sourceWallId,
    );
    const target = p.wallEvidence.find(
      (w) => w.nativeElementId !== proof.sourceWallId,
    );
    if (!source || !target || source.kind === "column") return false;
    const [a, b] = proof.sourceCapFeet,
      [c, d] = proof.targetContactFeet;
    const mid = (x: Point, y: Point): Point => [
      (x[0] + y[0]) / 2,
      (x[1] + y[1]) / 2,
    ];
    const o = mid(a, b),
      end = mid(c, d);
    const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const v: Point = [(b[0] - a[0]) / width, (b[1] - a[1]) / width];
    const u: Point = [-v[1], v[0]];
    if ((end[0] - o[0]) * u[0] + (end[1] - o[1]) * u[1] < 0) {
      u[0] = -u[0];
      u[1] = -u[1];
    }
    const contactDepths = [c, d].map(
      (q) => (q[0] - o[0]) * u[0] + (q[1] - o[1]) * u[1],
    );
    const gap = Math.max(...contactDepths);
    if (
      // One original cap corner may already touch an oblique supporting face.
      // The other must still have a positive missing run; an entirely touching
      // cap is a numerical topology case, not a construction continuation.
      Math.min(...contactDepths) < 0 ||
      gap <= 1e-7 ||
      gap > 20 ||
      width < 0.05 ||
      width > 6 ||
      Math.abs(gap - p.widthFeet) > 1e-6
    )
      return false;
    const project = (q: Point): Point => [
      (q[0] - o[0]) * u[0] + (q[1] - o[1]) * u[1],
      (q[0] - o[0]) * v[0] + (q[1] - o[1]) * v[1],
    ];
    const distance = (q: Point, x: Point, y: Point) => {
      const dx = y[0] - x[0],
        dy = y[1] - x[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((q[0] - x[0]) * dx + (q[1] - x[1]) * dy) /
              (dx * dx + dy * dy || 1),
          ),
        );
      return Math.hypot(q[0] - x[0] - t * dx, q[1] - x[1] - t * dy);
    };
    const near = (x: Point, y: Point) =>
      Math.hypot(x[0] - y[0], x[1] - y[1]) <= 1e-6;
    const edgeMatch = source.ringsFeet[0].some((q, i) => {
      const next = source.ringsFeet[0][(i + 1) % source.ringsFeet[0].length];
      return (near(a, q) && near(b, next)) || (near(b, q) && near(a, next));
    });
    // A rectangular native wall's long face is not an end cap. Extending
    // from it would rotate the original wall axis and change its thickness.
    if (
      source.ringsFeet[0].length === 4 &&
      Math.abs(
        width -
          Math.min(
            ...source.ringsFeet[0].map((q, i) =>
              Math.hypot(
                q[0] - source.ringsFeet[0][(i + 1) % 4][0],
                q[1] - source.ringsFeet[0][(i + 1) % 4][1],
              ),
            ),
          ),
      ) > 1e-6
    )
      return false;
    if (!edgeMatch || source.ringsFeet[0].some((q) => project(q)[0] > 1e-6))
      return false;
    if (proof.targetContactPathFeet) {
      const path = proof.targetContactPathFeet;
      if (
        (target.kind !== "column" && !(target.kind === "wall" && (proof.targetWallFaceChain === true || proof.targetWallFirstMaterialProfile === true))) ||
        (proof.targetWallFaceChain !== undefined && (proof.targetWallFaceChain !== true || target.kind !== "wall")) ||
        (proof.targetWallFirstMaterialProfile !== undefined && (proof.targetWallFirstMaterialProfile !== true || target.kind !== "wall" || proof.targetWallFaceChain !== undefined || proof.originalCapMiddlePenetrationFeet !== undefined)) ||
        target.ringsFeet.length !== 1 ||
        target.ringsFeet[0].length < 3 ||
        target.ringsFeet[0].length > 128 ||
        !Array.isArray(path) ||
        path.length < (target.kind === "wall" && (proof.targetWallFaceChain === true || proof.targetWallFirstMaterialProfile === true) ? 2 : 3) ||
        path.length > target.ringsFeet[0].length + 2 ||
        path.some(
          (q) =>
            !Array.isArray(q) ||
            q.length !== 2 ||
            q.some((n) => !Number.isFinite(n) || Math.abs(n) >= 1e7),
        ) ||
        !near(path[0], c) ||
        !near(path[path.length - 1], d) ||
        path
          .slice(1, -1)
          .some((point) => !target.ringsFeet[0].some((q) => near(q, point)))
      )
        return false;
      const rawTarget = target.ringsFeet[0];
      // Native section descriptors may explicitly close a ring. The repeated
      // terminal vertex is the same source point, not a degenerate inner edge.
      const col = rawTarget.length > 3 && rawTarget[0][0] === rawTarget[rawTarget.length - 1][0] && rawTarget[0][1] === rawTarget[rawTarget.length - 1][1] ? rawTarget.slice(0, -1) : rawTarget,
        cross = (x: Point, y: Point, z: Point) =>
          (y[0] - x[0]) * (z[1] - x[1]) - (y[1] - x[1]) * (z[0] - x[0]);
      // Preserve the exact native column, including notches away from this cap.
      // The contacted chain must be locally convex and the original outline simple.
      const turns = path.slice(0,-2).map((q,i)=>cross(q,path[i+1],path[i+2]));
      if (proof.targetWallFirstMaterialProfile !== true && !(turns.every((n)=>n>=-1e-10)||turns.every((n)=>n<=1e-10)))return false;
      for(let i=0;i<col.length;i++){
        const a=col[i],b=col[(i+1)%col.length];
        if(near(a,b))return false;
        for(let j=i+1;j<col.length;j++){
          if(j===i+1||(i===0&&j===col.length-1))continue;
          const c=col[j],d=col[(j+1)%col.length];
          if(Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b))<=1e-8 ||
             (cross(a,b,c)*cross(a,b,d)<-1e-20&&cross(c,d,a)*cross(c,d,b)<-1e-20))return false;
        }
      }
      if (
        !path
          .slice(0, -1)
          .every((_, i) =>
            col.some(
              (q, j) =>
                distance(path[i], q, col[(j + 1) % col.length]) <= 1e-6 &&
                distance(path[i + 1], q, col[(j + 1) % col.length]) <= 1e-6,
            ),
          )
      )
        return false;
      const pp = path.map(project);
      const declaredMiddle = proof.originalCapMiddlePenetrationFeet;
      const middlePenetration = Math.max(0, ...pp.slice(1, -1).map(q => -q[0]));
      if (declaredMiddle !== undefined &&
          (!Number.isFinite(declaredMiddle) || declaredMiddle <= 0 ||
           declaredMiddle > 0.00025 || Math.abs(declaredMiddle - middlePenetration) > 1e-8 ||
           contactDepths.some(depth => depth <= 0))) return false;
      const permittedMiddle = declaredMiddle ?? 0;
      if (
        Math.abs(pp[0][1] + width / 2) > 1e-6 ||
        Math.abs(pp[pp.length - 1][1] - width / 2) > 1e-6 ||
        pp.some((q, i) => i > 0 && (proof.targetWallFirstMaterialProfile === true ? q[1] < pp[i - 1][1] - 1e-10 || near(q, pp[i - 1]) : q[1] <= pp[i - 1][1] + 1e-10)) ||
        pp.some((q, i) => (q[0] <= 0 && (declaredMiddle === undefined || i === 0 || i === pp.length - 1 || q[0] < -permittedMiddle - 1e-10)) || q[0] > gap + 1e-6)
      )
        return false;
      // The cap rays must hit these near faces first, not the far side of a
      // column. A measured path cannot turn into a route around its support.
      // All projected column vertices are linear-intersection breakpoints. Testing
      // them and every interval midpoint certifies first contact across the entire
      // wall width, rather than just two rays which could conceal a middle notch.
      const samples=[...new Set([...pp.map(q=>q[1]),...col.map(q=>project(q)[1]).filter(v=>v>=-width/2&&v<=width/2)])].sort((a,b)=>a-b);
      const rays=[...samples,...samples.slice(1).map((v,i)=>(v+samples[i])/2)];
      for(const lateral of rays){
        const profileHits:number[]=[];
        for(let i=0;i<pp.length-1;i++){
          const q=pp[i],next=pp[i+1];
          if(lateral<q[1]-1e-10||lateral>next[1]+1e-10)continue;
          if(Math.abs(next[1]-q[1])<1e-12){
            if(proof.targetWallFirstMaterialProfile!==true)return false;
            profileHits.push(Math.min(q[0],next[0]));
          }else profileHits.push(q[0]+(lateral-q[1])*(next[0]-q[0])/(next[1]-q[1]));
        }
        if(!profileHits.length)return false;
        const expected=Math.min(...profileHits);
        const hits:number[]=[];
        for(let j=0;j<col.length;j++){
          const x=project(col[j]),y=project(col[(j+1)%col.length]);
          if(Math.abs(y[1]-x[1])<1e-12)continue;
          const t=(lateral-x[1])/(y[1]-x[1]);
          if(t>=-1e-10&&t<=1+1e-10){const h=x[0]+t*(y[0]-x[0]);if(h>0 || (permittedMiddle > 0 && h >= -permittedMiddle - 1e-10))hits.push(h);}
        }
        if(!hits.length||Math.abs(Math.min(...hits)-expected)>1e-6)return false;
      }
      const qs = p.ringsFeet[0].map(project);
      if (qs.length !== path.length + 2) return false;
      const lo = Math.min(...qs.map((q) => q[0]));
      if (lo > 0 || lo < -0.020001) return false;
      const starts = qs.filter((q) => Math.abs(q[0] - lo) < 1e-6),
        rawFar = qs.filter((q) => Math.abs(q[0] - lo) >= 1e-6),
        far = proof.targetWallFirstMaterialProfile === true
          ? pp.map(q=>rawFar.reduce((best,p)=>Math.hypot(p[0]-q[0],p[1]-q[1])<Math.hypot(best[0]-q[0],best[1]-q[1])?p:best,rawFar[0]??[Infinity,Infinity]))
          : rawFar.sort((x, y) => x[1] - y[1]);
      if(proof.targetWallFirstMaterialProfile===true && new Set(far).size!==rawFar.length)return false;
      if (
        starts.length !== 2 ||
        far.length !== path.length ||
        starts.some((q) => Math.abs(Math.abs(q[1]) - width / 2) > 1e-6) ||
        Math.abs(far[0][1] + width / 2) > 1e-6 ||
        Math.abs(far[far.length - 1][1] - width / 2) > 1e-6
      )
        return false;
      if (
        far.some(
          (q, i) =>
            Math.hypot(q[0] - pp[i][0], q[1] - pp[i][1]) > 0.020001 ||
            q[0] < pp[i][0] - 1e-6 ||
            Math.abs(q[1]) > width / 2 + 1e-6,
        )
      )
        return false;
      for (let j = 0; j < pp.length - 1; j++) {
        const ex = pp[j + 1][0] - pp[j][0],
          ey = pp[j + 1][1] - pp[j][1],
          fx = far[j + 1][0] - far[j][0],
          fy = far[j + 1][1] - far[j][1];
        if (
          Math.abs(ex * fy - ey * fx) >
          1e-6 * Math.hypot(ex, ey) * Math.hypot(fx, fy)
        )
          return false;
      }
      const expected: Point[] = [
        [lo, -width / 2],
        [lo, width / 2],
        ...far.slice().reverse(),
      ];
      const cycle = (points: Point[]) =>
        points.some((_, start) =>
          qs.every((q, j) => near(q, points[(start + j) % points.length])),
        );
      return cycle(expected) || cycle([...expected].reverse());
    }
    if (
      !target.ringsFeet[0].some(
        (q, i) =>
          distance(
            c,
            q,
            target.ringsFeet[0][(i + 1) % target.ringsFeet[0].length],
          ) <= 1e-6 &&
          distance(
            d,
            q,
            target.ringsFeet[0][(i + 1) % target.ringsFeet[0].length],
          ) <= 1e-6,
      ) ||
      target.ringsFeet[0].some((q) => {
        const [t, x] = project(q),
          [tc, xc] = project(c),
          [td, xd] = project(d);
        return (
          Math.abs(xd - xc) < 1e-6 ||
          t < tc + ((td - tc) * (x - xc)) / (xd - xc) - 1e-6
        );
      })
    )
      return false;
    if (
      [c, d].some((q) => Math.abs(Math.abs(project(q)[1]) - width / 2) > 1e-6)
    )
      return false;
    const qs = p.ringsFeet[0].map(project),
      lo = Math.min(...qs.map((q) => q[0]));
    const starts = qs.filter((q) => Math.abs(q[0] - lo) < 1e-6);
    const ends = qs.filter((q) => Math.abs(q[0] - lo) >= 1e-6);
    if (
      lo > 0 ||
      lo < -0.020001 ||
      starts.length !== 2 ||
      ends.length !== 2 ||
      qs.some((q) => Math.abs(Math.abs(q[1]) - width / 2) > 1e-6) ||
      ends.some((q) => {
        const contact = [project(c), project(d)].find(
          (x) => Math.abs(q[1] - x[1]) < 1e-6,
        );
        return (
          !contact || q[0] < contact[0] - 1e-6 || q[0] > contact[0] + 0.020001
        );
      }) ||
      new Set(
        qs.map((q) => `${Math.round(q[0] * 1e6)},${Math.round(q[1] * 1e6)}`),
      ).size !== 4
    )
      return false;
    const area =
      Math.abs(
        qs.reduce((sum, q, i) => {
          const n = qs[(i + 1) % 4];
          return sum + q[0] * n[1] - n[0] * q[1];
        }, 0),
      ) / 2;
    return Math.abs(area - ((ends[0][0] + ends[1][0]) / 2 - lo) * width) < 1e-6;
  } catch {
    return false;
  }
}
/** A separately declared reconstruction follows independently registered
 * source wall faces. It is never inferred from a room annotation or a gap scan.
 * Exact native contacts and the complete compound set are checked on preview. */
export function validDrawingReconstruction(p: NativeBoundaryPatch): boolean {
  const proof = p.drawingReconstructionProof;
  if (
    !proof ||
    p.continuationProof ||
    p.assumedEnclosureProof ||
    p.manualPointsFeet ||
    p.nativeDoorIds.length ||
    !/^[a-f0-9]{64}$/.test(proof.sourceDrawingSha256) ||
    !/^[a-f0-9]{64}$/.test(proof.evidenceSha256) ||
    typeof proof.sectionId !== "string" ||
    !proof.sectionId.trim() ||
    proof.sectionId.length > 200 ||
    !Number.isFinite(proof.contactAdaptationFeet) ||
    proof.contactAdaptationFeet < 0 ||
    proof.contactAdaptationFeet > 0.15 ||
    !Array.isArray(proof.registeredRingsFeet) ||
    proof.registeredRingsFeet.length !== 1 ||
    proof.registeredRingsFeet[0]?.length !== 4
  )
    return false;
  const r = proof.registeredRingsFeet[0],
    q = p.ringsFeet[0];
  if (
    r.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        p.some((n) => !Number.isFinite(n) || Math.abs(n) >= 1e7),
    )
  )
    return false;
  const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (q.some((p, i) => distance(p, r[i]) > proof.contactAdaptationFeet + 1e-6))
    return false;
  const lengths = r.map((p, i) => distance(p, r[(i + 1) % 4]));
  const shortest = lengths.indexOf(Math.min(...lengths));
  const a = r[shortest],
    b = r[(shortest + 1) % 4],
    width = distance(a, b);
  if (
    width < 0.05 ||
    Math.max(...lengths) > 20 ||
    Math.abs(p.widthFeet - Math.max(...lengths)) > 1e-6
  )
    return false;
  // A square drawn body has no unique thickness axis. Independently
  // transformed Float64 faces can differ by a few ulps; an arbitrary minimum
  // edge must not decide which contact end may extend. Try only original
  // shortest edges tied at native coordinate precision, preserving both
  // opposing projected widths. No original vertex or contact is changed.
  const tiedEdgeError = 16 * Number.EPSILON * Math.max(1, ...r.flat().map(Math.abs));
  const retainedWidth = lengths.some((candidate, index) => {
    if (candidate - width > tiedEdgeError) return false;
    const start = r[index], end = r[(index + 1) % 4];
    const v: Point = [(end[0] - start[0]) / candidate, (end[1] - start[1]) / candidate];
    const projection = (p: Point) => p[0] * v[0] + p[1] * v[1];
    return [
      Math.abs(projection(q[(index + 1) % 4]) - projection(q[index])),
      Math.abs(projection(q[(index + 2) % 4]) - projection(q[(index + 3) % 4])),
    ].every(n => Math.abs(n - candidate) <= 0.001);
  });
  if (!retainedWidth) return false;
  const cross = q.map((p, i) => {
    const b = q[(i + 1) % 4],
      c = q[(i + 2) % 4];
    return (b[0] - p[0]) * (c[1] - b[1]) - (b[1] - p[1]) * (c[0] - b[0]);
  });
  return cross.every((n) => n > 1e-8) || cross.every((n) => n < -1e-8);
}
/** An assumption retains the exact three registered outer faces and declares
 * the fourth as assumed. A rigid bounded translation reaches native contacts;
 * no stretching or equal opposite-side approximation is allowed. */
export function validAssumedEnclosure(p: NativeBoundaryPatch): boolean {
  try {
    const proof = p.assumedEnclosureProof;
    if (!proof || p.continuationProof || p.drawingReconstructionProof ||
        p.manualPointsFeet || p.nativeDoorIds.length ||
        proof.assumedConstruction !== "solid-enclosed-box" ||
        proof.revisitRequired !== true ||
        !/^[a-f0-9]{64}$/.test(proof.sourceDrawingSha256) ||
        !/^[a-f0-9]{64}$/.test(proof.evidenceSha256) ||
        typeof proof.sectionId !== "string" || !proof.sectionId.trim() || proof.sectionId.length > 200 ||
        typeof proof.userAuthorization !== "string" ||
        !proof.userAuthorization.trim() || proof.userAuthorization.length > 2000 ||
        !Number.isFinite(proof.contactAdaptationFeet) || proof.contactAdaptationFeet < 0 || proof.contactAdaptationFeet > .15 ||
        !Array.isArray(proof.registeredFacesFeet) || proof.registeredFacesFeet.length !== 3 ||
        !Array.isArray(proof.registeredRingsFeet) || proof.registeredRingsFeet.length !== 1 ||
        proof.registeredRingsFeet[0]?.length !== 4 ||
        p.ringsFeet?.length !== 1 || p.ringsFeet[0]?.length !== 4 ||
        p.widthFeet > 6 || p.wallEvidence.some(w => w.kind === "column")) return false;
    const r = proof.registeredRingsFeet[0], q = p.ringsFeet[0];
    if ([...r, ...q].some(p => !Array.isArray(p) || p.length !== 2 ||
        p.some(n => !Number.isFinite(n) || Math.abs(n) >= 1e7))) return false;
    const match = (pair: unknown, a: Point, b: Point) =>
      Array.isArray(pair) && pair.length === 2 &&
      pair.every((q, i) => Array.isArray(q) && q.length === 2 &&
        q.every((n, j) => Number.isFinite(n) && Math.abs(n - (i ? b : a)[j]) < 1e-8));
    if (!proof.registeredFacesFeet.every((face, i) => match(face, r[i], r[i + 1])) ||
        !match(proof.assumedClosingFaceFeet, r[3], r[0])) return false;
    for (const ring of [r,q]) {
      const turns = ring.map((a, i) => {
        const b = ring[(i + 1) % 4], c = ring[(i + 2) % 4];
        return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
      });
      if (!turns.every(n => n > 1e-8) && !turns.every(n => n < -1e-8)) return false;
    }
    const lengths = r.map((a,i) => Math.hypot(a[0]-r[(i+1)%4][0],a[1]-r[(i+1)%4][1]));
    if (Math.min(...lengths) < .05 || Math.max(...lengths) > 6 ||
        Math.abs(p.widthFeet-Math.max(...lengths)) > 1e-6) return false;
    const dx=q[0][0]-r[0][0],dy=q[0][1]-r[0][1];
    return Math.hypot(dx,dy) <= proof.contactAdaptationFeet + 1e-6 &&
      q.every((p,i) => Math.abs(p[0]-r[i][0]-dx)<1e-6 && Math.abs(p[1]-r[i][1]-dy)<1e-6);
  } catch { return false; }
}
export function validateNativeBoundaryPatches(
  value: unknown,
  modelSha?: string,
): asserts value is NativeBoundaryPatches | undefined {
  if (value === undefined) return;
  const v = value as NativeBoundaryPatches;
  const rings = (r: Rings) =>
    Array.isArray(r) &&
    r.length === 1 &&
    Array.isArray(r[0]) &&
    r[0].length >= 3 &&
    r[0].length <= 10000 &&
    r[0].every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7),
    );
  if (
    !v ||
    v.version !== 1 ||
    !Array.isArray(v.patches) ||
    v.patches.length > 5000 ||
    v.patches.some((p) => !p || typeof p !== "object") ||
    new Set(v.patches.map((p) => p.id)).size !== v.patches.length ||
    v.patches.some(
      (p) =>
        !p ||
        typeof p.id !== "string" ||
        !p.id ||
        p.id.length > 200 ||
        !Number.isSafeInteger(p.levelId) ||
        !/^[a-f0-9]{64}$/.test(p.sourceModelSha256) ||
        (modelSha !== undefined && p.sourceModelSha256 !== modelSha) ||
        !["proposed", "applied"].includes(p.status) ||
        !Number.isFinite(p.widthFeet) ||
        p.widthFeet <= 0 ||
        p.widthFeet >
          (p.continuationProof || p.drawingReconstructionProof ? 20 : 6) ||
        (p.manualPointsFeet !== undefined &&
          (!Array.isArray(p.manualPointsFeet) ||
            p.manualPointsFeet.length !== 2 ||
            p.manualPointsFeet.some(
              (q) =>
                !Array.isArray(q) ||
                q.length !== 2 ||
                q.some((n) => !Number.isFinite(n) || Math.abs(n) >= 1e7),
            ))) ||
        !rings(p.ringsFeet) ||
        p.ringsFeet[0].length !==
          (p.continuationProof?.targetContactPathFeet
            ? p.continuationProof.targetContactPathFeet.length + 2
            : 4) ||
        p.ringsFeet[0].some(
          (q, i) =>
            Math.hypot(
              q[0] - p.ringsFeet[0][(i + 1) % p.ringsFeet[0].length][0],
              q[1] - p.ringsFeet[0][(i + 1) % p.ringsFeet[0].length][1],
            ) >
            (p.continuationProof || p.drawingReconstructionProof
              ? 20.35
              : 6.05),
        ) ||
        !Array.isArray(p.wallEvidence) ||
        p.wallEvidence.length !== 2 ||
        p.wallEvidence.some(
          (w) =>
            !w ||
            !Number.isSafeInteger(w.nativeElementId) ||
            w.nativeElementId <= 0 ||
            (w.kind !== undefined && !["wall", "column"].includes(w.kind)) ||
            (w.kind === "column" &&
              !p.continuationProof &&
              !p.drawingReconstructionProof) ||
            !rings(w.ringsFeet),
        ) ||
        p.wallEvidence[0].nativeElementId ===
          p.wallEvidence[1].nativeElementId ||
        !Array.isArray(p.nativeDoorIds) ||
        p.nativeDoorIds.length > 100 ||
        p.nativeDoorIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
        typeof p.notes !== "string" ||
        !p.notes.trim() ||
        p.notes.length > 10000 ||
        (p.continuationProof !== undefined && !validNativeContinuation(p)) ||
        (p.drawingReconstructionProof !== undefined &&
          !validDrawingReconstruction(p)) ||
        (p.assumedEnclosureProof !== undefined && !validAssumedEnclosure(p)),
    )
  )
    throw new Error(
      "Invalid native boundary patch geometry or model identity.",
    );
}
/** Compare complete independently recovered owner material, never a cropped
 * footprint. The 1e-10 ft analytical grid removes only floating-point union
 * duplicates; no source coordinates are changed and every nonzero hole stays. */
export function sameNativeMaterialEvidence(a: Rings, b: Rings): boolean {
  const ringKey = (raw: Point[]) => {
    let points = raw.map(([x,y]) => [Math.round(x*1e10),Math.round(y*1e10)]);
    if (points.some(p => p.some(n => !Number.isSafeInteger(n)))) return undefined;
    const same = (x: number[], y: number[]) => x[0]===y[0] && x[1]===y[1];
    if (points.length>1 && same(points[0],points[points.length-1])) points.pop();
    points=points.filter((p,i)=>!same(p,points[(i+1)%points.length]));
    let changed=true;
    while(changed && points.length>=3){
      changed=false;
      for(let i=0;i<points.length;i++){
        const p=points[(i+points.length-1)%points.length],q=points[i],r=points[(i+1)%points.length];
        const cross=BigInt(q[0]-p[0])*BigInt(r[1]-q[1])-BigInt(q[1]-p[1])*BigInt(r[0]-q[0]);
        const dx=BigInt(r[0]-p[0]),dy=BigInt(r[1]-p[1]);
        // Quantizing independently collinear source vertices can leave a
        // one-grid-unit lateral residue. Remove only that numerical residue.
        if(cross*cross<=2n*(dx*dx+dy*dy)){points.splice(i,1);changed=true;break;}
      }
    }
    if(points.length<3)return undefined;
    const candidates=[points,points.slice().reverse()].flatMap(ps=>ps.map((_,i)=>JSON.stringify([...ps.slice(i),...ps.slice(0,i)])));
    return candidates.sort()[0];
  };
  const key = (rings: Rings) => {
    if(!rings.length)return undefined;
    const outer=ringKey(rings[0]),holes=rings.slice(1).map(ringKey);
    return outer && holes.every(h=>h!==undefined) ? JSON.stringify([outer,...holes.sort()]) : undefined;
  };
  const left=key(a),right=key(b);
  return left!==undefined && right!==undefined && left===right;
}

const geometryKey = (r: Rings) =>
  JSON.stringify(
    r.map((r) => r.map((p) => p.map((n) => Math.round(n * 1e6) / 1e6))),
  );
/** A source continuation inherits only its own original host's independently
 * approved doorway aperture. Keep the complete recipe for provenance/binding;
 * analytical selection, display and walking material use these exact parts. */
export function boundaryPatchMaterialParts(patch: NativeBoundaryPatch, doorCuts: unknown, modelSha: string): Rings[] {
  validateReviewedDoorApertures(doorCuts, modelSha);
  const owner = patch.continuationProof?.sourceWallId ?? patch.wallEvidence[0].nativeElementId;
  const cuts = (doorCuts?.patches ?? []).filter(p => p.levelId === patch.levelId && p.wallEvidence.some(w => w.nativeElementId === owner));
  return cuts.length ? pc.difference(patch.ringsFeet, ...cuts.map(p => [p.apertureFeet])) as Rings[] : [patch.ringsFeet];
}
/** Bind historical provenance separately from actual current material contact. */
export function validateCurrentBoundaryContacts(patches: NativeBoundaryPatch[], currentWalls: (levelId: number) => BoundaryWall[], effective: (patch: NativeBoundaryPatch) => Rings[] = p => [p.ringsFeet]): void {
 const area = (parts: Rings[]) => parts.reduce((sum, rings) => sum + rings.reduce((a, ring, hole) => {
   const [ox,oy] = ring[0];
   return a + (hole ? -1 : 1) * Math.abs(ring.reduce((s, point, i) => { const next = ring[(i + 1) % ring.length]; return s + (point[0]-ox) * (next[1]-oy) - (next[0]-ox) * (point[1]-oy); }, 0)) / 2;
 }, 0), 0);
 const touches = (a: Rings, b: Rings) => {
   try { return area(pc.intersection(a, b) as Rings[]) > 1e-8; }
   catch (originalError) {
     // Retry only a failed sweep at a common local origin. This analytical
     // comparison never changes saved source faces or dilates either operand.
     const origin = a[0][0];
     const local = (rings: Rings): Rings => rings.map(r => r.map(p => [p[0]-origin[0], p[1]-origin[1]]));
     try { return area(pc.intersection(local(a), local(b)) as Rings[]) > 1e-8; } catch {}
     for (const grid of [1e-12,1e-11,1e-10]) {
       let valid = true;
       const points = new Map<string, Point[]>();
       const quantize = (rings: Rings): Rings => rings.map(r => {
         const ring = r.map(p => {
           const dx=p[0]-origin[0],dy=p[1]-origin[1];
           if (Math.max(Math.abs(dx),Math.abs(dy))/grid > Number.MAX_SAFE_INTEGER) valid=false;
           const q: Point = [Math.round(dx/grid)*grid,Math.round(dy/grid)*grid], key=q.join(',');
           const previous = points.get(key) ?? [];
           for (const other of previous) if (Math.hypot(p[0]-other[0],p[1]-other[1]) > 4*Number.EPSILON*Math.max(1,...p.map(Math.abs),...other.map(Math.abs))) valid=false;
           points.set(key,[...previous,p]); return q;
         });
         // A real hole or narrow ring may not disappear in the comparison.
         if (new Set(ring.map(p=>p.join(','))).size < 3) valid=false;
         return ring;
       });
       const aa=quantize(a),bb=quantize(b);
       if (!valid) continue;
       try { return area(pc.intersection(aa,bb) as Rings[]) > 1e-8; } catch {}
     }
     throw originalError;
   }
 };
 for (const levelId of new Set(patches.map(p => p.levelId))) {
  const local = patches.filter(p => p.levelId === levelId);
  const physical = currentWalls(levelId).filter(w => !w.reviewPatchId && !w.approximate && w.levelId === levelId);
  const owners = new Map<number, BoundaryWall[]>();
  for (const wall of physical) owners.set(wall.nativeElementId, [...owners.get(wall.nativeElementId) ?? [], wall]);
  // A full-width corner can require overlapping continuations. Only positive
  // material overlap on this same level can join their original supports.
  const material = local.map(effective);
  const neighbours = local.map((p, i) => local.flatMap((other, j) => i !== j && material[i].some(a => material[j].some(b => touches(a,b))) ? [j] : []));
  for (let i = 0; i < local.length; i++) {
   const reached = new Set([i]), pending = [i];
   while (pending.length) for (const j of neighbours[pending.pop()!]) if (!reached.has(j)) { reached.add(j); pending.push(j); }
   for (const support of local[i].wallEvidence) {
    if (![...reached].some(j => (owners.get(support.nativeElementId) ?? []).some(w => w.kind === (support.kind ?? 'wall') && material[j].some(rings => touches(rings, w.ringsFeet)))))
     throw new Error(`Boundary patch ${local[i].id} does not contact actual current native material #${support.nativeElementId}. Review or supersede it before regeneration.`);
   }
  }
 }
}
/** Exact source wall evidence is checked again during regeneration. */
export function reviewedBoundaryWalls(
  walls: BoundaryWall[],
  value: NativeBoundaryPatches | undefined,
  modelSha: string,
  levelId?: number,
  doorCuts?: unknown,
  materialSections?: NativeMaterialSections,
  currentContactWalls?: (levelId: number) => BoundaryWall[],
): BoundaryWall[] {
  validateNativeBoundaryPatches(value, modelSha);
  walls=reviewedDoorWallSourceEvidence(walls,doorCuts,modelSha,value);
  // Compose historical aperture evidence first. Independently recovered original
  // plan faces supplement source contacts without replacing prepared jamb rows.
  // Package/worker/compiler entry points verify this descriptor's checksum.
  validateNativeMaterialSections(materialSections, modelSha);
  const materialWalls: BoundaryWall[] = (materialSections?.levels ?? [])
    .filter(row => Math.abs(row.cutElevationFeet - row.elevationFeet - 4) < 1e-6)
    .flatMap(row => row.sections.flatMap(section => section.partsFeet.map(ringsFeet => ({
      levelId: row.levelId, nativeElementId: section.nativeElementId,
      kind: section.kind === 'column' ? 'column' as const : 'wall' as const,
      ringsFeet,
    }))));
  const actualByLevel = new Map<number, BoundaryWall[]>();
  const actual = currentContactWalls ? (id: number) => {
    if (!actualByLevel.has(id)) actualByLevel.set(id, currentContactWalls(id));
    return actualByLevel.get(id)!;
  } : undefined;
  const applied = (value?.patches ?? []).filter(p => p.status === "applied" && (levelId === undefined || p.levelId === levelId));
  walls = [...walls, ...materialWalls, ...(actual ? [...new Set(applied.map(p => p.levelId))].flatMap(actual) : [])];
  if (actual) validateCurrentBoundaryContacts(applied, actual, p => boundaryPatchMaterialParts(p, doorCuts, modelSha));
  return (value?.patches ?? [])
    .filter(
      (p) =>
        p.status === "applied" &&
        (levelId === undefined || p.levelId === levelId),
    )
    .map((p) => {
      if (
        p.wallEvidence.some(
          (e) =>
            !walls.some(
              (w) =>
                !w.reviewPatchId &&
                !w.approximate &&
                w.kind === (e.kind ?? "wall") &&
                w.levelId === p.levelId &&
                w.nativeElementId === e.nativeElementId &&
                (geometryKey(w.ringsFeet) === geometryKey(e.ringsFeet) ||
                  ((actualByLevel.get(p.levelId) ?? []).includes(w) && sameNativeMaterialEvidence(w.ringsFeet, e.ringsFeet))),
            ),
        )
      )
        throw new Error(
          `Boundary patch ${p.id} has stale native wall evidence. Review it again.`,
        );
      return {
        levelId: p.levelId,
        nativeElementId:
          p.continuationProof?.sourceWallId ??
          p.wallEvidence[0].nativeElementId,
        kind: "wall",
        ringsFeet: p.ringsFeet,
        reviewPatchId: p.id,
      };
    });
}
/** Authoring metadata must agree with its derived tagged wall faces. */
export function validateNativeBoundaryBinding(
  walls: BoundaryWall[],
  value: NativeBoundaryPatches | undefined,
  modelSha: string,
  state?: { patchIds: string[]; regenerated: boolean },
  doorCuts?: unknown,
  materialSections?: NativeMaterialSections,
  currentContactWalls?: (levelId: number) => BoundaryWall[],
): void {
  const expected = reviewedBoundaryWalls(walls, value, modelSha, undefined, doorCuts, materialSections, currentContactWalls);
  const tagged = walls.filter((w) => w.reviewPatchId);
  const ids = expected.map((w) => w.reviewPatchId!).sort();
  if (
    JSON.stringify(ids) !==
      JSON.stringify([...(state?.patchIds ?? [])].sort()) ||
    tagged.length !== expected.length ||
    expected.some(
      (e) =>
        !tagged.some(
          (w) =>
            w.reviewPatchId === e.reviewPatchId &&
            w.levelId === e.levelId &&
            w.nativeElementId === e.nativeElementId &&
            w.kind === "wall" &&
            !w.approximate &&
            geometryKey(w.ringsFeet) === geometryKey(e.ringsFeet),
        ),
    )
  )
    throw new Error(
      "Native boundary patches do not match the reviewed geometry. Regenerate or review them again.",
    );
}
