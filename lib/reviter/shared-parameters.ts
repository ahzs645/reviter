/**
 * Revit shared-parameter text files.
 *
 * The format is tab-delimited and self-describing: each `*SECTION` row names
 * the columns used by the records that follow. Values stay as strings except
 * for the few structural fields the format defines, so this module does not
 * depend on Autodesk's runtime enums and works in browsers and Web Workers.
 */

import { decodeRevitTextBytes, type DecodedRevitText } from "./revit-text-encoding.ts";

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

export type SharedParameterIssue = {
  severity: "warning" | "error";
  code:
    | "duplicate-group"
    | "duplicate-guid"
    | "duplicate-name"
    | "invalid-meta"
    | "invalid-guid"
    | "missing-group"
    | "unused-group";
  message: string;
  guid?: string;
  groupId?: number;
};

export type SharedParameterDifference = {
  guid: string;
  left?: SharedParameterDefinition;
  right?: SharedParameterDefinition;
};

export type SharedParameterComparison = {
  added: SharedParameterDifference[];
  removed: SharedParameterDifference[];
  renamed: SharedParameterDifference[];
  incompatibleDataTypes: SharedParameterDifference[];
  movedGroups: SharedParameterDifference[];
  unchanged: number;
};

export type DecodedSharedParameterDocument = DecodedRevitText & {
  document: SharedParameterDocument;
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

export function parseSharedParameterBytes(data: Uint8Array): DecodedSharedParameterDocument {
  const decoded = decodeRevitTextBytes(data);
  return { ...decoded, document: parseSharedParameterFile(decoded.text) };
}

export function validateSharedParameterDocument(
  document: SharedParameterDocument,
): SharedParameterIssue[] {
  const issues: SharedParameterIssue[] = [];
  if (
    !Number.isInteger(document.version) ||
    !Number.isInteger(document.minimumVersion) ||
    document.version < 1 ||
    document.minimumVersion < 1 ||
    document.minimumVersion > document.version
  ) {
    issues.push({
      severity: "error",
      code: "invalid-meta",
      message:
        `Invalid META version ${document.version} / minimum ${document.minimumVersion}.`,
    });
  }
  const groups = new Map<number, SharedParameterGroup>();
  for (const group of document.groups) {
    if (groups.has(group.id)) {
      issues.push({
        severity: "error",
        code: "duplicate-group",
        groupId: group.id,
        message: `Group id ${group.id} is declared more than once.`,
      });
    } else groups.set(group.id, group);
  }

  const guids = new Set<string>();
  const names = new Map<string, string>();
  const usedGroups = new Set<number>();
  for (const parameter of document.parameters) {
    const guid = parameter.guid.toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(guid)) {
      issues.push({
        severity: "error",
        code: "invalid-guid",
        guid,
        message: `${parameter.name} has an invalid GUID: ${parameter.guid}.`,
      });
    }
    if (guids.has(guid)) {
      issues.push({
        severity: "error",
        code: "duplicate-guid",
        guid,
        message: `Parameter GUID ${guid} is declared more than once.`,
      });
    }
    guids.add(guid);
    const normalizedName = parameter.name.trim().toLowerCase();
    const previousGuid = names.get(normalizedName);
    if (previousGuid && previousGuid !== guid) {
      issues.push({
        severity: "warning",
        code: "duplicate-name",
        guid,
        message: `${parameter.name} is assigned to multiple GUIDs.`,
      });
    } else names.set(normalizedName, guid);
    usedGroups.add(parameter.groupId);
    if (!groups.has(parameter.groupId)) {
      issues.push({
        severity: "error",
        code: "missing-group",
        guid,
        groupId: parameter.groupId,
        message: `${parameter.name} refers to missing group ${parameter.groupId}.`,
      });
    }
  }
  for (const group of document.groups) {
    if (!usedGroups.has(group.id)) {
      issues.push({
        severity: "warning",
        code: "unused-group",
        groupId: group.id,
        message: `${group.name} (${group.id}) contains no parameters.`,
      });
    }
  }
  return issues;
}

export function mergeSharedParameterDocuments(
  documents: readonly SharedParameterDocument[],
): SharedParameterDocument {
  const groups = new Map<number, SharedParameterGroup>();
  const parameters = new Map<string, SharedParameterDefinition>();
  const warnings: string[] = [];
  for (const document of documents) {
    warnings.push(...document.warnings);
    for (const group of document.groups) {
      const previous = groups.get(group.id);
      if (previous && previous.name !== group.name) {
        warnings.push(
          `Group ${group.id} is named "${previous.name}" and "${group.name}"; kept the first.`,
        );
      } else if (!previous) groups.set(group.id, group);
    }
    for (const parameter of document.parameters) {
      const guid = parameter.guid.toLowerCase();
      const previous = parameters.get(guid);
      if (!previous) parameters.set(guid, { ...parameter, guid });
      else if (
        previous.name !== parameter.name ||
        previous.dataType !== parameter.dataType ||
        previous.groupId !== parameter.groupId
      ) warnings.push(`Parameter ${guid} has conflicting definitions; kept the first.`);
    }
  }
  return {
    version: Math.max(2, ...documents.map((document) => document.version)),
    minimumVersion: Math.max(1, ...documents.map((document) => document.minimumVersion)),
    groups: [...groups.values()],
    parameters: [...parameters.values()],
    warnings,
  };
}

export function compareSharedParameterDocuments(
  left: SharedParameterDocument,
  right: SharedParameterDocument,
): SharedParameterComparison {
  const leftByGuid = new Map(left.parameters.map((parameter) => [
    parameter.guid.toLowerCase(),
    parameter,
  ]));
  const rightByGuid = new Map(right.parameters.map((parameter) => [
    parameter.guid.toLowerCase(),
    parameter,
  ]));
  const result: SharedParameterComparison = {
    added: [],
    removed: [],
    renamed: [],
    incompatibleDataTypes: [],
    movedGroups: [],
    unchanged: 0,
  };
  for (const [guid, leftParameter] of leftByGuid) {
    const rightParameter = rightByGuid.get(guid);
    if (!rightParameter) {
      result.removed.push({ guid, left: leftParameter });
      continue;
    }
    let changed = false;
    if (leftParameter.name !== rightParameter.name) {
      result.renamed.push({ guid, left: leftParameter, right: rightParameter });
      changed = true;
    }
    if (leftParameter.dataType.toUpperCase() !== rightParameter.dataType.toUpperCase()) {
      result.incompatibleDataTypes.push({ guid, left: leftParameter, right: rightParameter });
      changed = true;
    }
    if (leftParameter.groupId !== rightParameter.groupId) {
      result.movedGroups.push({ guid, left: leftParameter, right: rightParameter });
      changed = true;
    }
    if (!changed) result.unchanged += 1;
  }
  for (const [guid, rightParameter] of rightByGuid) {
    if (!leftByGuid.has(guid)) result.added.push({ guid, right: rightParameter });
  }
  return result;
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
