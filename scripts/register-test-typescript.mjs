import { register } from "node:module";
// Parity tests import the adjacent OpenIndoorMaps checkout. Keep this broader
// test-only scope separate from the compiler CLI resolver. Native type
// stripping preserves functions serialized into CAD workers.
register(new URL("./local-typescript-resolver.mjs", import.meta.url), {
  data: { root: new URL("../../", import.meta.url).href },
});
