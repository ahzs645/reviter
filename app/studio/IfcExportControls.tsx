"use client";
import type { ConvertResult } from "../../lib/reviter/types.ts";
import type { IfcExportOptions } from "../../lib/reviter/export-ifc.ts";

export function IfcExportControls({ result, value, onChange, disabled }: {
  result: ConvertResult;
  value: IfcExportOptions;
  onChange: (value: IfcExportOptions) => void;
  disabled: boolean;
}) {
  const rooms = result.nativeSourceRooms?.length ?? 0;
  const systems = result.nativeMepEvidence?.systems.length ?? 0;
  const joins = result.nativeMepEvidence?.connections.length ?? 0;
  const ports = result.nativeMepEvidence?.ports?.length ?? 0;
  const pipes = result.nativeMepEvidence?.dimensions?.filter(dimension => dimension.pipeAxis && dimension.pipeInnerDiameterFeet != null && dimension.pipeOuterDiameterFeet != null).length ?? 0;
  const alternatives = result.nativeDesignOptionMembership?.length ?? 0;
  const hasMeshes = result.meshes.length > 0;
  const storedGuids = (result.nativeIfcGuidParameters?.length ?? 0) > 0 || result.elementBounds.some(record =>
    [...record.parameters ?? [], ...record.typeParameters ?? []].some(parameter => parameter.parameterId === -1019000 || parameter.parameterId === -1019001));
  if (!rooms && !systems && !joins && !ports && !alternatives && !storedGuids && !pipes && !hasMeshes) return null;
  return <fieldset className="ifc-export-controls" disabled={disabled}>
    <legend>IFC content</legend>
    {hasMeshes && <label><input type="checkbox" checked={value.reuseMappedGeometry === true}
      onChange={event => onChange({ ...value, reuseMappedGeometry: event.target.checked })} />
      Share identical source type geometry in IFC</label>}
    {storedGuids && <label><input type="checkbox" checked={value.allowGuidParameterOverride === true}
      onChange={event => onChange({ ...value, allowGuidParameterOverride: event.target.checked })} />
      Use stored IFC GUID overrides where valid</label>}
    {pipes > 0 && <><label><input type="checkbox" checked={value.reconstructPipeGeometry === true}
      onChange={event => onChange({ ...value, reconstructPipeGeometry: event.target.checked })} />
      Reconstruct eligible pipe bodies from source dimensions</label>
      <p>IFC only; replaces eligible proxy bodies with hollow sweeps. These remain approximate.</p></>}
    {rooms > 0 && <label><input type="checkbox" checked={value.nativeRooms === true}
      onChange={event => onChange({ ...value, nativeRooms: event.target.checked })} />
      Include {rooms.toLocaleString()} source Revit rooms</label>}
    {(systems > 0 || joins > 0 || ports > 0) && <>
      <label><input type="checkbox" checked={value.mep === true}
        onChange={event => onChange({ ...value, mep: event.target.checked })} />
        Include MEP systems and ports ({systems.toLocaleString()} systems, {joins.toLocaleString()} connections)</label>
      <p>Connections may be incomplete. System memberships include source-reference candidates.</p>
    </>}
    {alternatives > 0 && <label>Design options
      <select value={value.designOptions ?? "all"} onChange={event => {
        const designOptions = event.target.value === "main-and-primary" ? "main-and-primary" : "all";
        onChange({ ...value, designOptions });
      }}>
        <option value="all">All options</option>
        <option value="main-and-primary">Main model and primary options</option>
      </select>
    </label>}
    {alternatives > 0 && <p>Options whose primary selection is unresolved stay in the export.</p>}
    {rooms > 0 && <p>Source room outlines are separate from reviewed spaces and navigation boundaries.</p>}
  </fieldset>;
}
