import { access, rm } from "node:fs/promises";
import { resolve } from "node:path";

// Vinext copies public assets into both the static directory and the Worker
// module directory. Sites serves them from dist/client; keeping PNG files in
// dist/server makes the Worker module importer reject their MIME types.
for (const name of ["favicon.png", "og.png"]) {
  await access(resolve("dist/client", name));
  await rm(resolve("dist/server", name), { force: true });
}

console.log("Prepared the Vinext output for Sites packaging.");
