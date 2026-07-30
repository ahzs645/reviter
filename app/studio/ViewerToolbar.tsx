import type { ViewerTool } from "./viewer-tools.ts";

type ToolDefinition =
  | { kind: "action"; id: "home" | "properties" | "fit"; icon: string; label: string }
  | { kind: "tool"; id: ViewerTool; icon: string; label: string };

const TOOLBAR: readonly ToolDefinition[] = [
  { kind: "action", id: "home", icon: "⌂", label: "Home" },
  { kind: "action", id: "properties", icon: "▤", label: "Properties" },
  { kind: "action", id: "fit", icon: "⛶", label: "Fit" },
  { kind: "tool", id: "pan", icon: "✣", label: "Pan" },
  { kind: "tool", id: "zoom", icon: "⌕", label: "Zoom" },
  { kind: "tool", id: "orbit", icon: "◉", label: "Orbit" },
  { kind: "tool", id: "firstPerson", icon: "♙", label: "1st Person" },
  { kind: "tool", id: "measure", icon: "↔", label: "Measure" },
  { kind: "tool", id: "section", icon: "◩", label: "Section" },
  { kind: "tool", id: "explode", icon: "⬡", label: "Explode" },
  { kind: "tool", id: "markup", icon: "⌁", label: "Markup" },
];

export function ViewerToolbar({
  activeTool,
  propertiesActive,
  onTool,
  onHome,
  onFit,
  onProperties,
}: {
  activeTool: ViewerTool;
  propertiesActive: boolean;
  onTool: (tool: ViewerTool) => void;
  onHome: () => void;
  onFit: () => void;
  onProperties: () => void;
}) {
  const runAction = (id: "home" | "properties" | "fit") => {
    if (id === "home") onHome();
    else if (id === "properties") onProperties();
    else onFit();
  };

  return (
    <nav className="viewer-navigation" aria-label="Viewport navigation">
      {TOOLBAR.map((definition) => {
        const active = definition.kind === "tool"
          ? activeTool === definition.id
          : definition.id === "properties" && propertiesActive;
        return (
          <button
            key={definition.id}
            className={active ? "active" : ""}
            data-tool={definition.id}
            onClick={() => definition.kind === "tool"
              ? onTool(active ? "orbit" : definition.id)
              : runAction(definition.id)}
            aria-pressed={active}
            title={definition.label === "1st Person"
              ? "First person navigation"
              : definition.label}
          >
            <i>{definition.icon}</i>
            <span>{definition.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
