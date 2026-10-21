"use client";

import { useEffect, useRef, useState } from "react";
import { matchingCommands, type StudioCommand } from "./commands.ts";

export function CommandPalette({ commands, onRun, onClose, message }: {
  commands: readonly StudioCommand[];
  onRun: (id: string, argument?: string) => Promise<boolean>;
  onClose: () => void;
  message?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [argumentFor, setArgumentFor] = useState<StudioCommand | null>(null);
  const [argument, setArgument] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const matches = matchingCommands(commands, query);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const choose = async (command: StudioCommand) => {
    if (command.reason || pending) return;
    if (command.argument && argumentFor?.id !== command.id) {
      setArgumentFor(command); setArgument(""); setError(""); return;
    }
    setPending(true); setError("");
    try {
      if (await onRun(command.id, argument)) onClose();
      else setError("Command could not run. Check the status message.");
    } finally { setPending(false); }
  };
  return <dialog ref={dialog} className="command-palette" aria-labelledby="command-title"
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && !pending) { event.preventDefault(); onClose(); }
    }}
    onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <div className="command-content">
      <div className="review-panel-heading"><h2 id="command-title">Commands</h2><button type="button" onClick={onClose} disabled={pending} aria-label="Close commands">×</button></div>
      {argumentFor ? <form onSubmit={event => { event.preventDefault(); void choose(argumentFor); }}>
        <p>{argumentFor.label}</p>
        <label>{argumentFor.argument!.label}<input key={argumentFor.id} autoFocus value={argument} placeholder={argumentFor.argument!.placeholder} onChange={event => setArgument(event.target.value)} /></label>
        <div className="review-actions"><button type="button" onClick={() => setArgumentFor(null)} disabled={pending}>Back</button><button type="submit" disabled={pending || !argument.trim()}>Run command</button></div>
      </form> : <>
        <input autoFocus type="search" aria-label="Search commands" placeholder="Search actions, tools, views…" value={query}
          onChange={event => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive(current => Math.max(0, Math.min(matches.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
            } else if (event.key === "Enter" && matches[active]) { event.preventDefault(); void choose(matches[active]); }
          }} />
        <div className="command-list">
          {matches.map((command, index) => <button key={command.id} type="button" className={index === active ? "active" : ""}
            aria-disabled={Boolean(command.reason)} onClick={() => void choose(command)}>
            <span>{command.label}<small>{command.reason || command.id}</small></span>{command.argument && <em>…</em>}
          </button>)}
          {!matches.length && <p>No matching commands.</p>}
        </div>
      </>}
      {error && <p role="alert">{message || error}</p>}
      <small>↑ ↓ to choose · Enter to run · Escape to close</small>
    </div>
  </dialog>;
}
