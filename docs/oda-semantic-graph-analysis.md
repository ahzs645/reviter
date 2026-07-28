# RVT semantic graph, native identity, family, and material analysis

## Purpose and boundary

This report records clean-room facts recoverable from the public ELF metadata,
exported C++ symbols, dependency tables, small control-flow inspections, and
literal format data in the isolated ODA/PRC-style runtime at:

`/Users/ahmadjalil/Desktop/BmJsonExportEx-isolated`

It does not reproduce proprietary source or attempt to bypass the ODA runtime or
its licensing. The goal is to identify data contracts that a browser-side RVT
reader can implement independently and to distinguish those contracts from
operations that still require a complete Revit object model, constraint solver,
or solid-modeling kernel.

The central finding is that all four requested gaps are represented in the file:

1. native Revit `UniqueId` has an explicit construction and lookup path;
2. model organization is a typed relationship graph, not one persisted tree;
3. family instances, symbols, nested members, and cached regeneration products
   are separately represented;
4. materials have definition, element/type assignment, geometry-tag assignment,
   face assignment, and view-override layers.

The exported APIs identify what must be decoded. They do **not** reveal enough
of the versioned object-stream grammar to safely parse all four areas by scanning
for values or assuming fixed byte offsets.

## Evidence method

The primary inspection commands were:

```sh
nm -D -C <binary>
objdump -d -C --start-address=<symbol-address> --stop-address=<next-symbol>
objdump -h <binary>
```

The following relevant binaries were inspected directly:

| Layer | Binaries | Relevant responsibility |
| --- | --- | --- |
| Revit data model | `TB_Database.tx`, `TB_Base.tx`, `TB_Main.tx`, `TB_Essential.tx`, `TB_Family.tx` | element identity/history, object tables, relationships, family graph, regeneration state, material elements |
| Versioned loading | `TB_LoaderBase.tx`, `TB_Common.tx` | dynamic class/property composition, primitive readers, GUID and object-ID readers |
| Revit graphics | `TB_Geometry.tx` | material assets, visual traits, mesh-level assignments, face-data emission |
| B-rep material propagation | `libTD_Br.so`, `libTD_BrepBuilder.so`, `libTD_BrepBuilderFiller.so`, `libTD_BrepRenderer.so` | face material IDs, texture mapping, propagation into generated faces |
| Graphics traits | `libTD_Gi.so`, `libTD_Gs.so`, `libTD_DbRoot.so`, `libTD_Root.so` | per-face material arrays, mappers, material traits, texture channels |

The conclusions below use exported names as contract evidence. Where control
flow was inspected, this report describes only externally useful behavior.

## 1. Native Revit UniqueId

### Strong evidence

`TB_Database.tx` exports the complete public-facing path:

- `OdBmElement::getUniqueId() const`
- `OdBmElementImpl::getUniqueId() const`
- `OdBmDatabase::getObjectIdfromUniqueId(OdString const&) const`
- `OdBmDatabaseImpl::getObjectIdfromUniqueId(OdString const&) const`
- `OdBmDatabaseImpl::parseUniqueId(OdString const&, long&, OdGUID&)`
- `OdBmElementHistory::getOriginalElementId() const`
- `OdBmElementHistory::getCreationDate() const`
- `OdBmDocumentHistory::getEpisode(...) const`
- `OdBmEpisode::getGUID() const`

The small `getUniqueId` and `parseUniqueId` routines establish the stable
external contract:

```text
<episode-guid>-<element-number-as-8-digit-lowercase-hex>
```

The suffix format literal is `-%08llx`. Parsing splits on the last hyphen,
constructs a GUID from the prefix, and parses the suffix as hexadecimal. For the
history-backed branch, `getUniqueId` obtains the element history's creation
episode, uses that episode's GUID, and pairs it with the history's original
element ID. A separate branch uses the current object handle rather than
historical identity. That appears to cover a new/non-persisted object, but the
meaning of its virtual predicate is not established by symbol metadata alone;
a browser should not treat this branch as cross-save identity until validated.

`TB_LoaderBase.tx` confirms that the constituent values are persisted data
types:

- `EpisodeGUID201120260Reader`
- `ElemGUID128201120260Reader`
- `OriginalElementId201120260Reader`
- `ElementId201120260Reader`
- `ElementId201120261Reader`
- `PartitionGUID201120260Reader`
- `CentralElementId201120260Reader`

### Clean browser-side opportunity

Implement a native identity layer only after the following decoded records can
be linked:

```ts
type Guid = string; // normalized UUID text
type ElementHandle = bigint;

interface EpisodeRecord {
  episodeId: number;
  guid: Guid;
}

interface ElementHistoryRecord {
  elementHandle: ElementHandle;
  creationEpisodeId: number;
  originalElementId: bigint;
}

interface NativeElementIdentity {
  handle: ElementHandle;
  episodeGuid: Guid;
  originalElementId: bigint;
  uniqueId: string;
  provenance: "persisted-history" | "transient-handle";
}
```

The formatter is easy; the hard part is resolving the element-history record to
the correct creation episode in the document-history table. Until both records
are decoded, retain the current stream/record identifier as a separate
`sourceRecordId` and do not label it `UniqueId`.

### Validation

A native-ID implementation should satisfy all of these:

- `parse(format(identity))` returns the same episode GUID and original ID;
- IDs are unique across the decoded document;
- every non-transient ID resolves back through the element/object table;
- exported IDs match Revit or IFC-side source identifiers where the reference
  export contains them;
- IDs remain stable across a second RVT save of the same elements.

## 2. Genuine model organization is a graph

### Why a single `parentId` is insufficient

The binaries expose several independent relationships for an element:

- database membership and table enumeration;
- object ownership;
- owning element/subcomponent;
- family/type membership;
- group and assembly membership;
- host relationship;
- associated level;
- owner view;
- category and parent category;
- design option;
- dependency/regeneration parents.

These relationships answer different questions. For example, a door may be
contained on a level, hosted by a wall, instantiated from a family symbol,
participate in a group, and own nested subcomponents at the same time. Converting
one of those edges into the only `parentId` loses information and cannot match
both Revit and IFC organization.

### Exported relationship evidence

Core database and element traversal:

- `OdBmDatabase::newIteratorById() const`
- `OdBmDatabaseInternalImpl::getElementTable()`
- `OdBmDatabaseImpl::internalGetElementTable()`
- `OdBmDatabaseImpl::internalGetChildren()`
- the fixed element-table handles
  `kElementTableHandle`, `kMidElementTableHandle`,
  `kBackElementTableHandle`, `kFrontElementTableHandle`,
  `kMainFgElementTableHandle`, and `kFront3dElementTableHandle`

Ownership and placement:

- `OdBmElement::getOwningElementId() const`
- `OdBmElemRec::getOwningElementId() const`
- `OdBmElement::getAssocLevelId() const`
- `OdBmElement::getOwnerDBViewId() const`
- `OdBmElementHeader::getOwnerViewId() const`
- `OdBmElement::getDesignOptionId() const`
- `OdBmFamilyInstance::getOwnerElemId() const`
- `OdBmFamilyInstance::getHostId() const`
- `OdBmFamilyInstanceImpl::getSubComponentIds(...) const`

Grouping and category organization:

- `OdBmGroupMembership::getGroupId() const`
- `OdBmAssemblyGroupMembership`
- `OdBmElementGroupMembership`
- `OdBmCategory::getParentCategoryHandle() const`
- `OdBmCategoryDataItem::getParentCategoryId() const`
- `OdBmElementHeader::getCategoryId() const`
- `OdBmFamilyBase::getFamilyCategoryId() const`

Dependency graph:

- `OdBmElement::getParents() const`
- `OdBmElementParentsInternalImpl::getDeletion()`
- `getRegenOnly()`
- `getRegenWildcards()`
- `getDeferredParents()`
- `getAppearanceParents()`
- `getDependencyParents()`
- `getNonDetermRegenChildren()`
- `getComputedParametersParents()`
- `OdBmElementRegenHistoryInternalImpl::getHistoryMap()`
- `OdBmElemDepDataInternalImpl::getChildren()`
- `getParentAtomMap()`

This is strong evidence that “genuine model-tree membership” should be modeled
as lossless typed edges first. Project Browser trees and IFC spatial trees are
views derived from that graph.

### Recommended browser contract

```ts
type RelationshipKind =
  | "owns"
  | "subcomponent"
  | "hosted-by"
  | "instance-of"
  | "symbol-of-family"
  | "member-of-group"
  | "member-of-assembly"
  | "associated-level"
  | "owner-view"
  | "category"
  | "parent-category"
  | "design-option"
  | "regen-depends-on"
  | "appearance-depends-on";

interface ModelRelation {
  from: ElementHandle;
  to: ElementHandle;
  kind: RelationshipKind;
  sourceClass?: string;
  sourceField?: string;
  confidence: "persisted" | "derived" | "heuristic";
}

interface ModelGraph {
  elements: Map<ElementHandle, SemanticElement>;
  relations: ModelRelation[];
}
```

Do not discard an edge merely because a tree view chooses another edge as its
visual parent. A useful client UI can expose at least three projections:

1. spatial: project/site/building/storey/space/elements;
2. type: category/family/symbol/instances;
3. ownership: element/subcomponents/groups/assemblies.

### IFC parity projection

The graph maps naturally to IFC reference relationships:

| RVT graph edge | IFC comparison target |
| --- | --- |
| associated level / spatial membership | `IfcRelContainedInSpatialStructure` |
| owning element / nested component | `IfcRelAggregates` or `IfcRelNests` |
| instance → family symbol/type | `IfcRelDefinesByType` |
| group membership | `IfcRelAssignsToGroup` |
| host/dependency | corresponding IFC element relationship where exported, otherwise a retained RVT-native edge |
| material assignment | `IfcRelAssociatesMaterial` plus shape-item material/style |

IFC should be used as a parity oracle, not as proof that RVT contains an
identical single hierarchy. Report both missing RVT edges and extra RVT-native
edges.

## 3. Family instance/type and regeneration graph

### Persisted graph contracts

`TB_Family.tx` separates instance, symbol, family, nested membership, and cached
geometry:

- `OdBmFamilyInstance::getFamilySymbolId() const`
- `OdBmFamilySymbol::getFamilyId() const`
- `OdBmFamilySymbol::getMasterId() const`
- `OdBmFamilySymbolImpl::getMasterSymbolId() const`
- `OdBmFamilyInstanceImpl::getComputedSymbolId() const`
- `OdBmFamilyInstance::getMasterSymbolId() const`
- `OdBmFamilySymbolImpl::getNestedSymbols() const`
- `OdBmFamilySymbolImpl::getDerivedSymbols() const`
- `OdBmFamilyInstanceImpl::getNestedInstances() const`
- `OdBmFamilyInstanceImpl::getSubComponentIds(...) const`
- `OdBmFamilyInstanceInternalImpl::getSubInstancesTable() const`
- `OdBmFamilyInstance::getInstOrigin() const`
- `getFacingOrientation()`, `getHandOrientation()`, `isMirrored()`,
  `getFlippedX()`, and `getFlippedY()`

Stored symbol products include:

- `OdBmFamilySymbol::getOutline() const`
- `getSubElemData(...)`
- `getSubInstData(...)`
- `getProfileLoops(...)`
- `getNonBRepGeomPtrs(...)`
- `getArrFamSymRegenData(...)`
- `getGeomTag2MaterialId(...)`
- `getMaterialIdForGeometryTag(...)`
- `OdBmFamilyInstanceImpl::getGeometryFromId(...)`
- `OdBmFamilySymbolImpl::getGeometryFromId(...)`
- `OdBmFamilySymbolImpl::getTransformedSolidGeometry(...)`

This supports a useful client-side target before general family regeneration:

1. decode the family/symbol/instance graph;
2. decode already-persisted symbol or instance geometry;
3. instance cached symbol geometry with the persisted transform and flip state;
4. recursively instantiate nested instances;
5. preserve computed/master-symbol distinctions;
6. apply geometry-tag material assignments.

That subset can match an IFC export for many placed loadable-family instances
without re-solving family constraints in the browser.

### Why full regeneration remains a kernel boundary

The runtime also exposes a much larger active regeneration system:

- `OdBmFamilyImpl::regenerate()`
- `OdBmFamilyBaseImpl::regenerate()`
- `OdBmFamilySymbolImpl::setShouldRegen(bool)`
- `OdBmVarSketchAnalyzer::regenerateSketches()`
- `OdBmFamilyInstanceImpl::addSubComponents()`
- `OdBmFamilyInstanceImpl::modifyTrfSubComponents()`
- `OdBmFamSymRegenArgsInternalImpl` collections for family geometry,
  antecedents, cut loops, opening groups, reference planes, connectors,
  bending, visibility, view-specific geometry, complex cuts, imported geometry,
  and per-member materials
- constraint and sketch regeneration implementations in `TB_Essential.tx`

These APIs operate on live database objects, geometry nodes, references,
constraints, and Boolean/cut geometry. Exported symbol names do not define the
solver semantics or the binary representation of each object. A clean browser
reader should therefore distinguish:

```ts
type FamilyGeometryProvenance =
  | "persisted-instance"
  | "persisted-symbol-instanced"
  | "persisted-computed-symbol"
  | "ifc-reference-fallback"
  | "not-regenerated";
```

“Full family regeneration” should not be claimed until the client can evaluate
formulae and parameters, solve constraints and references, regenerate sketches
and profiles, execute cuts/joins, and reproduce view/visibility rules. Reusing
cached symbol geometry is reconstruction, not regeneration.

## 4. Exact material definition and assignment

### Material definition

`TB_Database.tx` exposes the base Revit material element:

- `OdBmMaterialElem::getName() const`
- `getColor() const`
- `OdBmMaterialElem::getMaterial() const` and
  `OdBmMaterial::getTransparency() const`
- `getUseRenderAppearance() const`
- foreground/background surface and cut pattern IDs and colors
- `getThermalAssetId() const`
- `getStructuralAssetId() const`
- URL, description, manufacturer, model, keynote, mark, comments, and cost
- `OdBmMaterialElemInternalImpl::getMaterialPathMap() const`

`TB_Geometry.tx` exposes render-appearance conversion:

- `OdBmMaterialImpl::getSchemaName() const`
- `getTextureData(...) const`
- `getMaterialColor(...) const`
- schema-specific trait filling for generic, metal, glazing, glass, concrete,
  hardwood, masonry, ceramic, stone, water, paint, and plastic/vinyl

The graphics libraries expose material traits for ambient/diffuse/specular
color, opacity, emission, normal/bump maps, roughness, reflection, refraction,
two-sided rendering, luminance, reflectivity, translucence, and texture mapping.
These form a reasonable source contract for conversion to glTF PBR, but not all
Revit appearance schemas have a lossless glTF equivalent.

### Assignment layers

The assignment is not one element-level field. Evidence exists at each layer:

| Layer | Exported evidence |
| --- | --- |
| element/type material set | `OdBmExtDatabasePEImpl::getElementMaterialIds(...)`, `OdBmFamilyInstanceImpl::getMaterialIds(...)`, `OdBmFamilySymbolImpl::getMaterialIds(...)` |
| structural material | `OdBmElementImpl::getStructuralMaterialId(...)` |
| family geometry tag | `OdBmFamilySymbol::getGeomTag2MaterialId(...)`, `getMaterialIdForGeometryTag(...)`, `OdBmFamSymRegenArgsInternalImpl::getMemberIdx2MaterialId()` |
| stored mesh | `OdBmGPolyMesh::getMaterialID() const` |
| B-rep face | `OdBmBrFace::getMaterial(...)`, `getMaterialOverride(...)`, `getMaterialByCategory(...)`, `getMaterialMapper(...)` |
| generic B-rep | `OdBrFace::getMaterialID(...)`, `getMaterialString(...)`, `getMaterialMapper(...)` |
| tessellated face array | `OdGiFaceData::setMaterials(...)`, `OdGiFaceDataStorage::materialsArray()` |
| object/category style | `OdBmGStyleElem::getMaterialElemId()`, `OdBmObjectStyle::getMaterialId()` |
| view/system override | `OdBmGiContext::getMaterialOverriderId()`, `OdBmSystemOverrides::getGMaterialOverrider()`, phasing overrides |

`libTD_BrepBuilder.so` additionally exposes
`setFacesMaterial(...)` and `setFaceMaterialMapping(...)`, proving that material
and UV/mapping state is propagated per face during B-rep construction rather
than attached only after a whole mesh is produced.

### Clean browser contract

Keep definitions and assignments separate:

```ts
interface MaterialDefinition {
  id: ElementHandle;
  name?: string;
  baseColor?: [number, number, number, number];
  transparency?: number;
  appearanceSchema?: string;
  textureUris?: Partial<
    Record<"baseColor" | "normal" | "roughness" | "opacity" | "emissive", string>
  >;
  structuralAssetId?: ElementHandle;
  thermalAssetId?: ElementHandle;
}

interface PrimitiveMaterialAssignment {
  elementId: ElementHandle;
  geometryId: string;
  primitiveIndex: number;
  faceOrGeometryTag?: number;
  materialId?: ElementHandle;
  mapper?: {
    transform: number[];
    projection?: number;
    tiling?: number;
    autoTransform?: number;
  };
  source:
    | "face-override"
    | "geometry-tag"
    | "stored-mesh"
    | "element-or-type"
    | "category-style"
    | "view-override"
    | "default";
}
```

A proposed renderer precedence is face override, geometry-tag assignment,
stored-mesh assignment, element/type assignment, category/object style, then
default. This ordering is an implementation hypothesis and must be validated
against the same RVT rendered/exported through Revit or IFC. View and phase
overrides should be an optional display layer, not baked into the base material.

For exact IFC comparison, test material identity at the shape-item/primitive
level, not merely whether an element mentions the same set of material names.

## 5. Version-sensitive reader clues

`TB_LoaderBase.tx` uses dynamic class/property composition rather than one
fixed-layout record for every release. Relevant exported compatibility hooks
include:

| Contract | Exported reader/composer ranges |
| --- | --- |
| object IDs | `ElementId201120260Reader`, `ElementId201120261Reader` |
| episode/original identity | `EpisodeGUID201120260Reader`, `OriginalElementId201120260Reader` |
| material ID wrapper | `MaterialId201120260Reader` |
| element table | `ElemTable201120230Reader`, `ElemTable202420260Reader` |
| object identifier | `Identifier201120230Reader`, `Identifier202420260Reader` |
| extensible-storage schema | `ESSchema201220200Reader`, `ESSchema202120260Reader` |
| base element composition | `ElementComposeForLoad20112013`, `20142014`, `20152019`, `20192025` |
| family base | `FamilyBaseComposeForLoad20112013`, `FamilyBaseComposeForLoad20112022` |
| family instance | `FamilyInstanceComposeForLoad20112013`, `20142017`, `20182022` |
| family symbol | `FamilySymbolComposeForLoad20172019` |
| material element | `MaterialElemComposeForLoad20112020`, plus a `20192019` hook |
| element header | `ElementHeaderComposeForLoad20162016` |

The names encode the releases to which a specialized composition hook applies.
They do not imply that a class ceases to exist after the last number; a release
may reuse the generic schema with no additional hook.

### Parser consequence

The browser decoder should dispatch on:

```text
document release
  → stream/container version
    → class definition
      → versioned property composition
        → typed field reader
```

It should not dispatch only on a gzip signature or assume that `ElementId`,
`Identifier`, and `ElemTable` have the same representation in all releases.
Unknown fields need to be retained or safely skipped using their declared token
and container type so later properties remain aligned.

The existence of `OdBmGenericObjectReader`, `OdTfVariantReader`,
`OdBmObjectPtrReader`, `ClassesContainer`, and the `ComposeForLoad` registry
suggests the clean implementation should be a schema-driven object decoder with
an object-reference fixup phase, not a growing collection of regular-expression
extractors.

## 6. Recommended implementation sequence

The following sequence produces user-visible progress without claiming the
proprietary runtime has been ported:

1. **Object table and typed references**
   - decode 2024–2026 element-table/identifier variants;
   - assign stable internal handles;
   - retain unresolved references for a second fixup pass.
2. **Document and element history**
   - decode episodes and creation history;
   - emit verified native `UniqueId`.
3. **Lossless semantic graph**
   - emit all ownership, group, host, level, view, category, family/type, and
     dependency edges;
   - derive separate spatial/type/ownership trees.
4. **Family reconstruction**
   - resolve instance → symbol → family;
   - apply persisted transforms and flip flags;
   - recurse through cached nested instances and subcomponents;
   - mark geometry provenance.
5. **Material definitions**
   - decode base material elements and appearance assets;
   - convert supported channels to glTF PBR with an explicit approximation flag.
6. **Primitive assignment**
   - preserve geometry tags and face assignments through tessellation;
   - split mesh primitives when adjacent faces resolve to different materials.
7. **IFC parity harness**
   - compare by native `UniqueId` or a documented fallback match;
   - report element/type/spatial/material/geometry coverage separately.

## 7. IFC parity acceptance metrics

Matching the IFC should be a minimum acceptance criterion, but it needs bounded,
auditable metrics:

```ts
interface IfcParityReport {
  rvtElementCount: number;
  ifcProductCount: number;
  matchedProducts: number;
  nativeUniqueIdCoverage: number;
  typeRelationCoverage: number;
  spatialContainmentCoverage: number;
  geometryProductCoverage: number;
  triangleAreaRatio: number;
  boundingBoxCoverage: number;
  materialElementCoverage: number;
  materialPrimitiveCoverage: number;
  unmatchedRvtIds: string[];
  unmatchedIfcIds: string[];
}
```

Recommended gates for a proof of concept:

- every IFC product carrying a usable Revit source ID is matched or explicitly
  listed as unsupported;
- matched products agree on class/category and family/type where IFC retained
  them;
- spatial containment agrees for matched products;
- geometry is compared per product by bounds, triangle count, and surface area,
  not just aggregate model triangle count;
- material comparison is per primitive/shape item;
- every approximation or fallback records its provenance.

## 8. What is implementable versus still proprietary

| Capability | Clean client-side status |
| --- | --- |
| native UniqueId formatting/parsing | implementable now once history/episode records are decoded |
| genuine semantic organization | implementable as a typed graph once object references are decoded |
| family/type graph | implementable from persisted IDs and nested/subcomponent tables |
| cached family geometry instancing | implementable after stored geometry and transforms are decoded |
| base material definitions | implementable after material object/property decoding |
| face/geometry-tag material assignment | implementable only if tags survive geometry decoding/tessellation |
| arbitrary family regeneration | not derivable from exported symbols; requires solver, references, sketches, cuts, joins, and view rules |
| general Revit B-rep tessellation | requires an independently implemented compatible geometry pipeline or a licensed/native conversion path |
| lossless render appearance | not always representable in web/glTF PBR; explicit approximation is required |

The practical near-term target is therefore stronger than the current semantic
scan but narrower than a Revit clone: decode the real object graph, native
identity, cached geometry, and assignment metadata; instance what the RVT
already stores; and measure it element-by-element against the reference IFC.
