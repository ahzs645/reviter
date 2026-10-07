"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { DwgInspectionGroup } from "../../lib/reviter/dwg-inspection.ts";
import { useTheme } from "./use-theme.ts";
import { dwgDisplaySvg } from "./dwg-display.ts";

export function DwgInspector({ groups, selectedId, matchIndex, showAllMatches, onAllMatches, onSelect, onMatch, onClose }: {
  groups: readonly DwgInspectionGroup[]; selectedId: string | null; matchIndex: number;
  onSelect: (id: string | null) => void; onMatch: (index: number) => void; onClose: () => void;
  showAllMatches: boolean; onAllMatches: () => void;
}) {
  const [filter, setFilter] = useState("block");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(60);
  const theme = useTheme();
  const selected = groups.find(group => group.id === selectedId);
  const instance = selected?.instances[matchIndex];
  const visible = groups.filter(group => group.kind === filter && `${group.name} ${group.layer}`.toLowerCase().includes(query.toLowerCase()));
  return <aside className="dwg-inspector" aria-label="Blocks and repeated shapes">
    <div className="dwg-inspector-heading"><strong>Blocks & Detect</strong><button type="button" className="rv-icon-button" aria-label="Close block inspector" onClick={onClose}><X size={15} aria-hidden /></button></div>
    <div className="dwg-inspector-filters" role="group" aria-label="Inspection type">
      <button type="button" aria-pressed={filter === "block"} onClick={() => { setFilter("block"); setLimit(60); onSelect(null); }}>Existing blocks</button>
      <button type="button" aria-pressed={filter === "repeat"} onClick={() => { setFilter("repeat"); setLimit(60); onSelect(null); }}>Repeated shapes</button>
    </div>
    <p>{filter === "block" ? "Names and references read from the DWG. Counts apply to this plan." : "Candidates with matching geometry, size, layer and orientation. Translation only; up to 200 groups across the drawing."}</p>
    <input type="search" aria-label="Search blocks and shapes" placeholder="Search name or layer" value={query} onChange={event => setQuery(event.target.value)} />
    {selected && <div className="dwg-match-detail">
      <strong>{selected.name}</strong><span>{selected.instances.length} {selected.kind === "block" ? "references" : "matches"} on this plan</span>
      <button type="button" className="rv-button" aria-pressed={showAllMatches} onClick={onAllMatches}>Highlight all</button>
      <div className="dwg-match-navigation">
        <button type="button" aria-label="Previous match" onClick={() => onMatch((matchIndex - 1 + selected.instances.length) % selected.instances.length)}><ChevronLeft size={15} aria-hidden /></button>
        <span>{matchIndex + 1} / {selected.instances.length}</span>
        <button type="button" aria-label="Next match" onClick={() => onMatch((matchIndex + 1) % selected.instances.length)}><ChevronRight size={15} aria-hidden /></button>
        <button type="button" onClick={() => onSelect(null)}>Clear</button>
      </div>
      {instance?.handle && <small>Source handle {instance.handle}</small>}
      {!!instance?.attributes?.length && <dl>{instance.attributes.map((attribute, index) => <div key={index}><dt>{attribute.tag}</dt><dd>{attribute.value}</dd></div>)}</dl>}
    </div>}
    <div className="dwg-inspector-results">
      {visible.slice(0, limit).map(group => <button type="button" key={group.id} className="dwg-inspection-card" aria-pressed={selectedId === group.id} onClick={() => onSelect(group.id)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={`data:image/svg+xml,${encodeURIComponent(dwgDisplaySvg(group.previewSvg, theme, true))}`} />
        <span><b>{group.name}</b><small>{group.instances.length} {group.kind === "block" ? "references" : "matches"} · {group.layer}</small><small>{group.entityCount} recovered entities in sample</small></span>
      </button>)}
      {!visible.length && <p>No {filter === "block" ? "block references" : "matching shape candidates"} on this plan.</p>}
      {visible.length > limit && <button type="button" className="rv-button" onClick={() => setLimit(value => value + 60)}>Show more ({visible.length - limit})</button>}
    </div>
  </aside>;
}
