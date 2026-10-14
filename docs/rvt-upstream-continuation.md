# Further source-backed rvt-rs integrations

This continuation adds six useful capabilities on `codex/rvt-semantic-integration`, based on the same pinned upstream commit `1c3d337dbd2a6810e9dfad68fe99857843d67387`. It keeps the original scene pipeline and the separately verified vanilla upstream reader. The source inventories run on demand, with the declared native graph budgets and raw fallbacks.

| Addition | Measured result | Boundary |
| --- | --- | --- |
| Typed native records | RAC 211 records/3,195 fields; School 291/4,620; Snowdon 2,283/34,553 across disjoint bounded selections. All projected fields and pointer witnesses agree with stored graphs. | Views, schedules, viewports, view/sheet sets, grids, reference planes, text notes, revisions, spatial fields, area schemes, workset visibility and base points are serialized evidence. No source drawing renderer, evaluated schedule, full workset registry or shared-coordinate transform. Snowdon retains 20 explicit graph fallbacks. |
| Parameter definition/value joins | RAC 774 definitions, 2 bindings and 543 matching stored values; Snowdon 1,604 definitions, 166 bindings and 32 matching stored values. | Exact definition/storage/family identity and bounded owned pointers; 2024–2026 normalization. Formula evaluation, inherited values and unavailable built-in definitions remain unresolved. Conflicting family ownership and native unit registries are withheld. |
| Complete source element table | Exact upstream declared-ID equality on all four models. UNBC has 74,438 rows; Snowdon preserves 84 source aliases. | Complete source inventory is exposed separately from the legacy scene-admission set. Exact project framing, schema tags, safe IDs and acyclic owner membership are required. Family trailers remain unsupported. |
| Deferred-geometry symbol evidence | 201 additional UNBC physical-owner symbol references recovered; all 25,620 previously admissible source-only type-ID comparisons still match. | FIFO field ownership replaces the invalid tail assumption. Embedded geometry retains its explicit ambiguity, so the unproved InstanceAsType recipe remains withheld. |
| Optional IFC representation maps | School: seven maps/fourteen occurrences save 10,419 bytes (0.022%); independently reopened triangles, owners, materials and placements agree. RAC has no qualifying bodies and is unchanged. | Requires an explicit native type, identical ordered geometry/topology/materials and translation only. Default off. Synthetic asymmetric repeated geometry saves over 20%; rotated sharing and general material profiles remain unresolved. |
| Viewpoint v2 | Nine actual production desktop/mobile checks pass, including exact restored canvas pixels and source/invalid/budget refusal. | Shares camera, category visibility and normalized section settings; requires exact RVT SHA-256 and matching review frame. V1 camera links remain compatible. Annotation, selection and render-mode exchange remain separate. |

The Exports panel now offers **Source records CSV**, **Parameter definitions CSV**, and enriched **Source evidence JSON**. Definition downloads select catalog classes plus the picked element; they do not scan every FamilyInstance by default. Each CSV carries source identity and status. Empty blocked inventories retain an explicit status row. Broad source JSON/record downloads keep the reader's default 128 retained-record cap, so use the CLI for targeted or larger bounded selections.

```sh
npm run inspect:rvt-evidence -- /path/to/model.rvt --out evidence.json \
  --records-csv source-records.csv --definitions-csv definitions.csv
# Exact IDs do not implicitly add a broad class selection.
npm run inspect:rvt-evidence -- /path/to/model.rvt --ids 31358,52283 --out selected.json
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/inspect-native-records.ts /path/to/model.rvt --max-records 512 \
  --out source-records.json --csv source-records.csv
```

The WASM input/inflation/graph/32 MiB output limits apply to its raw evidence response. The TypeScript inventories add separately bounded projected strings, lists, records and values, and may make the combined JSON/CSV larger than the raw response. These are work/output limits, not a process-memory guarantee. Private source models, raw graphs and generated IFCs remain outside Git.

Detailed source contracts, validation and remaining limits:

- [Native record inventory](native-record-inventory.md)
- [Parameter definitions and values](native-parameter-inventory.md)
- [Complete element-table audit](full-elem-table-inventory-audit.json)
- [Deferred symbol fields](native-ifc-type-field-evidence.md)
- [Mapped IFC geometry](ifc-mapped-geometry.md)
- [Viewpoint links](viewpoint-links.md)
- [Reader comparison](rvt-upstream-comparison.md)

Remaining useful work needs more source/reference proof: embedded-geometry IFC type recipes and door/window flip evidence; complete native sheet/tag/dimension interpretation; evaluated schedules and family formulas; spatial Area/MEP Space classification; shared-coordinate transforms; material/profile authoring descriptors; and owner-level saved-graphics, joins/cuts and parametric surface comparisons. Native RVT editing, Python packaging and research remapping APIs remain separate from this browser converter.
