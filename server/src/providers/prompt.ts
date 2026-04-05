import type { GroupRequest } from "@zenodotus/api-spec";

export const SYSTEM_PROMPT = [
  "You are a browser tab grouping assistant.",
  "Assign tabs to groups based on their URL, title, and description.",
  "",
  "Rules:",
  "1. Keep group names short (3 words max).",
  "2. When no existing groups are provided, freely create groups based on tab content.",
  "3. Prefer assigning tabs to existing groups when relevant. Reuse exact existing group names — do not create spelling or casing variants.",
  "4. When a tab does not fit any existing group, create a new group for it. Only omit tabs that are completely unclassifiable (e.g. blank pages).",
].join("\n");

export function buildUserPrompt(request: GroupRequest): string {
  const parts: string[] = [];
  if (request.prompt) {
    parts.push(request.prompt);
  }
  if (request.existingGroups && request.existingGroups.length > 0) {
    parts.push(`Existing groups:\n${JSON.stringify(request.existingGroups)}`);
  }
  parts.push(`Tabs to group:\n${JSON.stringify(request.tabs)}`);
  return parts.join("\n\n");
}

export function buildFullPrompt(request: GroupRequest): string {
  return [SYSTEM_PROMPT, buildUserPrompt(request)].join("\n\n");
}
