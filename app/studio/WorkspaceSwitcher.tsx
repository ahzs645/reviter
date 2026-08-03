"use client";

import { Box, Layers3 } from "lucide-react";

import type { StudioWorkspace } from "./types.ts";

export function WorkspaceSwitcher({
  workspace,
  floorLevelCount,
  onWorkspace,
}: {
  workspace: StudioWorkspace;
  floorLevelCount: number;
  onWorkspace: (workspace: StudioWorkspace) => void;
}) {
  return (
    <nav className="workspace-switcher" aria-label="Workspaces">
      <button
        type="button"
        className={workspace === "model" ? "active" : ""}
        aria-pressed={workspace === "model"}
        onClick={() => onWorkspace("model")}
      >
        <Box size={13} aria-hidden />
        <span>Model</span>
      </button>
      <button
        type="button"
        className={workspace === "floors" ? "active" : ""}
        aria-pressed={workspace === "floors"}
        onClick={() => onWorkspace("floors")}
      >
        <Layers3 size={13} aria-hidden />
        <span>Floors</span>
        <em aria-label={`${floorLevelCount} levels`}>{floorLevelCount}</em>
      </button>
    </nav>
  );
}
