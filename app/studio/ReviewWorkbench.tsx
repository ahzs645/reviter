"use client";
import { useState } from "react";
import { dimensionLabel, type ReviewSession } from "./review-session.ts";

export function ReviewWorkbench({ session, selectedCount, hiddenCount, canRestore, categoryNames, hiddenCategories, layout,
  onCommand, onPalette, onCategory, onSaveView, onRestoreView, onDeleteView, onDeleteDimension, onClearDimensions, onUndoDimensions, onRedoDimensions,
  canUndoDimensions, canRedoDimensions, onLayout, onImport, message }: {
  session: ReviewSession | null; selectedCount: number; hiddenCount: number; canRestore: boolean;
  categoryNames: readonly string[]; hiddenCategories: ReadonlySet<string>; layout: string;
  onCommand: (id: string) => void; onPalette: () => void; onCategory: (name: string, isolate: boolean) => void;
  onSaveView: (name: string) => void; onRestoreView: (id: string) => void; onDeleteView: (id: string) => void;
  onDeleteDimension: (id: string) => void; onClearDimensions: () => void;
  onUndoDimensions: () => void; onRedoDimensions: () => void; canUndoDimensions: boolean; canRedoDimensions: boolean;
  onLayout: (preset: string) => void; onImport: (file: File) => void; message: string;
}) {
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  return <section className="review-workbench" aria-label="Review workspace tools">
    <div className="review-quick-actions">
      <button type="button" onClick={onPalette}>Commands <kbd>Ctrl/⌘ K</kbd></button>
      <span>{selectedCount} selected · {hiddenCount} hidden</span>
      <button type="button" disabled={!selectedCount} onClick={() => onCommand("selection.isolate")}>Isolate selection</button>
      <button type="button" disabled={!canRestore} onClick={() => onCommand("visibility.restore")}>Restore visibility</button>
      <button type="button" onClick={() => onCommand("visibility.all")}>Show all</button>
      <label>Workspace layout<select aria-label="Workspace layout" value={layout} onChange={event => onLayout(event.target.value)}>
        <option value="inspection">Model inspection</option><option value="floor">Floor review</option><option value="drawing">Drawing review</option><option value="focus">Focus</option>
      </select></label>
    </div>
    <details>
      <summary>Views, visibility & dimensions</summary>
      <div className="review-workbench-grid">
        <section aria-label="Selection and visibility">
          <h3>Selection & visibility</h3>
          <p>Shift-click adds objects. Shift-drag selects by projected bounds: left → right encloses, right → left crosses. Visible objects only; includes depth.</p>
          <div className="review-actions">
            <button type="button" disabled={!selectedCount} onClick={() => onCommand("selection.similar")}>Select similar</button>
            <button type="button" disabled={!selectedCount} onClick={() => onCommand("selection.hide")}>Hide selection</button>
            <button type="button" disabled={!selectedCount} onClick={() => onCommand("selection.clear")}>Clear selection</button>
          </div>
          <input type="search" aria-label="Search visibility categories" placeholder="Search categories" value={filter} onChange={event => setFilter(event.target.value)} />
          <div className="review-scroll">{categoryNames.filter(category => category.toLowerCase().includes(filter.toLowerCase())).map(category => <div key={category} className="review-list-row">
            <label><input type="checkbox" checked={!hiddenCategories.has(category)} onChange={() => onCategory(category, false)} />{category}</label>
            <button type="button" onClick={() => onCategory(category, true)} aria-label={`Isolate ${category}`}>Isolate</button>
          </div>)}</div>
        </section>
        <section aria-label="Saved review views">
          <h3>Saved views</h3>
          <p>Camera, source, floor, section and visibility are saved with this source revision.</p>
          <form className="review-actions" onSubmit={event => { event.preventDefault(); onSaveView(name); setName(""); }}>
            <input aria-label="Saved view name" placeholder="View name" maxLength={120} required value={name} onChange={event => setName(event.target.value)} />
            <button type="submit" disabled={!session || !name.trim()}>Save view</button>
          </form>
          <div className="review-scroll">{session?.views.map(view => <div className="review-list-row" key={view.id}>
            <button type="button" onClick={() => onRestoreView(view.id)}>{view.name}</button><button type="button" onClick={() => onDeleteView(view.id)} aria-label={`Delete view ${view.name}`}>Delete</button>
          </div>)}</div>
          <div className="review-actions">
            <button type="button" disabled={!session} onClick={() => onCommand("review.export")}>Export views & dimensions</button>
            <label className="review-file-button">Import review<input type="file" accept=".json" disabled={!session} onChange={event => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} /></label>
          </div>
        </section>
        <section aria-label="Saved dimensions">
          <h3>Dimensions <small>{session?.dimensions.length ?? 0}</small></h3>
          <p>Fixed review anchors retain geometry provenance. Measure to add a dimension; source geometry stays unchanged.</p>
          <div className="review-actions">
            <button type="button" onClick={() => onCommand("tool.measure")}>Measure</button>
            <button type="button" disabled={!canUndoDimensions} onClick={onUndoDimensions}>Undo dimension</button>
            <button type="button" disabled={!canRedoDimensions} onClick={onRedoDimensions}>Redo dimension</button>
            <button type="button" disabled={!session?.dimensions.length} onClick={onClearDimensions}>Clear dimensions</button>
          </div>
          <div className="review-scroll">{session?.dimensions.map(d => <div className="review-list-row" key={d.id}>
            <span>{d.mode} · {dimensionLabel(d)}<small>{d.provenance}</small></span><button type="button" onClick={() => onDeleteDimension(d.id)} aria-label={`Delete dimension ${dimensionLabel(d)}`}>Delete</button>
          </div>)}</div>
        </section>
      </div>
    </details>
    {message && <p className="review-status" role="status">{message}</p>}
  </section>;
}
