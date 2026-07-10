import type { ConvertResult, Segment } from "./types";

function cleanName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "reviter-model";
}

export function outputName(sourceName: string, extension: string): string {
  return `${cleanName(sourceName)}-recovered.${extension}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function makeObj(result: ConvertResult): string {
  const lines = [
    "# Reviter experimental recovered geometry",
    "# Coordinates are local to the model origin recorded below.",
    `# origin_feet ${result.origin.x} ${result.origin.y} ${result.origin.z}`,
  ];
  let vertexOffset = 1;
  for (const mesh of result.meshes) {
    lines.push(`o ${mesh.name.replace(/\s+/g, "_")}`);
    for (let index = 0; index < mesh.positions.length; index += 3) {
      lines.push(
        `v ${mesh.positions[index]} ${mesh.positions[index + 1]} ${mesh.positions[index + 2]}`,
      );
    }
    for (let index = 0; index < mesh.indices.length; index += 3) {
      lines.push(
        `f ${mesh.indices[index]! + vertexOffset} ${mesh.indices[index + 1]! + vertexOffset} ${mesh.indices[index + 2]! + vertexOffset}`,
      );
    }
    vertexOffset += mesh.positions.length / 3;
  }
  return `${lines.join("\n")}\n`;
}

export function makeDxf(result: ConvertResult): string {
  const lines = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1015", "0", "ENDSEC"];
  lines.push("0", "SECTION", "2", "ENTITIES");
  for (const segment of result.segments) {
    lines.push(
      "0", "LINE", "8", "REVITER_RECOVERED",
      "10", String(segment.x0), "20", String(segment.y0), "30", String(segment.z0),
      "11", String(segment.x1), "21", String(segment.y1), "31", String(segment.z1),
    );
  }
  lines.push("0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

function segmentBounds(segments: Segment[]) {
  const xs = segments.flatMap((segment) => [segment.x0, segment.x1]);
  const ys = segments.flatMap((segment) => [segment.y0, segment.y1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function makePlanSvg(result: ConvertResult): string {
  const { minX, maxX, minY, maxY } = segmentBounds(result.segments);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const strokeWidth = Math.max(width, height) / 1_200;
  const paths = result.segments
    .map(
      (segment) =>
        `<path d="M ${segment.x0 - minX} ${maxY - segment.y0} L ${segment.x1 - minX} ${maxY - segment.y1}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Recovered RVT plan centerlines">
  <rect width="100%" height="100%" fill="#f4f1e9"/>
  <g fill="none" stroke="#143e46" stroke-width="${strokeWidth}" stroke-linecap="round" vector-effect="non-scaling-stroke">${paths}</g>
</svg>`;
}

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

  const proxies: number[] = [];
  const toMetres = (value: number) => Number((value * 0.3048).toFixed(6));
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

export function makeReport(
  result: ConvertResult,
  metadata: Record<string, unknown> | null,
): string {
  const safeMetadata = metadata
    ? Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "path" && key !== "content"))
    : null;
  return JSON.stringify(
    {
      schemaVersion: 1,
      generatedBy: "Reviter",
      fidelity: {
        metadata: "verified",
        container: "verified",
        geometry: "experimental-coordinate-recovery",
        bimSemantics: "unavailable",
      },
      file: { name: result.fileName, byteLength: result.byteLength, metadata: safeMetadata },
      originFeet: result.origin,
      boundsLocalFeet: result.bbox,
      levels: result.levels,
      stats: result.stats,
      standardsAwareReader: result.readerDiagnostics ?? null,
      warnings: result.warnings,
    },
    null,
    2,
  );
}
