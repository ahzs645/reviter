/* tslint:disable */
/* eslint-disable */

/**
 * Apply a category filter to a scene. `filter` is a `CategoryFilter`
 * JSON value; returns the pruned scene tree.
 */
export function applyCategoryFilter(scene: any, filter: any): any;

/**
 * Build the scene-graph tree for a model.
 */
export function buildSceneGraph(model: any): any;

/**
 * Build a flat schedule table of every BuildingElement.
 */
export function buildSchedule(model: any): any;

/**
 * Compute the camera eye position for a given CameraState.
 */
export function cameraEye(state: any): any;

/**
 * Decode a URL fragment into a ViewerState (or `null`).
 */
export function decodeFromFragment(fragment: string): any;

/**
 * Default section box for a given view mode.
 */
export function defaultSectionBoxForView(mode: any, storey_elevation_feet: number, model_bbox: any): any;

/**
 * SheetOptions defaults for the JS side. Exposed as a helper so
 * the frontend can fetch them once and mutate fields rather than
 * re-declaring the defaults.
 */
export function defaultSheetOptions(): any;

/**
 * Distinct IFC types in the scene — source of truth for the
 * layer-toggle UI.
 */
export function distinctIfcTypes(scene: any): any;

/**
 * Populate the element info panel for a click target.
 */
export function elementInfoPanel(model: any, entity_index: number): any;

/**
 * Encode a ViewerState to a URL fragment string.
 */
export function encodeToFragment(state: any): string;

/**
 * Render `model` as a glTF 2.0 binary. Returns a `Uint8Array`
 * the frontend feeds into Three.js's `GLTFLoader`.
 */
export function modelToGlb(model: any): Uint8Array;

/**
 * Render `model` as an IFC4 STEP document. Returns the ISO-10303-21
 * text; callers wrap it in a Blob for download.
 */
export function modelToIfcStep(model: any): string;

/**
 * Open an RVT / RFA byte slice and return the raw `IfcModel` as
 * a JS object. The viewer passes this around and then calls the
 * other bindings to derive scene graph / glTF / schedule / etc.
 */
export function openRvtBytes(bytes: Uint8Array): any;

/**
 * Open an RVT / RFA byte slice and return `{ model, diagnostics }`.
 *
 * The diagnostics payload matches `rvt-ifc --diagnostics` and is
 * intended for viewer bug reports and export-readiness messaging.
 */
export function openRvtBytesWithDiagnostics(bytes: Uint8Array): any;

/**
 * Open an RVT / RFA byte slice and return `{ model, diagnostics }`
 * with explicit walker scan limits.
 */
export function openRvtBytesWithDiagnosticsAndLimits(bytes: Uint8Array, limits: any): any;

/**
 * Open an RVT / RFA byte slice with explicit walker scan limits.
 */
export function openRvtBytesWithLimits(bytes: Uint8Array, limits: any): any;

/**
 * Quick summary — reads only the cheap metadata (BasicFileInfo +
 * PartAtom + stream inventory) and returns instantly even for
 * multi-hundred-megabyte RFAs. Used by the viewer for the
 * progressive-loading splash before the full model parse
 * completes. Returns a [`crate::reader::Summary`] as a JS object.
 */
export function quickSummary(bytes: Uint8Array): any;

/**
 * Render `model` as a 2D SVG plan view (sheet). Options control
 * dimensions + labels + background; pass `null` for defaults.
 */
export function renderPlanSvg(model: any, options: any): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly applyCategoryFilter: (a: number, b: number, c: number) => void;
    readonly buildSceneGraph: (a: number, b: number) => void;
    readonly buildSchedule: (a: number, b: number) => void;
    readonly cameraEye: (a: number, b: number) => void;
    readonly decodeFromFragment: (a: number, b: number, c: number) => void;
    readonly defaultSectionBoxForView: (a: number, b: number, c: number, d: number) => void;
    readonly defaultSheetOptions: (a: number) => void;
    readonly distinctIfcTypes: (a: number, b: number) => void;
    readonly elementInfoPanel: (a: number, b: number, c: number) => void;
    readonly encodeToFragment: (a: number, b: number) => void;
    readonly modelToGlb: (a: number, b: number) => void;
    readonly modelToIfcStep: (a: number, b: number) => void;
    readonly openRvtBytes: (a: number, b: number, c: number) => void;
    readonly openRvtBytesWithDiagnostics: (a: number, b: number, c: number) => void;
    readonly openRvtBytesWithDiagnosticsAndLimits: (a: number, b: number, c: number, d: number) => void;
    readonly openRvtBytesWithLimits: (a: number, b: number, c: number, d: number) => void;
    readonly quickSummary: (a: number, b: number, c: number) => void;
    readonly renderPlanSvg: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
