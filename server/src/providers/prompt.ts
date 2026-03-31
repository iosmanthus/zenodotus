import { spec } from "@zenodotus/api-spec";
import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];

const specComponents = (spec as Record<string, unknown>).components as {
  schemas: Record<string, unknown>;
};

export const outputSchema = specComponents.schemas.GroupResponse as Record<string, unknown>;

export const SYSTEM_PROMPT = [
  "You are a browser tab grouping assistant.",
  "Assign tabs to groups based on their URL, title, and description.",
  "",
  "Rules:",
  "1. Prefer assigning tabs to existing groups when relevant.",
  "2. Only create new groups when no existing group fits.",
  "3. Keep group names short (2-4 words).",
  "4. Reuse exact existing group names. Do not create spelling or casing variants",
  "5. Tabs that do not fit any group should be omitted from the response.",
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
