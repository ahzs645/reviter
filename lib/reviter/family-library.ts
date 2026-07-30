/**
 * Local-only browser index for a user-selected folder of Revit families.
 *
 * Paths and File handles remain in memory. The serializable summary deliberately
 * contains only file names and family metadata.
 */
import { basicFileInfo, openFile, tryThumbnail } from "@phi-ag/rvt";

import {
  parseBasicFileInfoProperties,
  revitVersionFromBasicFileInfo,
} from "./basic-file-info.ts";
import {
  omniClassForPartAtom,
  type OmniClassItem,
} from "./omniclass.ts";
import { parsePartAtomXml, type PartAtomMetadata } from "./part-atom.ts";
import { parseTypeCatalogBytes, type TypeCatalog } from "./type-catalog.ts";

export type FamilyLibraryEntry = {
  fileName: string;
  size: number;
  revitVersion?: number;
  build?: string;
  locale?: string;
  title: string;
  entryTitle?: string;
  category?: string;
  manufacturer?: string;
  dimensions: Record<string, string>;
  voltage?: string;
  types: string[];
  partAtom?: PartAtomMetadata;
  typeCatalog?: TypeCatalog;
  typeCatalogFileName?: string;
  omniClass?: OmniClassItem;
  thumbnail?: Blob;
  sourceFile: File;
};

export type FamilyLibraryError = { fileName: string; error: string };

export type FamilyLibraryIndex = {
  entries: FamilyLibraryEntry[];
  errors: FamilyLibraryError[];
  catalogFiles: number;
  indexedAt: string;
};

export type FamilyLibraryProgress = {
  completed: number;
  total: number;
  fileName: string;
};

function baseName(name: string): string {
  return name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").replace(/_cat$/i, "").toLowerCase();
}

function normalized(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function allParameters(metadata: PartAtomMetadata | undefined) {
  return metadata?.types.flatMap((type) => type.parameters) ?? [];
}

function parameterValue(metadata: PartAtomMetadata | undefined, names: string[]): string | undefined {
  const wanted = new Set(names.map(normalized));
  return allParameters(metadata).find((parameter) =>
    wanted.has(normalized(parameter.displayName ?? parameter.name)))?.value;
}

function dimensions(metadata: PartAtomMetadata | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const parameter of allParameters(metadata)) {
    const name = parameter.displayName ?? parameter.name;
    if (
      parameter.parameterType?.toLowerCase() === "length" ||
      ["width", "height", "depth", "length"].includes(normalized(name))
    ) result[name] ??= parameter.value;
  }
  return result;
}

async function catalogMap(files: readonly File[]): Promise<{
  catalogs: Map<string, { fileName: string; catalog: TypeCatalog }>;
  errors: FamilyLibraryError[];
}> {
  const catalogs = new Map<string, { fileName: string; catalog: TypeCatalog }>();
  const errors: FamilyLibraryError[] = [];
  for (const file of files) {
    if (!/\.txt$/i.test(file.name)) continue;
    try {
      const decoded = parseTypeCatalogBytes(new Uint8Array(await file.arrayBuffer()));
      catalogs.set(baseName(file.name), { fileName: file.name, catalog: decoded.catalog });
    } catch (caught) {
      // A selected family folder can contain arbitrary text files. Report only
      // files named like catalogs rather than treating every text file as bad.
      if (/_cat\.txt$/i.test(file.name)) {
        errors.push({
          fileName: file.name,
          error: caught instanceof Error ? caught.message : String(caught),
        });
      }
    }
  }
  return { catalogs, errors };
}

export async function indexFamilyLibraryFiles(
  files: readonly File[],
  options: {
    taxonomy?: readonly OmniClassItem[];
    onProgress?: (progress: FamilyLibraryProgress) => void;
  } = {},
): Promise<FamilyLibraryIndex> {
  const families = files.filter((file) => /\.rfa$/i.test(file.name));
  const { catalogs, errors } = await catalogMap(files);
  const entries: FamilyLibraryEntry[] = [];

  for (const [index, file] of families.entries()) {
    options.onProgress?.({ completed: index, total: families.length, fileName: file.name });
    try {
      const cfb = await openFile(file);
      const partAtomEntry = cfb.findEntry("PartAtom");
      const basicEntry = cfb.findEntry("BasicFileInfo");
      const [partAtomData, basicData, preview] = await Promise.all([
        partAtomEntry ? cfb.entryData(partAtomEntry) : undefined,
        basicEntry ? cfb.entryData(basicEntry) : undefined,
        tryThumbnail(cfb),
      ]);
      const partAtom = partAtomData
        ? parsePartAtomXml(new TextDecoder().decode(partAtomData))
        : undefined;
      let revitVersion = basicData
        ? revitVersionFromBasicFileInfo(basicData) ?? undefined
        : undefined;
      let build: string | undefined;
      let locale: string | undefined;
      try {
        const info = await basicFileInfo(cfb);
        revitVersion = Number.parseInt(info.version, 10) || revitVersion;
        build = info.build;
        locale = info.locale;
      } catch {
        if (basicData) {
          const properties = parseBasicFileInfoProperties(basicData);
          build = properties.revitBuild ?? properties.build;
          locale = properties.locale;
        }
      }
      const associatedCatalog = catalogs.get(baseName(file.name));
      const category = partAtom?.categories[0]?.term;
      const manufacturer = parameterValue(partAtom, ["Manufacturer"]);
      const voltage = parameterValue(partAtom, ["Voltage", "Volts", "Electrical Potential"]);
      entries.push({
        fileName: file.name,
        size: file.size,
        ...(revitVersion != null ? { revitVersion } : {}),
        ...(build ? { build } : {}),
        ...(locale ? { locale } : {}),
        title: partAtom?.title ?? partAtom?.entryTitle ?? file.name.replace(/\.rfa$/i, ""),
        ...(partAtom?.entryTitle ? { entryTitle: partAtom.entryTitle } : {}),
        ...(category ? { category } : {}),
        ...(manufacturer ? { manufacturer } : {}),
        dimensions: dimensions(partAtom),
        ...(voltage ? { voltage } : {}),
        types: partAtom?.types.map((type) => type.title) ?? [],
        ...(partAtom ? { partAtom } : {}),
        ...(associatedCatalog
          ? {
              typeCatalog: associatedCatalog.catalog,
              typeCatalogFileName: associatedCatalog.fileName,
            }
          : {}),
        ...(options.taxonomy && partAtom
          ? { omniClass: omniClassForPartAtom(partAtom, options.taxonomy) }
          : {}),
        ...(preview.ok ? { thumbnail: preview.data } : {}),
        sourceFile: file,
      });
    } catch (caught) {
      errors.push({
        fileName: file.name,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }
  options.onProgress?.({ completed: families.length, total: families.length, fileName: "" });
  entries.sort((left, right) => left.title.localeCompare(right.title));
  return {
    entries,
    errors,
    catalogFiles: catalogs.size,
    indexedAt: new Date().toISOString(),
  };
}

export function searchFamilyLibrary(
  index: FamilyLibraryIndex,
  query: string,
  limit = 100,
): FamilyLibraryEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return index.entries.slice(0, limit);
  return index.entries.filter((entry) => [
    entry.fileName,
    entry.title,
    entry.entryTitle,
    entry.category,
    entry.manufacturer,
    entry.voltage,
    entry.omniClass?.number,
    entry.omniClass?.title,
    entry.typeCatalogFileName,
    ...entry.types,
    ...Object.entries(entry.dimensions).flat(),
    ...(entry.typeCatalog?.types.flatMap((type) => [type.name, ...type.values]) ?? []),
  ].some((value) => value?.toLowerCase().includes(normalizedQuery))).slice(0, limit);
}

export function serializableFamilyLibraryIndex(index: FamilyLibraryIndex) {
  return {
    ...index,
    entries: index.entries.map((entry) => Object.fromEntries(
      Object.entries(entry).filter(([key]) => key !== "sourceFile" && key !== "thumbnail"),
    )),
  };
}
