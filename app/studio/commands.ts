/** One dispatcher for toolbar, palette, shortcuts and context-menu actions. */
export type StudioCommand = {
  id: string;
  label: string;
  keywords?: string;
  argument?: { label: string; placeholder: string };
  reason?: string | null;
  run: (argument: string) => void | Promise<void>;
};

export function matchingCommands(commands: readonly StudioCommand[], query: string): StudioCommand[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter(command => words.every(word =>
    `${command.id} ${command.label} ${command.keywords ?? ""}`.toLowerCase().includes(word)));
}

export async function executeCommand(commands: readonly StudioCommand[], id: string, argument = ""): Promise<string> {
  const command = commands.find(entry => entry.id === id);
  if (!command) throw new Error(`Unknown command: ${id}`);
  if (command.reason) throw new Error(command.reason);
  if (command.argument && !argument.trim()) throw new Error(`Enter ${command.argument.label.toLowerCase()}.`);
  await command.run(argument.trim());
  return command.label;
}

export function isEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable=true], [role=dialog]"));
}
