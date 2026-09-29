#!/usr/bin/env node
// Execute the supplied Pascal source without changing its package configuration.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const [editor, scene, sourceGlb, output] = process.argv.slice(2);
if (!editor || !scene || !sourceGlb || !output)
  throw new Error(
    "usage: audit-pascal-export.mjs editor-dir drawn.pascal.json source.glb report.json",
  );
const temporary = mkdtempSync(join(tmpdir(), "reviter-pascal-"));
try {
  const root = resolve(editor),
    config = join(temporary, "tsconfig.json");
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        baseUrl: root,
        paths: {
          "@pascal-app/core": ["packages/core/src/index.ts"],
          "@pascal-app/viewer": ["packages/viewer/src/index.ts"],
          "@pascal-app/nodes": ["packages/nodes/src/index.ts"],
        },
      },
    }),
  );
  const run = spawnSync(
    "bun",
    [
      "--tsconfig-override",
      config,
      join(dirname(fileURLToPath(import.meta.url)), "lib/pascal-native-audit.ts"),
      root,
      resolve(scene),
      resolve(sourceGlb),
      resolve(output),
    ],
    { stdio: "inherit" },
  );
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
