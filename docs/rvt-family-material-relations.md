# Revit family and material relationship decoder

This clean-room decoder is client-side TypeScript. It uses only the RVT's own
framing/schema, the supplied file as a corpus, and the supplied IFC as an
independent acceptance oracle. It does not load or redistribute ODA code.

## Persisted family chain

The exact 300-byte `InstInfoBase` object ends with a rigid transform followed by
an object id. The embedded `Formats/Latest` field order names that id
`m_symbolId`; `m_GRepId` follows it. The existing renderer already used the same
id to locate the symbol-owned local geometry.

Against the UNBC pair:

- 25,620 IFC-typed instances resolve to 5,410 distinct persisted symbol ids;
- all 5,410 symbols are type-pure (100%); no symbol mixes IFC type names;
- `FamilySymbol` has schema tag 2065 and wire marker `0x0810`;
- its `m_familyId` is a 64-bit object id at `+449`;
- the target is a framed `Family`, schema tag 2010 / wire marker `0x07d9`;
- 66 referenced symbols resolve to 259 persisted Family elements overall;
- 17 IFC-named loadable-family symbols resolve to two Family targets, and
  neither target mixes IFC family names.

This supplies native `instance → symbol → family` membership. It does not claim
family regeneration, parameter formula evaluation, or nested-family expansion.

## Persisted family names

The unstripped 2026 reader shows `FamilyBase` calling `OdStringReader` and then
`setName`, immediately followed by a second `OdStringReader` and `setPath`.
Fields before that pair include variable-length collections, so the absolute
name offset is not fixed. The browser decoder instead requires:

- a length/echo-framed `Family` object with marker `0x07d9`;
- two consecutive bounded UTF-16 strings inside its first 1,024 bytes;
- a family name without path separators;
- an adjacent non-empty directory path ending in a separator.

The path is validation evidence only and is not exported. On the exact UNBC
model, three referenced family records decode and attach native names to 143
placed elements. All 143 correlate with IFC family names and all 143 match
exactly. The decoded families are:

- `Колонна прямоугольного сечения`;
- `Дверь-Витраж-Двойная-Витрина`;
- `Round Column`.

This is 100% precision for the emitted subset, not full family-name coverage.
The other referenced symbols either do not resolve through the currently proven
`FamilySymbol` layout or point at a family layout whose name/path pair is not
yet proven.

## Persisted material assignments

Three framed shared-geometry layouts carry 64-bit `MaterialElem` ids:

| Object marker | Field offsets |
| --- | --- |
| `0x08c6` | `+356`, `+418`, `+480`, `+542`, `+604`, `+666` |
| `0x10dc` | `+135` |
| `0x10de` | `+133` |

Candidates are published only when both sides resolve: the source id must be
referenced by an instance and the target id must be one of the separately
decoded framed `MaterialElem` definitions. Duplicate copies in one geometry
object are collapsed.

The UNBC decoder resolves 5,413 geometry-to-material relations across 5,413
shared geometry sources and three MaterialElem ids. Of the 5,393 relations whose
source has an IFC material association, all 5,393 decoded RVT material names
occur in the IFC association (100% exact-name precision).

This is an exact assignment at the shared-geometry/type level. It is not yet an
exact BRep-face or triangle material map, and material colors/appearance assets,
category styles, and view overrides remain separate work.

## Runtime safety

The implementation in `lib/reviter/family-material-relations.ts` is:

- disabled outside Revit 2027;
- gated by the established object length/trailer echo;
- gated by exact release-specific class markers and field offsets;
- resolved in a second pass so cross-chunk object ids must point to a proven
  target class/definition before publication.

Use `scripts/probe-rvt-relationships.ts` for RVT/IFC corroboration and
`scripts/audit-rvt-materials.ts` for the standalone material-definition and
shared-geometry assignment audit.
