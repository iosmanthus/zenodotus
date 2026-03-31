import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];

// Unified output schema in OpenAI structured output format
// Claude also accepts this format, so one schema for all providers
// OpenAI requires: all keys in required, additionalProperties: false, optional via anyOf null
export const openAIOutputSchema = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          groupId: {
            anyOf: [{ type: "integer" }, { type: "null" }],
            description: "ID of an existing group. Null to create a new group.",
          },
          name: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "Name for the group. Required when creating a new group.",
          },
          tabIds: {
            type: "array",
            items: { type: "integer" },
            description: "Tab IDs to assign to this group.",
          },
        },
        required: ["groupId", "name", "tabIds"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
};

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
