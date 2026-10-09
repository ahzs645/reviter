import {register} from 'node:module';
// Node strips .ts types, but does not add extensions to local ESM imports.
// Keep this CLI-only compatibility rule out of browser/geometry code.
register(new URL('./local-typescript-resolver.mjs',import.meta.url),{data:{root:new URL('../',import.meta.url).href}});
