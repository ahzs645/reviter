# Native lifecycle evidence

`native-phases.ts` reads two independent native facts: phase names and explicit
`Element.m_createdPhaseId` / `Element.m_demolishedPhaseId` fields. It does not
classify a reference list as Phase Created, so an element created in one phase
and demolished in another keeps both meanings.

Admission requires a measured release (2024, 2025 or 2027) and the exact native
Element field order/type shapes, ProjectPhase name/description schema and
CellList schema. Every framed candidate must repeat a Global/ElemTable-declared
element id at Element.m_id and pass the enclosing object length echo. The
existing pointer walk locates the lifecycle fields, including variable pointer
widths; display labels and geometry never select a phase.

Names require either a complete ProjectPhase object, or Element data with an
independent OST_Phases ElementHeader join. The latter remains a pending candidate
until final resolution. Conflicting names and relationships remain unresolved.
Malformed UTF16, control characters, invalid ids and truncated fields are
rejected. Unknown phases, phase order, active view phase, Status properties and
geometry filtering remain unavailable.

The collector uses the existing active class translation and element-id width
installed by conversion. Invoke `nativePhaseLayout(release, strictSchema.classes)`
once. For each strictly inflated partition page, collect with independently
declared native ids and source location. Collect OST_Phases ids from exact
ElementHeaders during that same scan. After all pages, invoke
`resolveNativePhaseEvidence(pages, phaseCategoryIds)`; pending names must never be
published before this resolution. This needs no second partition inflation pass.

Store the resolved phases and relations as additive native evidence. For IFC,
build a phase name map and element-relation map once, then call:

```ts
standardIfcPropertySets(finalIfcClass, {
  ...source,
  nativePhase: relationByElement.get(elementId),
}, namesByPhaseId);
```

This leaves raw parameter evidence intact and writes the lifecycle field source
in the resulting property description. A null demolished phase produces no
demolition property.

Run `scripts/audit-native-phases.ts model.rvt --svf capture-svf.zip --json report.json`
to compare native fields with separately exported Autodesk property database
values. The join uses native Global/ElemTable + Global/History UniqueIds and SVF
objects_ids. Snapshot data never feeds native decoding. Files remain local.

Results for the supplied corpus are in `generated/native-phases-corpus.json`:

| Model | Native named phases | Resolved created / demolished relations | Autodesk property values equal / different / unavailable |
| --- | --- | --- | --- |
| RAC 2025 | 3 | 515 / 0 | 509 / 0 / 7 |
| School 2025 | 2 | 6,119 / 0 | 6,118 / 0 / 2 |
| Snowdon 2024 | 3 | 7,177 / 6 | 6,813 / 0 / 90 |
| UNBC 2027 | 2 | 41,337 / 0 | No Phasing values in supplied IFC; no SVF property capture supplied |

The three SVF comparisons total 13,440 equal property values and zero different
values. Counts describe decoded lifecycle fields, not model-wide completeness;
missing values stay unresolved. All four models inflated without failed or
salvaged pages. Complete in-page frames larger than 65,535 bytes and objects that
cross page boundaries remain outside the current broad scanner.

Name framing was reviewed against Helen Kwok's Apache-2.0 rvt-rs
`partition_phases.rs` at commit `1c3d337dbd2a6810e9dfad68fe99857843d67387`.
This implementation adds schema/identity/framing checks and reads explicit
lifecycle fields from the supplied schemas. No Rust source was copied.
