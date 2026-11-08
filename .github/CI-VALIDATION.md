# Validation scope and local commands

CI owns lint, typechecking, unit and Autodesk checks. Its Pages job depends on check and invokes pages.yml for the same revision. Pages keeps its own build/base path, revision stamp and artifact test. Direct manual Pages builds validate themselves. Both workflows pin the sibling map revision and cache against both lockfiles.

## Local entry points

```sh
npm ci
npm ci --prefix ../openindoormaps
npm run lint
npm run typecheck
npm run test:unit
npm run test:autodesk
# Pages artifact: PAGES_BASE_PATH=/reviter/ npm run build:pages
node --test tests/pages-build.test.mjs
```

Feature branches without an open PR use local commands. A local pass does not replace validation of the submitted revision. Main/release publication keeps the workflow's existing authorization and artifact conditions.

CI optimization batch: November 7, 2026. Workflow syntax and focused orchestration/selection checks are separate from complete application, native-platform and research validation.
