import type {RoomDirectoryData} from "../../lib/reviter/room-directory.ts";

export default function SourceCoverage({data,building,records}:{data:RoomDirectoryData;building:string;records:number}) {
  const omitted=data.sourceCoverage?.omittedSheets.filter(s=>building==="all"||s.building===building)??[];
  if(!data.sourceCoverage)return null;
  return <section className="directory-source-coverage" aria-label="Source plan coverage">
    <strong>Source plan coverage · {building==="all"?"Campus":`Building ${building}`}</strong>
    <p>{records} imported source records. {omitted.length ? `${omitted.reduce((n,s)=>n+s.labelCount,0)} source labels were skipped across ${omitted.length} plan${omitted.length===1?"":"s"}.` : "No omitted plans recorded in the source extraction report."}</p>
    {!!omitted.length&&<details open={building!=="all"}><summary>Missing source plans</summary>
      {omitted.map(s=><article key={s.sectionId}><strong>{s.sectionId} · {s.labelCount} labels</strong><p>{s.reason}. This plan is absent from the directory floor selector. Its alignment and Revit level must be verified before adding room boundaries or stair routes.</p></article>)}
    </details>}
    <p>Imported outlines and native geometry still need boundary and access checks.</p>
  </section>;
}
