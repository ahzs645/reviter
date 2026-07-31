/**
 * Revit record codes observed in the partition stream.
 *
 * A record code is a raw byte value read out of one file, not a documented
 * constant, so every entry here is a measurement that a second building could
 * overturn. They live in one module for exactly that reason: while a code was
 * declared separately in each module that tested for it, a re-measurement could
 * correct one copy and leave the others reading a stale number, and nothing
 * would fail loudly enough to notice.
 *
 * Anything derived from the published Revit API — `BuiltInCategory` ids,
 * `BuiltInParameter` ids, schema source-class slots — is reference data rather
 * than a measurement and does not belong here.
 */

/**
 * Record code of the companion record holding a stair run's own elevations.
 *
 * Measured on the supplied Revit 2027 project, where it appears on 111 records,
 * each one id above a stair part, and the paired IFC export names none of them.
 */
export const STAIR_COMPANION_CODE = 169_671;

/**
 * Bounds-only curtain-grid cell carried beneath a curtain-wall owner.
 *
 * The supplied Revit 2027 model contains 725 of these records. 717 are flat
 * grid loci and therefore never enter the solid proxy path. The remaining
 * eight all have the same 4.868 × 3.042 × 9.186 ft envelope and sit beside the
 * independently persisted panels and mullions of their curtain-wall owner.
 * Extruding those eight envelopes creates the opaque boxes visible through the
 * sloped atrium glazing.
 *
 * This code alone is not a deletion rule. `curtainAssemblyHelperProxyIds`
 * additionally requires persisted curtain-wall ownership and a resolved facade
 * child before an unresolved envelope can be omitted.
 */
export const CURTAIN_GRID_CELL_RECORD_CODE = 34_702;

/**
 * The "no class" record code: a record Revit wrote without a class code.
 *
 * Unlike the codes around it this one is self-describing — it is the all-ones
 * word, the same sentinel the bounds decoder treats as a missing code — so it
 * carries further than a single file.
 */
export const NO_CLASS_RECORD_CODE = 0xffff_ffff;
