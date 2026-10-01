"use client";

import { useMemo, useState } from "react";
import { saveCampusStorey, ungroupCampusStorey } from "../../lib/reviter/campus-floors.ts";
import { roomBuilding, type RoomDirectoryData } from "../../lib/reviter/room-directory.ts";
import type { LevelBand } from "../../lib/reviter/types.ts";

export function CampusFloorEditor({data, levels, currentLevelId, onSave, onClose}: {
  data: RoomDirectoryData;
  levels: readonly LevelBand[];
  currentLevelId: number | null;
  onSave: (data: RoomDirectoryData, levelId: number | null, message: string) => void;
  onClose: () => void;
}) {
  const groups = data.campusStoreys ?? [];
  const initial = groups.find(g => g.levelIds.includes(currentLevelId ?? -1));
  const [groupId, setGroupId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [selected, setSelected] = useState<number[]>(initial?.levelIds ?? (currentLevelId == null ? [] : [currentLevelId]));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const nativeLevels = useMemo(() => {
    const active = data.annotations.filter(r => r.status !== "deleted");
    return levels.filter(l => l.levelId != null && Number.isFinite(l.elevation) && active.some(r => r.levelId === l.levelId))
      .sort((a,b) => a.elevation - b.elevation || a.levelId! - b.levelId!)
      .map(l => {
        const records = active.filter(r => r.levelId === l.levelId);
        return {...l, records: records.length, buildings: [...new Set(records.map(roomBuilding))].sort(),
          plans: [...new Set(records.flatMap(r => r.dwg?.sectionId ? [r.dwg.sectionId] : []))]};
      });
  }, [data.annotations, levels]);
  function chooseGroup(id: string) {
    const group = groups.find(g => g.id === id);
    setGroupId(id); setName(group?.name ?? ""); setSelected(group?.levelIds ?? []);
    setNotice(""); setError("");
  }
  function save() {
    try {
      const id = groupId || `campus-floor:${crypto.randomUUID()}`;
      const next = saveCampusStorey(data, {id, name, levelIds: selected, evidence: "user-reported"});
      const message = `${name.trim()} saved with ${selected.length} native levels. Export rooms with edits or the project ZIP to keep this assignment.`;
      setGroupId(id); setName(name.trim()); setNotice(message); setError("");
      onSave(next, selected.includes(currentLevelId ?? -1) ? currentLevelId : selected[0]!, message);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function ungroup() {
    const next = ungroupCampusStorey(data, groupId);
    const message = `${groups.find(g => g.id === groupId)?.name ?? "Campus floor"} ungrouped. Native levels appear separately again. Export to keep this change.`;
    const target = selected.includes(currentLevelId ?? -1) ? currentLevelId : selected[0] ?? currentLevelId;
    chooseGroup(""); setNotice(message);
    onSave(next, target, message);
  }
  return <section className="campus-floor-editor" aria-label="Shared campus floor assignments">
    <header><div><h2>Shared campus floors</h2><p>Assign offset Revit levels to the same campus floor. Their heights stay intact in 3D; walking connections still use doors, open passages or steps.</p></div><button className="rv-button" onClick={onClose}>Close floor assignments</button></header>
    <div className="campus-floor-fields">
      <label>Assignment<select aria-label="Campus floor assignment" value={groupId} onChange={e => chooseGroup(e.target.value)}><option value="">New shared campus floor</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <label>Campus floor name<input aria-label="Campus floor name" maxLength={200} value={name} placeholder="e.g. Campus Floor 1" onChange={e => {setName(e.target.value);setError("");setNotice("");}}/></label>
    </div>
    <fieldset><legend>Native levels · choose at least two</legend><div className="campus-floor-levels">{nativeLevels.map(l => {
      const owner = groups.find(g => g.id !== groupId && g.levelIds.includes(l.levelId!));
      return <label key={l.levelId} className={`campus-floor-level ${owner ? "assigned-elsewhere" : ""}`}>
        <input type="checkbox" aria-label={`Include native level ${l.levelId}`} disabled={!!owner} checked={selected.includes(l.levelId!)} onChange={e => {setSelected(ids => e.target.checked ? [...ids,l.levelId!] : ids.filter(id => id !== l.levelId));setNotice("");setError("");}}/>
        <span><strong>#{l.levelId} · {l.elevation.toFixed(2)} ft</strong><span>{l.name ?? "Native Revit level"} · Buildings {l.buildings.join(", ")} · {l.records} records</span><span className="campus-floor-plans">{l.plans.join(" · ")}</span>{owner && <span>Assigned to {owner.name}. Edit that assignment first to release this level.</span>}</span>
      </label>;
    })}</div></fieldset>
    <div className="campus-floor-actions"><button className="rv-button primary" disabled={!name.trim() || selected.length < 2} onClick={save}>Save shared campus floor</button><button className="rv-button" disabled={!groupId} onClick={ungroup}>Ungroup levels</button><span>{selected.length} native levels selected · user reviewed</span></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
