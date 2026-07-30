/** Browser-safe Revit family type-catalog CSV parsing and writing. */

import { decodeRevitTextBytes, type DecodedRevitText } from "./revit-text-encoding.ts";

export type TypeCatalogParameter = {
  name: string;
  parameterType: string;
  units: string;
};

export type TypeCatalogType = {
  name: string;
  values: string[];
};

export type TypeCatalog = {
  parameters: TypeCatalogParameter[];
  types: TypeCatalogType[];
};

export type DecodedTypeCatalog = DecodedRevitText & { catalog: TypeCatalog };

function csvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === "\"" && source[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === "\"") quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((value) => value.length)) rows.push(row);
  return rows;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value;
}

export function parseTypeCatalog(source: string): TypeCatalog {
  const rows = csvRows(source.replace(/^\uFEFF/, ""))
    .filter((values) => !values[0]?.trimStart().startsWith("#"));
  const header = rows.shift();
  if (!header?.length) throw new Error("The type catalog has no header.");
  const definitionOffset = header[0]?.includes("##") ? 0 : 1;
  const parameters = header.slice(definitionOffset).map((definition, index): TypeCatalogParameter => {
    const parts = definition.split("##");
    if (parts.length !== 3 || !parts[0]) {
      throw new Error(
        `Invalid type-catalog parameter definition at column ${index + definitionOffset + 1}.`,
      );
    }
    return { name: parts[0], parameterType: parts[1] ?? "", units: parts[2] ?? "" };
  });
  const types = rows.map((values) => ({
    name: values[0] ?? "",
    values: parameters.map((_, index) => values[index + 1] ?? ""),
  }));
  return { parameters, types };
}

export function parseTypeCatalogBytes(data: Uint8Array): DecodedTypeCatalog {
  const decoded = decodeRevitTextBytes(data);
  return { ...decoded, catalog: parseTypeCatalog(decoded.text) };
}

export function writeTypeCatalog(catalog: TypeCatalog): string {
  const header = [
    "",
    ...catalog.parameters.map((parameter) =>
      `${parameter.name}##${parameter.parameterType}##${parameter.units}`),
  ];
  const rows = [
    header,
    ...catalog.types.map((type) => [
      type.name,
      ...catalog.parameters.map((_, index) => type.values[index] ?? ""),
    ]),
  ];
  return `${rows.map((row) => row.map(csvField).join(",")).join("\n")}\n`;
}
