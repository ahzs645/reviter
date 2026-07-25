/**
 * IFC4 STEP export.
 *
 * Recovered envelopes are emitted as `IfcBuildingElementProxy`. The Revit
 * category is decoded, but the geometry is still an axis-aligned envelope, so
 * the category travels in the name and description rather than promoting the
 * proxy to `IfcWall` or `IfcSlab` and overstating what was recovered.
 */
import { outputName } from "./export-naming.ts";

import type { ConvertResult } from "./types";

const ifcAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

function ifcGuid(index: number, salt = 0): string {
  let value = (Math.imul(index + 1, 2_654_435_761) + salt + 31) >>> 0;
  let body = "";
  for (let i = 0; i < 21; i += 1) {
    value = (Math.imul(value ^ (value >>> 15), 2_246_822_519) + i * 3_266_489_917) >>> 0;
    body += ifcAlphabet[value & 63];
  }
  return `2${body}`;
}

function ifcText(value: string): string {
  return value.replace(/'/g, "''").replace(/[\r\n]+/g, " ");
}

export function makeIfcCenterlines(result: ConvertResult): string {
  const entities: string[] = [];
  const add = (expression: string) => {
    const id = entities.length + 1;
    entities.push(`#${id}=${expression};`);
    return id;
  };
  const ownerPerson = add("IFCPERSON($,$,'Reviter',$,$,$,$,$)");
  const organization = add("IFCORGANIZATION($,'Reviter',$,$,$)");
  const personOrg = add(`IFCPERSONANDORGANIZATION(#${ownerPerson},#${organization},$)`);
  const application = add(`IFCAPPLICATION(#${organization},'1.0','Reviter browser converter','REVITER')`);
  const ownerHistory = add(`IFCOWNERHISTORY(#${personOrg},#${application},$,.ADDED.,$,#${personOrg},#${application},0)`);
  const metre = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
  const units = add(`IFCUNITASSIGNMENT((#${metre}))`);
  const worldPoint = add("IFCCARTESIANPOINT((0.,0.,0.))");
  const worldAxis = add(`IFCAXIS2PLACEMENT3D(#${worldPoint},$,$)`);
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#${worldAxis},$)`);
  const project = add(`IFCPROJECT('${ifcGuid(1)}',#${ownerHistory},'${ifcText(result.fileName)}',$,$,$,$,(#${context}),#${units})`);
  const placement = add(`IFCLOCALPLACEMENT($,#${worldAxis})`);
  const site = add(`IFCSITE('${ifcGuid(2)}',#${ownerHistory},'Recovered site',$,$,#${placement},$,$,.ELEMENT.,$,$,$,$,$)`);
  const building = add(`IFCBUILDING('${ifcGuid(3)}',#${ownerHistory},'Recovered building',$,$,#${placement},$,$,.ELEMENT.,$,$,$)`);
  const storey = add(`IFCBUILDINGSTOREY('${ifcGuid(4)}',#${ownerHistory},'Recovered centerlines',$,$,#${placement},$,$,.ELEMENT.,0.)`);
  add(`IFCRELAGGREGATES('${ifcGuid(5)}',#${ownerHistory},$,$,#${project},(#${site}))`);
  add(`IFCRELAGGREGATES('${ifcGuid(6)}',#${ownerHistory},$,$,#${site},(#${building}))`);
  add(`IFCRELAGGREGATES('${ifcGuid(7)}',#${ownerHistory},$,$,#${building},(#${storey}))`);
  for (const material of result.materials.filter((entry) => entry.source === "rvt-material")) {
    add(`IFCMATERIAL('${ifcText(material.name)}',$,'Decoded RVT material definition; element assignment unavailable')`);
  }

  const proxies: number[] = [];
  const toMetres = (value: number) => Number((value * 0.3048).toFixed(6));
  const solidRecords = result.elementBounds.filter(({ boundsFeet: { min, max } }) =>
    max.x - min.x > 0.001 && max.y - min.y > 0.001 && max.z - min.z > 0.001,
  );
  if (solidRecords.length) {
    const extrusionDirection = add("IFCDIRECTION((0.,0.,1.))");
    const profileOrigin = add("IFCCARTESIANPOINT((0.,0.))");
    const profilePosition = add(`IFCAXIS2PLACEMENT2D(#${profileOrigin},$)`);
    for (let index = 0; index < solidRecords.length; index += 1) {
      const record = solidRecords[index]!;
      const { min, max } = record.boundsFeet;
      const width = toMetres(max.x - min.x);
      const depth = toMetres(max.y - min.y);
      const height = toMetres(max.z - min.z);
      const location = add(
        `IFCCARTESIANPOINT((${toMetres((min.x + max.x) / 2)},${toMetres((min.y + max.y) / 2)},${toMetres(min.z)}))`,
      );
      const axis = add(`IFCAXIS2PLACEMENT3D(#${location},$,$)`);
      const objectPlacement = add(`IFCLOCALPLACEMENT(#${placement},#${axis})`);
      const profile = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profilePosition},${width},${depth})`);
      const solid = add(`IFCEXTRUDEDAREASOLID(#${profile},#${worldAxis},#${extrusionDirection},${height})`);
      const representation = add(`IFCSHAPEREPRESENTATION(#${context},'Body','SweptSolid',(#${solid}))`);
      const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
      // The category is decoded, but the geometry is still only an envelope, so
      // the proxy keeps its honest type and carries the category as text.
      const label = record.categoryName
        ? `${record.categoryName} ${record.elementId}`
        : `Revit element ${record.elementId}`;
      const description = record.categoryName
        ? `RVT partition duplicated-bounds record; exact axis-aligned envelope. Native Revit category ${record.categoryId} (${record.categoryName}), evidence: ${record.categorySource}.`
        : "RVT partition duplicated-bounds record; exact axis-aligned envelope";
      proxies.push(
        add(`IFCBUILDINGELEMENTPROXY('${ifcGuid(record.elementId, 17)}',#${ownerHistory},'${ifcText(label)}','${ifcText(description)}',$,#${objectPlacement},#${shape},'${record.elementId}',.ELEMENT.)`),
      );
    }
  } else {
    for (let index = 0; index < result.segments.length; index += 1) {
      const segment = result.segments[index]!;
      const start = add(`IFCCARTESIANPOINT((${toMetres(segment.x0)},${toMetres(segment.y0)},${toMetres(segment.z0)}))`);
      const end = add(`IFCCARTESIANPOINT((${toMetres(segment.x1)},${toMetres(segment.y1)},${toMetres(segment.z1)}))`);
      const line = add(`IFCPOLYLINE((#${start},#${end}))`);
      const representation = add(`IFCSHAPEREPRESENTATION(#${context},'Axis','Curve3D',(#${line}))`);
      const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
      proxies.push(
        add(`IFCBUILDINGELEMENTPROXY('${ifcGuid(index + 20, 17)}',#${ownerHistory},'Recovered segment ${index + 1}','Heuristic centerline; not a decoded Revit element',$,#${placement},#${shape},$,.ELEMENT.)`),
      );
    }
  }
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid(8)}',#${ownerHistory},$,$,(${proxies.map((id) => `#${id}`).join(",")}),#${storey})`);

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "");
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');
FILE_NAME('${ifcText(outputName(result.fileName, "ifc"))}','${stamp}',('Reviter'),('Reviter'),'Reviter browser converter','Reviter','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${entities.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;
}
