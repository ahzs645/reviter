/**
 * What kind of value each built-in parameter holds, and how to show it.
 *
 * A decoded parameter is a number or a text, in Revit's internal units, with
 * nothing in the file saying which unit: a wall's `Unconnected Height` and a
 * floor's `Span Direction` are both a bare f64, and `Structural` is an i32
 * that means yes or no. Printing every number as feet made a floor's span
 * direction read "2.5831 ft" (it is 148 degrees) and its structural flag
 * "0.0000 ft".
 *
 * Autodesk declares both halves for every built-in parameter: the storage type
 * the value is kept in, and the spec that gives it a unit. The table here is
 * packed from that declaration (`docs/generated/revit-parameter-descriptors.json`,
 * see `scripts/generate-parameter-specs.mjs`). Revit's internal units are fixed
 * whatever the project's display units are: feet, square and cubic feet, and
 * radians.
 */
import { parameterDisplayName } from "./built-in-parameters.ts";
import {
  PACKED_PARAMETER_KINDS,
  PACKED_UNLABELLED_PARAMETERS,
} from "./parameter-specs.data.ts";

export type ParameterKind = keyof typeof PACKED_PARAMETER_KINDS;

/** The value set a parameter's declared storage puts it in. */
export type ParameterStorage = "double" | "integer" | "text" | "elementId";

let kinds: Map<number, ParameterKind> | undefined;
let unlabelled: Set<number> | undefined;

function unpackIds(packed: string): number[] {
  return packed ? packed.split(",").map((id) => -Number.parseInt(id, 36)) : [];
}

function kindTable(): Map<number, ParameterKind> {
  if (!kinds) {
    kinds = new Map();
    for (const [kind, packed] of Object.entries(PACKED_PARAMETER_KINDS)) {
      for (const id of unpackIds(packed)) kinds.set(id, kind as ParameterKind);
    }
  }
  return kinds;
}

/** The kind Autodesk declares for a parameter id, or undefined for one it does not list. */
export function parameterKind(parameterId: number): ParameterKind | undefined {
  return kindTable().get(parameterId);
}

/** The value set a parameter is stored in, from its declared kind. */
export function parameterStorage(parameterId: number): ParameterStorage | undefined {
  switch (parameterKind(parameterId)) {
    case undefined:
    case "none":
      return undefined;
    case "bool":
    case "integer":
      return "integer";
    case "text":
      return "text";
    case "elementId":
      return "elementId";
    default:
      return "double";
  }
}

/**
 * True for a parameter Revit never shows: Autodesk lists it without a label
 * (`wallHeightParam`, `cwallFakeEndParamn0`), or lists it nowhere and no
 * published source names it either.
 */
export function isInternalParameter(parameterId: number): boolean {
  unlabelled ??= new Set(unpackIds(PACKED_UNLABELLED_PARAMETERS));
  if (unlabelled.has(parameterId)) return true;
  return parameterKind(parameterId) === undefined &&
    parameterDisplayName(parameterId) === `Parameter ${parameterId}`;
}

const DEGREES_PER_RADIAN = 180 / Math.PI;

/** Up to `digits` decimals, without trailing zeros, and never "-0". */
function decimal(value: number, digits: number): string {
  const text = value.toFixed(digits).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

/**
 * The value as Revit would describe it, in internal units, or null when the
 * value cannot be what its parameter declares: a yes/no that is neither 0 nor
 * 1, or an element id that is neither -1 nor a positive integer.
 */
export function formatParameterValue(parameter: {
  parameterId: number;
  value: number | string;
  /** The name of the choice an enumerated value stands for. */
  valueName?: string;
}): string | null {
  const { parameterId, value, valueName } = parameter;
  if (typeof value === "string") return value;
  switch (parameterKind(parameterId)) {
    case "length":
      return `${decimal(value, 4)} ft`;
    case "angle":
      return `${decimal(value * DEGREES_PER_RADIAN, 2)}°`;
    case "area":
      return `${decimal(value, 3)} ft²`;
    case "volume":
      return `${decimal(value, 3)} ft³`;
    case "bool":
      return value === 1 ? "Yes" : value === 0 ? "No" : null;
    case "integer":
      if (!Number.isInteger(value)) return null;
      return valueName ?? String(value);
    case "elementId":
      return value === -1 ? "None" : Number.isInteger(value) && value > 0 ? `Element ${value}` : null;
    case "text":
      return null;
    default:
      return decimal(value, 4);
  }
}

/** `WALL_USER_HEIGHT_PARAM`, the height a wall stores for itself. */
const WALL_USER_HEIGHT_PARAMETER = -1_001_105;
/** `wallHeightParam`: the wall's height as built, which Revit never labels. */
const WALL_HEIGHT_PARAMETER = -1_001_101;

export type PresentedParameter = { parameterId: number; label: string; value: string };

/**
 * The parameters worth showing, labelled and in their units.
 *
 * One substitution: a wall's stored `Unconnected Height` is the height it had
 * when its top was last unconstrained, and Revit does not update it once the
 * top is tied to a level. Against the Autodesk Viewer's figure for the same
 * walls, the stored value is right for 209 of 9,368 in the UNBC project and
 * 161 of 734 in the Snowdon sample, while the wall's own built height, which
 * Revit keeps unlabelled, is right for 9,368 and 719. Where the built height
 * is decoded it is shown as "Height" in place of the stored one. (Where a
 * wall's top is attached to a roof or ceiling, Revit's "Unconnected Height"
 * reports the level-to-level distance instead, which is not decoded.)
 */
export function presentedParameters(
  parameters: readonly { parameterId: number; name: string; value: number | string; valueName?: string }[],
): PresentedParameter[] {
  const built = parameters.find((parameter) => parameter.parameterId === WALL_HEIGHT_PARAMETER);
  const shown: PresentedParameter[] = [];
  for (const parameter of parameters) {
    if (parameter.parameterId === WALL_USER_HEIGHT_PARAMETER && built) continue;
    const isBuiltHeight = parameter.parameterId === WALL_HEIGHT_PARAMETER;
    if (!isBuiltHeight && isInternalParameter(parameter.parameterId)) continue;
    const value = formatParameterValue(parameter);
    if (value == null) continue;
    shown.push({
      parameterId: parameter.parameterId,
      label: isBuiltHeight ? "Height" : parameter.name,
      value,
    });
  }
  return shown;
}
