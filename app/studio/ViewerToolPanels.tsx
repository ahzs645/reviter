import type { WalkSpeed } from "./walk-controls.ts";
import {
  type MeasureMode,
  type MeasureUnit,
  type SectionMode,
} from "./viewer-tools.ts";

export function FirstPersonPanel({
  looking,
  preparing,
  drawing,
  speed,
  gravity,
  collision,
  guideOpen,
  onSpeed,
  onGravity,
  onCollision,
  onDrop,
  onGuide,
  onNeverShow,
  onExit,
}: {
  looking: boolean;
  /** The spatial floor index is still being prepared without blocking the UI. */
  preparing: boolean;
  /** A drawing tool is armed, so the look drag has moved to the right button. */
  drawing: boolean;
  speed: WalkSpeed;
  gravity: boolean;
  /** Null hides the toggle: the reference model has no collision to offer. */
  collision: boolean | null;
  guideOpen: boolean;
  onSpeed: (speed: WalkSpeed) => void;
  onGravity: (enabled: boolean) => void;
  onCollision: (enabled: boolean) => void;
  onDrop: () => void;
  onGuide: (open: boolean) => void;
  onNeverShow: () => void;
  onExit: () => void;
}) {
  return (
    <>
      <div className={`first-person-reticle${looking ? " active" : ""}`} aria-hidden="true" />
      <section className="first-person-panel" aria-label="First person options">
        <header>
          <strong>First person</strong>
          <span>
            <button onClick={() => onGuide(true)} aria-label="Show first person guide">?</button>
            <button onClick={onExit} aria-label="Exit first person">×</button>
          </span>
        </header>
        <p>{preparing
          ? "Preparing walkable surfaces…"
          : looking
          ? "Looking · release to stop"
          : drawing
            ? "Left drag draws · right drag looks"
            : "Drag to look around in place"}</p>
        <div className="first-person-speed" role="group" aria-label="Movement speed">
          {(["slow", "normal", "fast"] as const).map((entry) => (
            <button
              key={entry}
              className={speed === entry ? "active" : ""}
              onClick={() => onSpeed(entry)}
              aria-pressed={speed === entry}
            >{entry}</button>
          ))}
        </div>
        <div className="first-person-mode" role="group" aria-label="First person movement mode">
          <button
            className={gravity ? "active" : ""}
            onClick={(event) => {
              event.currentTarget.blur();
              onGravity(true);
            }}
            aria-pressed={gravity}
          >Walk</button>
          <button
            className={!gravity ? "active" : ""}
            onClick={(event) => {
              event.currentTarget.blur();
              onGravity(false);
            }}
            aria-pressed={!gravity}
          >Float</button>
        </div>
        {collision != null && (
          <div className="first-person-mode" role="group" aria-label="Wall collision">
            <button
              className={!collision ? "active" : ""}
              onClick={(event) => {
                event.currentTarget.blur();
                onCollision(false);
              }}
              aria-pressed={!collision}
              title="Move through walls and doors"
            >Ghost</button>
            <button
              className={collision ? "active" : ""}
              onClick={(event) => {
                event.currentTarget.blur();
                onCollision(true);
              }}
              aria-pressed={collision}
              title="Walls and doors block movement"
            >Solid <small>beta</small></button>
          </div>
        )}
        <button
          className="first-person-drop"
          onClick={(event) => {
            event.currentTarget.blur();
            onDrop();
          }}
        >
          Drop to nearest surface <kbd>Space</kbd>
        </button>
        <small>WASD move · Q down / E up · Shift run · −/+ speed · 1/2/3 compare · double-click travel</small>
      </section>
      {guideOpen && (
        <section className="first-person-guide" role="dialog" aria-modal="true" aria-label="Navigate in first person">
          <header>
            <strong>Navigate in first person</strong>
            <button onClick={() => onGuide(false)} aria-label="Close first person guide">×</button>
          </header>
          <div>
            <article><b>Walk</b><kbd>↑ ↓ ← →</kbd><span>or</span><kbd>W A S D</kbd></article>
            <article><b>Float</b><kbd>Q ↓</kbd><kbd>E ↑</kbd><small>Switch to Float to move freely between levels</small></article>
            <article><b>Run</b><kbd>Shift</kbd><span>+</span><kbd>direction</kbd></article>
            <article><b>Travel</b><i>◎</i><small>Double-click a destination</small></article>
            <article><b>Look around</b><i>↔</i><small>Click to capture the mouse, then move to look. Escape releases it. Touch and markup use drag.</small></article>
            <article><b>Comment here</b><i>▣</i><small>Arm Comment and click a surface: the pin and the viewpoint are saved where you stand</small></article>
            <article><b>Adjust speed</b><kbd>−</kbd><kbd>+</kbd></article>
            <article><b>Drop to surface</b><kbd>Space</kbd><small>Find the nearest surface below and resume Walk mode</small></article>
            <article><b>Compare sources</b><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><small>RVT · IFC · Autodesk GLB, with the camera kept in place</small></article>
          </div>
          <button className="first-person-guide-accept" onClick={() => onGuide(false)}>OK, got it</button>
          <button className="first-person-guide-dismiss" onClick={onNeverShow}>Don&apos;t remind me again</button>
        </section>
      )}
    </>
  );
}

export function MeasureToolPanel({
  mode,
  unit,
  calibration,
  calibrationSample,
  knownLength,
  settingsOpen,
  readings,
  onMode,
  onUnit,
  onKnownLength,
  onApplyCalibration,
  onToggleSettings,
  onDelete,
  onClear,
}: {
  mode: MeasureMode;
  unit: MeasureUnit;
  calibration: number;
  calibrationSample: number | null;
  knownLength: string;
  settingsOpen: boolean;
  readings: Array<{ id: number; label: string }>;
  onMode: (mode: MeasureMode) => void;
  onUnit: (unit: MeasureUnit) => void;
  onKnownLength: (value: string) => void;
  onApplyCalibration: () => void;
  onToggleSettings: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <section className="viewer-tool-panel measure-tool-panel" aria-label="Measure options">
      <header><strong>Measure</strong><span>{readings.length} saved</span></header>
      <div className="tool-option-grid measure-modes">
        {(["distance", "angle", "calibrate", "coordinates", "laser"] as const).map((entry) => (
          <button
            key={entry}
            className={mode === entry ? "active" : ""}
            onClick={() => onMode(entry)}
            aria-pressed={mode === entry}
          >{entry}</button>
        ))}
      </div>
      <div className="tool-option-row">
        <button onClick={onDelete} disabled={!readings.length}>Delete</button>
        <button onClick={onToggleSettings} aria-pressed={settingsOpen}>Settings</button>
        <button onClick={onClear}>Clear</button>
      </div>
      {mode === "calibrate" && (
        <div className="measure-settings">
          <label>Known length <input value={knownLength} onChange={(event) => onKnownLength(event.target.value)} /></label>
          <button onClick={onApplyCalibration} disabled={!calibrationSample}>Apply calibration</button>
        </div>
      )}
      {settingsOpen && (
        <div className="measure-settings">
          <label>Units
            <select value={unit} onChange={(event) => onUnit(event.target.value as MeasureUnit)}>
              <option value="feet">Feet</option>
              <option value="metres">Metres</option>
            </select>
          </label>
          <span>Scale {calibration.toFixed(4)}×</span>
        </div>
      )}
      <p>{mode === "angle" ? "Pick three points" : mode === "coordinates" || mode === "laser" ? "Pick a point" : "Pick two points"}</p>
      {readings.length > 0 && (
        <ol>{readings.slice(-4).map((reading) => <li key={reading.id}>{reading.label}</li>)}</ol>
      )}
    </section>
  );
}

export function SectionToolPanel({
  mode,
  offset,
  reverse,
  onMode,
  onOffset,
  onReverse,
  onClear,
}: {
  mode: SectionMode;
  offset: number;
  reverse: boolean;
  onMode: (mode: SectionMode) => void;
  onOffset: (offset: number) => void;
  onReverse: () => void;
  onClear: () => void;
}) {
  return (
    <section className="viewer-tool-panel section-tool-panel" aria-label="Section options">
      <header><strong>Section</strong><button onClick={onClear}>Clear</button></header>
      <div className="tool-option-grid">
        {(["x", "y", "z", "box"] as const).map((entry) => (
          <button
            key={entry}
            className={mode === entry ? "active" : ""}
            onClick={() => onMode(entry)}
            aria-pressed={mode === entry}
          >{entry === "box" ? "Box" : `${entry.toUpperCase()} Plane`}</button>
        ))}
      </div>
      <label>{mode === "box" ? "Inset" : "Plane position"}
        <input type="range" min="0" max="100" value={offset * 100} onChange={(event) => onOffset(Number(event.target.value) / 100)} />
      </label>
      <div className="section-tool-footer">
        <output>{Math.round(offset * 100)}%</output>
        <button
          onClick={onReverse}
          aria-pressed={reverse}
          disabled={mode === "box"}
        >Reverse side</button>
      </div>
    </section>
  );
}

export function ExplodeToolPanel({
  amount,
  parts,
  onAmount,
}: {
  amount: number;
  parts: number;
  onAmount: (amount: number) => void;
}) {
  return (
    <section className="viewer-tool-panel explode-tool-panel" aria-label="Explode options">
      <header><strong>Explode</strong><button onClick={() => onAmount(0)}>Clear</button></header>
      <label>Separation
        <input type="range" min="0" max="100" value={amount * 100} onChange={(event) => onAmount(Number(event.target.value) / 100)} />
      </label>
      <output>{Math.round(amount * 100)}% · {parts.toLocaleString()} parts</output>
    </section>
  );
}
