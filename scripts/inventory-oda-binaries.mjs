#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const sourceRoot = resolve(
  process.argv[2] ?? "/Users/ahmadjalil/Desktop/BmJsonExportEx-isolated",
);
const outputJson = resolve(
  process.argv[3] ?? "docs/generated/oda-binary-inventory.json",
);
const outputMarkdown = resolve(
  process.argv[4] ?? "docs/generated/oda-binary-inventory.md",
);

const SIGNALS = {
  storage: /(Ole|Storage|Stream|Zlib|Zip|readFile|FileLoader)/i,
  schema: /(TfClass|Schema|Property|Variant|CommonDataAccess)/i,
  element: /OdBmElement/i,
  parameter: /(Param|Parameter|LabelUtils)/i,
  geometry: /(Geom|Geometry)/i,
  mesh: /(Mesh|Tess|Triang|Facet)/i,
  brep: /(Brep|BRep|OdBr|Surface|Face|Edge|Loop|Shell)/i,
  material: /(Material|Texture|Color|Mapper)/i,
  family: /(Family|Fam|Instance|Symbol)/i,
  hierarchy: /(Tree|Hierarchy|Node)/i,
  graphics: /(View|Drawable|OdGi|OdGs)/i,
  discipline: /(Rebar|Stair|Ramp|MEP|Room|Analytical|Structural)/i,
  licensedRuntime: /(Trial|Activate|License|Crypto)/i,
};

function command(commandName, args, { allowFailure = false } = {}) {
  const result = spawnSync(commandName, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `${commandName} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout ?? "";
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function dynamicSymbols(path, mode) {
  const args = mode === "defined"
    ? ["-D", "-C", "--defined-only", path]
    : ["-D", "-C", "--undefined-only", path];
  return command("nm", args, { allowFailure: true })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function symbolName(line) {
  const marker = line.match(/\b[ABCDGIRSTUVW]\s+(.+)$/);
  return marker?.[1] ?? line.replace(/^\s+U\s+/, "");
}

function representativeSymbols(lines) {
  const candidates = lines
    .map(symbolName)
    .filter((name) =>
      !/^(typeinfo|vtable|VTT|guard variable|non-virtual thunk|virtual thunk)/.test(name)
      && !/(::~|::Od[A-Za-z0-9_]*\(|operator new|operator delete)/.test(name)
      && Object.values(SIGNALS).some((pattern) => pattern.test(name))
    );
  return [...new Set(candidates)].slice(0, 24);
}

function markdownEscape(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

const entries = (await readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .sort((a, b) => a.name.localeCompare(b.name));

const files = [];
for (const [index, entry] of entries.entries()) {
  const path = resolve(sourceRoot, entry.name);
  const fileStat = await stat(path);
  const description = command("file", ["-b", path]).trim();
  const elf = description.startsWith("ELF ");
  const defined = elf ? dynamicSymbols(path, "defined") : [];
  const undefined = elf ? dynamicSymbols(path, "undefined") : [];
  const allSymbols = [...defined, ...undefined].map(symbolName);
  const programHeaders = elf
    ? command("objdump", ["-p", path], { allowFailure: true })
    : "";
  const needed = [...programHeaders.matchAll(/^\s*NEEDED\s+(.+)$/gm)]
    .map((match) => match[1].trim());
  const signalCounts = Object.fromEntries(
    Object.entries(SIGNALS).map(([name, pattern]) => [
      name,
      allSymbols.filter((symbol) => pattern.test(symbol)).length,
    ]),
  );

  files.push({
    name: entry.name,
    byteLength: fileStat.size,
    sha256: await sha256(path),
    description,
    elf,
    executable: Boolean(fileStat.mode & 0o111),
    stripped: /\bstripped\b/.test(description) && !/\bnot stripped\b/.test(description),
    needed,
    dynamicDefinedSymbolCount: defined.length,
    dynamicUndefinedSymbolCount: undefined.length,
    signalCounts,
    representativeSymbols: representativeSymbols(defined),
  });
  process.stderr.write(`\r${index + 1}/${entries.length} ${entry.name.padEnd(34)}`);
}
process.stderr.write("\n");

const neededBy = new Map(files.map((file) => [file.name, 0]));
for (const file of files) {
  for (const dependency of file.needed) {
    if (neededBy.has(dependency)) {
      neededBy.set(dependency, (neededBy.get(dependency) ?? 0) + 1);
    }
  }
}
for (const file of files) file.neededByLocalFiles = neededBy.get(file.name) ?? 0;

const inventory = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceRoot,
  summary: {
    fileCount: files.length,
    totalByteLength: files.reduce((sum, file) => sum + file.byteLength, 0),
    elfCount: files.filter((file) => file.elf).length,
    strippedElfCount: files.filter((file) => file.elf && file.stripped).length,
    nonElfFiles: files.filter((file) => !file.elf).map((file) => file.name),
  },
  files,
};

const markdown = [
  "# Generated ODA binary inventory",
  "",
  `Source: \`${sourceRoot}\``,
  "",
  `Generated: ${inventory.generatedAt}`,
  "",
  `Files: ${inventory.summary.fileCount}; ELF binaries: ${inventory.summary.elfCount}; total bytes: ${inventory.summary.totalByteLength.toLocaleString("en-CA")}.`,
  "",
  "This is a mechanical inventory. Signal counts indicate where to investigate;",
  "they do not establish that a module implements a complete decoding path.",
  "",
  "| File | MiB | Format | Defined/undefined dynamic symbols | Local deps / dependents | Strongest signals |",
  "| --- | ---: | --- | ---: | ---: | --- |",
  ...files.map((file) => {
    const signals = Object.entries(file.signalCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => `${name} ${count}`)
      .join(", ") || "—";
    const localDependencies = file.needed.filter((dependency) => neededBy.has(dependency)).length;
    return `| ${markdownEscape(file.name)} | ${(file.byteLength / 1024 / 1024).toFixed(2)} | ${file.elf ? `ELF${file.stripped ? ", stripped" : ""}` : "non-ELF"} | ${file.dynamicDefinedSymbolCount}/${file.dynamicUndefinedSymbolCount} | ${localDependencies}/${file.neededByLocalFiles} | ${signals} |`;
  }),
  "",
].join("\n");

await writeFile(outputJson, `${JSON.stringify(inventory, null, 2)}\n`);
await writeFile(outputMarkdown, markdown);

console.log(outputJson);
console.log(outputMarkdown);
