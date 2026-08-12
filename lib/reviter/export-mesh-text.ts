/** Plain-text geometry exports: Wavefront OBJ and DXF polylines. */
import type { ConvertResult } from "./types.ts";

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
