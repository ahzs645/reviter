"use client";
import { useState } from "react";
import type { ModelViewpoint } from "./viewer-tools.ts";
import {
  portableViewpoint, resolveViewpointImport, viewpointLinkUrl,
  type ViewpointModelIdentity, type PortableViewerState,
} from "./viewpoint-links.ts";

/** Parent supplies the live camera and bounded display state and applies a pose after switching to RVT. */
export function ViewpointLinkControls({ identity, captureCamera, captureViewerState, onRestore }: {
  identity: ViewpointModelIdentity | null;
  captureCamera: () => ModelViewpoint | null;
  captureViewerState?: (includeMarkup?: boolean) => PortableViewerState;
  onRestore: (camera: ModelViewpoint, viewer?: PortableViewerState) => void;
}) {
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [includeMarkup, setIncludeMarkup] = useState(false);
  const copy = async () => {
    try {
      if (!identity) throw new Error("Open the source RVT model before copying a viewpoint link.");
      const camera = captureCamera();
      if (!camera) throw new Error("The model camera is not ready yet.");
      const url = viewpointLinkUrl(window.location.href, portableViewpoint(identity, camera, captureViewerState?.(includeMarkup)));
      setLink(url);
      if (!navigator.clipboard?.writeText) { setMessage("Select and copy the viewpoint link below."); return; }
      // Clipboard is touched only in this explicit user-click handler.
      try { await navigator.clipboard.writeText(url); }
      catch { setMessage("Select and copy the viewpoint link below."); return; }
      setMessage("Viewpoint link copied. Open the same RVT file to use it.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The viewpoint link could not be copied."); }
  };
  const restore = () => {
    const imported = resolveViewpointImport(link, identity);
    setMessage(imported.message);
    if (imported.status === "ready") onRestore(imported.camera, imported.viewpoint.viewer);
  };
  return <div className="viewer-viewpoint-links" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", paddingTop: 8 }}>
    <button className="rv-button" type="button" disabled={!identity} onClick={() => void copy()}>Copy viewpoint link</button>
    <label style={{ flex: "1 1 260px", minWidth: 0 }}>Viewpoint link<input style={{ width: "100%" }} aria-label="Viewpoint link" value={link} maxLength={8192} onChange={event => setLink(event.target.value)} placeholder="Paste a viewpoint link" /></label>
    <button className="rv-button" type="button" disabled={!link.trim()} onClick={restore}>Restore viewpoint</button>
    <label><input type="checkbox" checked={includeMarkup} onChange={event => setIncludeMarkup(event.target.checked)} /> Include current review markup</label>
    <p style={{ flexBasis: "100%" }}>Saves the camera, hidden categories, section cut, selection and display mode. Markup is included when selected. The same source RVT file is required.</p>
    {message && <p role="status">{message}</p>}
  </div>;
}
