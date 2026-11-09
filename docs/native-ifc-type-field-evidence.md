# Native IFC type field evidence

The upstream RE-167 rule reads an instance's original symbol twenty bytes before the end of its checksum-verified `GElement` data object. That position is correct when `InstanceInfo` is the final deferred body. Reviter now also follows its existing certified graphics FIFO to the first direct `GInstance` and that instance's `InstanceInfo`. The stored identity field is `InstInfoBase.m_symbolId`, after the 96-byte transform. Later sibling geometry cannot substitute its tail bytes for this field. A source symbol still needs a named, checksum-verified `FamilySymbol`, `SysMullionFamSym` or `SysPanelFamSym` object.

The structural reader verifies the complete object envelope and owner, requires a complete FIFO replay, retains the exact symbol field offset, and admits at most 64 root children, 1,024 deferred objects and 4,096 descriptors. The collector permits 16 MiB of additional FIFO work and includes the helper's second checksum pass in its existing 128 MiB checksum budget. These are separate work limits, not process memory limits.

UNBC 2027 source examples explain why the 224 column identities remain withheld. Column 665080 has a 17,630-byte body. Its actual `InstanceInfo` occupies object offsets 301–413 and stores symbol 665150 at offset 397; column 692182 stores symbol 360469 at the same field offset in a 10,722-byte body. Both symbols have verified `FamilySymbol` objects. The old end-minus-twenty read returned the unrelated geometry-tail value 3161095929. Both direct `GInstance` records also reference a stored embedded `GElement`. The field's positive symbol identity alone therefore cannot authorize the original-symbol IFC type recipe: their paired IFC uses `InstanceAsType`. Reviter retains the source symbol and explicit embedded-geometry ambiguity, and continues withholding that exporter recipe. Category, body length and reference IFC IDs are not inputs to the decoder.

The source-only UNBC audit recovered 201 additional physical-owner symbol references, all explicitly marked with embedded-geometry ambiguity. All 25,620 previously eligible source-only type identity comparisons still match the paired IFC, with zero mismatches and no collector cap. The remaining references require host/facing or embedded-geometry exporter evidence. Counts and exact input SHA-256 are recorded in `generated/rvt-type-identity-fifo-validation.json`; this source-only audit does not regenerate meshes.

The regression tests include an independently framed FIFO where a sibling's deferred line follows `InstanceInfo`, an embedded-symbol case, damaged and wrong-owner objects, unsupported release refusal, and conflicting copies that must preserve the embedded-geometry ambiguity. The change does not alter scene geometry or placement admission.

Source formulas: pinned rvt-rs `src/partition_schema_mvp.rs::attach_original_symbols` (RE-167), `src/ifc/mod.rs` (`InstanceAsType`, index 2048). Structural field readers: Reviter `revit-2027-ginstance.ts`, `revit-2027-framed-grep-root.ts` and `revit-2027-grep-replay.ts`.

The newly reachable FIFO readers for arcs, ellipses, lines and direction conditions use the shared deterministic `hypot` implementation for their vector validity checks. It reproduces V8's result bit for bit while preserving the repository's deterministic math contract on other engines.

The [Autodesk exporter contract and per-case diagnosis](revit-ifc-exporter-identity-contract.md) now distinguish the source field from API geometry-summary decisions and retain all 246 UNBC mismatches from the earlier conversion baseline, rather than only representative examples.

The complete per-case scan found eight 2027 column records whose 47–62 KiB bodies exceeded the initial 512-entry identity replay limit. The identity-specific limit is now 1,024 entries and 4,096 descriptors; the 64-child, 16 MiB FIFO work and 128 MiB checksum caps stay in force. Recovering these stored symbols still does not authorize an unproven IFC geometry-summary recipe.


## Complete large records and stored-envelope contradictions

The identity reader now also accepts checksum-verified **same-page** `GElement` frames above the broad scanner's 65,535-byte ceiling. The separate path requires a named source instance, complete framing and Adler checksum, a first direct `GInstance`, and full FIFO replay. It accepts at most 1 MiB per object, 4,096 replay entries and 16,384 descriptors. Its additional work is limited to 16 MiB of checksum work (including the helper's second pass) and 8 MiB of FIFO input. Reaching this optional limit cannot clear previously recovered small-object identities. Cross-page frames whose original source page offset is unknown are not relabelled with the completion page's provenance.

The [source validation](generated/rvt-native-identity-envelope-validation.json) recovers 14 of the 16 previously missing UNBC source references. Each recovered column still carries embedded-geometry ambiguity; these fields do not authorize `InstanceAsType`. Column 2297888 and door 1779325 still lack an admissible original-symbol reference. Door 1779325's referenced graphics owner 1264477 has a Doors `ElementHeader` but no scanned, checksum-verified named `FamilySymbol` object; category alone cannot supply that missing class evidence.

The collector also retains an unambiguous stored `m_bBox` from an original symbol's checksum-verified, restated-owner `GElement`. Same-partition conflicting envelopes remain ambiguous. Metadata for validated historical symbols outside legacy scene admission has its own 32 MiB checksum-work limit; it does not widen scene admission or consume the older identity budget. On UNBC this historical-envelope budget was reached after 33,552,587 checksum bytes. The legacy identity budget and optional large-object budget remained uncapped. Its source-only census contains 30,524 references, of which 23,504 carry an original-symbol envelope; these are reference counts, not distinct symbol counts or complete API geometry coverage.

The flip resolver now compares its existing world-envelope candidate with the transformed stored original-symbol-envelope candidate when that source evidence is available. If they disagree, it clears the flip and records `original-geometry-envelope-conflict`; it does not substitute the alternative flip. This catches the previously asserted flips for windows 1812247, 1812300 and 1812335. Stored graphics bounds can span conditional, detail-level or view alternatives, so `apiGeometryOptionsEquivalent` remains explicitly false. Agreement retains the existing native-bounds recipe within its documented limits; unavailable or budget-omitted envelopes are not proof of agreement. The complete conversion comparison below counts every newly withheld relationship, including any which previously matched the reference.

The 28 identity tests cover complete large FIFO bodies, damaged/truncated evidence, both optional-work budgets preserving earlier identities, arbitrary-ID envelope contradictions, transformed placement bases, invalid/partial envelopes, and same-priority envelope ambiguity. The RAC worker launched before the final historical-envelope metadata change is unaffected: the separate source-only RAC audit performed zero historical-envelope checksum work and found no eligible references for that path.

Converted results now expose `stats.nativeOriginalSymbolDiagnostics` (`legacyCapped`, `historicalEnvelope`, `largeObjects`) and add a warning when any corresponding scan budget is reached. In particular the historical-envelope cap warns that some type flip conflicts could not be checked; it does not claim complete original-geometry coverage or discard earlier identities.


## Final four-model conversion census

The [retained-evidence census](generated/rvt-native-type-envelope-census.json) reopens all four final IFCs against the `2d42a9c` campaign, using identical RVT hashes and conversion/export settings. The general contradiction veto changes 38 source product-to-type relationships: 18 in School, 17 in Snowdon, three in UNBC and none in RAC. Every change has its source-envelope comparison, exact provenance and prior/current type GUID recorded. These are relationship counts, not distinct type objects.

| Model | Compared type relationships | Unchanged type GUID | Conflict vetoes | Envelope candidates agreeing |
| --- | ---: | ---: | ---: | ---: |
| RAC | 462 | 462 | 0 | 12 |
| School | 5,497 | 5,479 | 18 | 66 |
| Snowdon | 8,830 | 8,813 | 17 | 37 |
| UNBC | 37,376 | 37,373 | 3 | 542 |

All three UNBC cases previously disagreed with the paired reference IFC; zero previously matching UNBC relationships were withheld, and their fallback identities still disagree with that reference. School and Snowdon lack paired IFC identity references. This is a conservative reduction in asserted confidence, with no claim of better reference accuracy. A candidate agreement does not certify API-equivalent geometry bounds.

The final conversion retained 27,777 UNBC physical-owner identity evidence records, including 21,073 carrying original-symbol envelopes. These differ from the wider source-only census of 30,524 references/23,504 envelopes above. The final UNBC result again reports the partial historical-envelope budget (33,552,587 checksum bytes, capped), with legacy and optional large-object identity work uncapped. Every retained conflict is enumerated; the budget prevents a claim that every possible conflict was checked.


The Snowdon upstream comparison is also reconciled against the actual prior IFC and the committed `2d42a9c` machine report: the prior result was 5,823 compared / 5,558 matched / 265 mismatched, and the final result is 5,839 / 5,574 / 265. The older prose table's 5,636 / 187 values were stale. Sixteen newly represented stair owners add sixteen upstream type matches; the mismatch count is unchanged. The census validates identical upstream IFC hashes and enumerates changes in the compared tag population.
