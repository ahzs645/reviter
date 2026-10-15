# Native parameter definitions and stored values

Reviter now normalizes rvt-rs's file-local parameter definitions, project display-unit formats, category bindings and present family values into a typed inventory. The on-demand native-evidence report retains the original graphs alongside this inventory. The CSV export includes definition, binding and value rows even when the selected records contain no family values.

`lib/reviter/native-parameter-inventory.ts` implements the exact concrete-class storage rules and graph ownership contracts in pinned rvt-rs `src/native_parameter_definitions.rs` and `src/native_metadata.rs` at `1c3d337dbd2a6810e9dfad68fe99857843d67387`. Attribution and Apache-2.0 source notices remain in `docs/rvt-semantic-attribution.md` and the vendored package.

Every inventory requires the exact RVT SHA-256, pinned native-evidence reader and schema SHA-256, and the qualified Revit 2024–2026 release contracts. Other releases remain unsupported. Parameter IDs remain exact decimal strings, including unsafe JavaScript integers. Captions are display text. Storage follows only `ParamDefString`, `ParamDefValue`, `ParamDefInt`, `ParamDefYesNo`, or `ParamDefMaterialBrowse`; unknown classes keep raw slots unresolved. `ParamDefMaterialBrowse` selects an ElementId despite its string-class inheritance.

A present family value requires a retained complete bounded owner graph, matching root identity, exactly one native pointer edge, matching pointer/edge/target token and class tag, a pointer offset inside its owner byte span, nonempty owner/target spans inside the consumed record body, and the proper `FamilyParams` target, a matching definition, and consistent native family identity. The inventory retains every stored expression pointer. It selects one stored slot without evaluating formulas. A separate `resolvedValues` inventory can resolve proven serialized symbol values through exact retained instance→symbol→family links; see [stored native schedules and type resolution](native-authored-schedules.md). Owner typed parameter sets require the same pointer proof and storage agreement with the definition. Conflicting owner values remain unresolved. Definitions whose owner records were not retained identify their evidence as a native registry projection and expose no invented stream/offset.

Category bindings require their exact definition backlink, parameter/category IDs and serialized instance/symbol kind. Display-unit identifiers come from the current native UnitsElem format map. Values stay in native internal units. A conflicting project unit registry suppresses display-unit claims for the document, while the raw report preserves the conflicting evidence. Built-in definitions and unsupported storage remain unresolved.

The raw report preserves reader status; the normalized inventory reports partial scope when evidence contradictions, extraction diagnostics or adapter truncation occur. The adapter declares separate limits of 20,000 definitions, 20,000 bindings, 4,096 retained records and 100,000 values/unresolved slots. Native reader source/graph/output limits still apply. A blocked or unsupported reader response cannot produce normalized values. These limits describe source bytes/records, not total heap usage.

## Same-model validation

The durable results are in `docs/generated/rvt-native-parameter-validation.json`.

| Model / selection | Definitions | Backlink-validated bindings | Accepted stored values agreeing with rvt-rs | Disagreements |
| --- | ---: | ---: | ---: | ---: |
| RAC 2025, bounded family query | 774 | 2 | 543 / 543 | 0 |
| Snowdon 2024, exact 17 owner/definition IDs | 1,604 | 166 | 32 / 32 | 0 |

RAC additionally retains 128 native reader slot resolutions as unresolved because their definition family ID differs from the current owner's family ID; it does not silently weaken that ownership gate. The bounded RAC query retained 128 records and reports partial scope. Snowdon has conflicting native UnitsElem registries, so 1,095 Double definitions have unresolved display units. Its exact-ID extraction completed with 17 records. Built-in slots stay unresolved because the upstream built-in definition catalog is intentionally disabled.

Twenty-one adapter tests cover valid joins, exact source/schema pinning, concrete storage classes, ambiguous edges, token/class/owner contradictions, duplicate owners and values, missing definition storage, family mismatches, native unit conflicts, expression preservation, exact large integers, typed-owner value sets, target token/owner/target byte bounds, release qualification, unresolved-slot limits and formula-safe CSV output.

To reproduce against local models:

```sh
node --experimental-strip-types scripts/inspect-native-evidence.ts model.rvt --ids 31358,52283,42865 --out source-evidence.json
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs scripts/audit-native-parameter-inventory.ts model.rvt --evidence source-evidence.json --out audit.json --csv parameter-inventory.csv
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs --test tests/native-parameter-inventory.test.ts
```

The audit independently validates the supplied model SHA-256 and compares accepted slots with rvt-rs's native serialized projection. This comparison does not establish equivalence with Revit's evaluated API values or saved schedules. RVT bytes, full native graphs and large CSV files remain outside Git.

The separate inherited-value audit preserves all 543 accepted raw RAC slots and resolves 90 symbol values for 15 instances, with zero source-owner/value disagreements. Present instance conflicts block inheritance; family defaults never replace missing symbol values. `docs/generated/rvt-native-parameter-inheritance-rac.json` records the exact source digest and scoped validation.
