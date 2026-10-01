/** Classify the complete picker/drop selection before replacing an open model. */
export function modelImportFiles<T extends { name: string }>(files: readonly T[]) {
  const models = files.filter(file => /\.(rvt|rfa|rte|rft)$/i.test(file.name));
  const json = files.filter(file => /\.json$/i.test(file.name));
  if (models.length > 1 || json.length > 1 || files.length !== models.length + json.length) {
    throw new Error("Select one Revit model and optionally one room annotations JSON.");
  }
  if (!files.length) throw new Error("Choose a Revit model and optionally its room annotations JSON.");
  return { model: models[0] ?? null, json: json[0] ?? null };
}
