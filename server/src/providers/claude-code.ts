import { query } from "@anthropic-ai/claude-agent-sdk";
import { spec } from "@zenodotus/api-spec";
import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

const SYSTEM_PROMPT = [
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

const outputSchema = (spec as Record<string, unknown>).components as {
  schemas: Record<string, unknown>;
};

function buildUserPrompt(request: GroupRequest): string {
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

export async function assignGroups(request: GroupRequest): Promise<GroupResponse | null> {
  const userPrompt = buildUserPrompt(request);
  const fullPrompt = [SYSTEM_PROMPT, userPrompt].join("\n\n");

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 30000);

  try {
    for await (const event of query({
      prompt: fullPrompt,
      options: {
        model: request.model || "sonnet",
        thinking: request.thinking ? { type: "enabled" } : { type: "disabled" },
        maxTurns: 3,
        persistSession: false,
        abortController,
        outputFormat: {
          type: "json_schema",
          schema: outputSchema.schemas.GroupResponse as Record<string, unknown>,
        },
      },
    })) {
      if (event.type === "result" && event.subtype === "success") {
        const output = (event as Record<string, unknown>).structured_output;
        if (output) {
          return output as GroupResponse;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  return null;
}
