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

The original 66-relation subset used one fixed `m_familyId` offset. Static
inspection of the release source-slot 2,022 `FamilySymbol` reader explains why
that cannot cover the class: it reads several conditional/dynamic collections
before `setFamilyId`, so the field moves with their serialized sizes.

The browser now has a second, offset-independent resolver. It scans only inside
an independently length/echo-framed `FamilySymbol` and publishes a relation
only when that bounded source refers to exactly one independently framed
`Family` target. It does not choose between two targets. On the exact model:

- 2,365 framed FamilySymbol records contain at least one framed Family target;
- 2,206 contain exactly one such target;
- 159 ambiguous records remain unresolved;
- 2,114 of the unique relations are actually referenced by placed/shared
  geometry and are retained by conversion.

This raises the regenerated semantic output from 143 to 2,025 family-named
elements across 19 native Family definitions. Of the 2,018 names that the IFC
oracle can compare, all 2,018 match exactly; the other seven have no comparable
IFC family string and are not counted as matches or mismatches. IFC is not read
by the resolver at runtime.

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
model, 258 of the 259 framed Family records contain a validated name/path pair.
Nineteen are reached by the currently unambiguous placed-symbol relations
described above. This is 100% precision for the IFC-comparable emitted subset,
not full family-name coverage. System families, the 159 ambiguous symbols,
symbols represented by other framed classes, nested family selection, formulas,
and regeneration remain separate work.

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

`InstInfoBase` independently persists each placed element's shared-geometry id.
Joining those two framed relations assigns at least one exact MaterialElem id to
25,607 placed UNBC elements while retaining the 5,413 source relation count.
That is 70.70% of the reference IFC's 36,221 material-assigned elements. The
runtime join does not read the IFC, use spatial proximity, or infer a material
from category or object order. Stair assemblies remain excluded by the existing
persisted-category gate because their same field denotes a subelement rather
than reusable geometry.

This is an exact assignment at the placed-element/shared-geometry level. It is
not yet an exact BRep-face or triangle material map, and material
colors/appearance assets, category styles, compound-layer materials, and view
overrides remain separate work. One shared geometry object may legitimately
publish more than one MaterialElem id; the resolver preserves all such ids.

## Runtime safety

The implementation in `lib/reviter/family-material-relations.ts` is:

- disabled outside Revit 2027;
- gated by the established object length/trailer echo;
- gated by exact release-specific class markers and field offsets;
- resolved in a second pass so cross-chunk object ids must point to a proven
  target class/definition before publication;
- able to use a variable-width FamilySymbol only when exactly one framed Family
  target occurs inside its bounded body;
- fail-closed when a FamilySymbol references multiple framed Family targets;
- joined to an instance only when its geometry id passed
  `sharedGeometryIdsForPlacements`;
- fail-closed when multiple placement records give one element conflicting
  geometry ids.

Use `scripts/probe-rvt-relationships.ts` for RVT/IFC corroboration and
`scripts/audit-rvt-materials.ts` for the standalone material-definition and
shared-geometry assignment audit.
