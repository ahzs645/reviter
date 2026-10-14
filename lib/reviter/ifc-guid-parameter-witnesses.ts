/** Preserve conflicting native GUID strings before generic parameter merging. */
import type { ElementParameter, ElementParameterTable } from "./element-parameters.ts";
import { IFC_GUID_PARAMETER, IFC_TYPE_GUID_PARAMETER } from "./ifc-global-id.ts";

type Source = { stream: string; chunkIndex: number; rawOffset: number };
export type IfcGuidParameterWitness = ElementParameter & {
  source: "native-owned-parameter-table";
  occurrences: number;
  /** Bounded occurrence examples; original file bytes remain authoritative. */
  sourceLocations: Source[];
};

/** Two distinct values suffice to reject an ambiguous override, even if valid. */
export function createIfcGuidParameterWitnessCollector(declared?: ReadonlySet<number>) {
  const values = new Map<number, Map<number, IfcGuidParameterWitness[]>>();
  return {
    consume(table: ElementParameterTable, source: Source): void {
      if (!Number.isSafeInteger(table.elementId) || table.elementId < 1 ||
        (declared?.size && !declared.has(table.elementId))) return;
      for (const parameter of table.parameters) {
        if (parameter.parameterId !== IFC_GUID_PARAMETER && parameter.parameterId !== IFC_TYPE_GUID_PARAMETER) continue;
        let parameters = values.get(table.elementId);
        if (!parameters) values.set(table.elementId, parameters = new Map());
        let witnesses = parameters.get(parameter.parameterId);
        if (!witnesses) parameters.set(parameter.parameterId, witnesses = []);
        const previous = witnesses.find(witness => witness.value === parameter.value);
        if (previous) {
          previous.occurrences += 1;
          if (previous.sourceLocations.length < 4 && !previous.sourceLocations.some(location =>
            location.stream === source.stream && location.chunkIndex === source.chunkIndex && location.rawOffset === source.rawOffset)) previous.sourceLocations.push({ ...source });
        } else if (witnesses.length < 2) witnesses.push({
          ...parameter, source: "native-owned-parameter-table", occurrences: 1, sourceLocations: [{ ...source }],
        });
      }
    },
    snapshot(): ElementParameterTable[] {
      return [...values].sort(([left], [right]) => left - right).map(([elementId, parameters]) => ({
        elementId, parameters: [...parameters].sort(([left], [right]) => left - right).flatMap(([, witnesses]) =>
          witnesses.map(witness => ({ ...witness, sourceLocations: witness.sourceLocations.map(source => ({ ...source })) }))),
      }));
    },
  };
}
