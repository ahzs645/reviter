/**
 * Revit shared-parameter text files.
 *
 * The format is tab-delimited and self-describing: each `*SECTION` row names
 * the columns used by the records that follow. Values stay as strings except
 * for the few structural fields the format defines, so this module does not
 * depend on Autodesk's runtime enums and works in browsers and Web Workers.
 */

export type SharedParameterGroup = {
  id: number;
  name: string;
};

export type SharedParameterDefinition = {
  guid: string;
  name: string;
  dataType: string;
  dataCategory?: string;
  groupId: number;
  visible: boolean;
  description?: string;
  userModifiable: boolean;
  hideWhenNoValue?: boolean;
};

export type SharedParameterDocument = {
  version: number;
  minimumVersion: number;
  groups: SharedParameterGroup[];
  parameters: SharedParameterDefinition[];
  warnings: string[];
};

function integer(value: string, fallback = 0): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function row(columns: string[], values: string[]): Record<string, string> {
  return Object.fromEntries(columns.map((column, index) => [column.toUpperCase(), values[index] ?? ""]));
}

export function parseSharedParameterFile(source: string): SharedParameterDocument {
  const headers = new Map<string, string[]>();
  const groups: SharedParameterGroup[] = [];
  const parameters: SharedParameterDefinition[] = [];
  const warnings: string[] = [];
  let version = 2;
  let minimumVersion = 1;

  const groupIds = new Set<number>();
  const guids = new Set<string>();
  for (const [lineIndex, raw] of source.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = raw.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const values = line.split("\t");
    const tag = (values.shift() ?? "").toUpperCase();
    if (tag.startsWith("*")) {
      headers.set(tag.slice(1), values);
      continue;
    }
    const fields = row(headers.get(tag) ?? [], values);
    if (tag === "META") {
      version = integer(fields.VERSION, version);
      minimumVersion = integer(fields.MINVERSION, minimumVersion);
      continue;
    }
    if (tag === "GROUP") {
      const id = integer(fields.ID, Number.NaN);
      const name = fields.NAME?.trim();
      if (!Number.isInteger(id) || !name) {
        warnings.push(`Line ${lineIndex + 1}: malformed GROUP record.`);
        continue;
      }
      if (groupIds.has(id)) warnings.push(`Line ${lineIndex + 1}: duplicate group id ${id}.`);
      groupIds.add(id);
      groups.push({ id, name });
      continue;
    }
    if (tag !== "PARAM") {
      warnings.push(`Line ${lineIndex + 1}: unknown record type ${tag || "(empty)"}.`);
      continue;
    }
    const guid = fields.GUID?.trim().toLowerCase();
    const name = fields.NAME?.trim();
    const groupId = integer(fields.GROUP, Number.NaN);
    if (!guid || !name || !Number.isInteger(groupId)) {
      warnings.push(`Line ${lineIndex + 1}: malformed PARAM record.`);
      continue;
    }
    if (guids.has(guid)) warnings.push(`Line ${lineIndex + 1}: duplicate parameter ${guid}.`);
    guids.add(guid);
    parameters.push({
      guid,
      name,
      dataType: fields.DATATYPE?.trim() ?? "",
      ...(fields.DATACATEGORY?.trim() ? { dataCategory: fields.DATACATEGORY.trim() } : {}),
      groupId,
      visible: fields.VISIBLE !== "0",
      ...(fields.DESCRIPTION?.trim() ? { description: fields.DESCRIPTION.trim() } : {}),
      userModifiable: fields.USERMODIFIABLE !== "0",
      ...(fields.HIDEWHENNOVALUE !== undefined
        ? { hideWhenNoValue: fields.HIDEWHENNOVALUE === "1" }
        : {}),
    });
  }

  const knownGroups = new Set(groups.map((group) => group.id));
  for (const parameter of parameters) {
    if (!knownGroups.has(parameter.groupId)) {
      warnings.push(`Parameter ${parameter.guid} refers to missing group ${parameter.groupId}.`);
    }
  }
  return { version, minimumVersion, groups, parameters, warnings };
}

export function writeSharedParameterFile(document: SharedParameterDocument): string {
  const hideColumn = document.parameters.some((parameter) => parameter.hideWhenNoValue !== undefined);
  const lines = [
    "# This is a Revit shared parameter file.",
    "# Do not edit manually.",
    "*META\tVERSION\tMINVERSION",
    `META\t${document.version}\t${document.minimumVersion}`,
    "*GROUP\tID\tNAME",
    ...document.groups.map((group) => `GROUP\t${group.id}\t${group.name}`),
    `*PARAM\tGUID\tNAME\tDATATYPE\tDATACATEGORY\tGROUP\tVISIBLE\tDESCRIPTION\tUSERMODIFIABLE${hideColumn ? "\tHIDEWHENNOVALUE" : ""}`,
    ...document.parameters.map((parameter) => [
      "PARAM",
      parameter.guid,
      parameter.name,
      parameter.dataType,
      parameter.dataCategory ?? "",
      String(parameter.groupId),
      parameter.visible ? "1" : "0",
      parameter.description ?? "",
      parameter.userModifiable ? "1" : "0",
      ...(hideColumn ? [parameter.hideWhenNoValue ? "1" : "0"] : []),
    ].join("\t")),
  ];
  return `${lines.join("\n")}\n`;
}
